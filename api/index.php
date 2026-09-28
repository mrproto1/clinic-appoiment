<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (function_exists('mysqli_report')) {
    mysqli_report(MYSQLI_REPORT_OFF);
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

define('APP_SECRET', getenv('APP_SECRET') ?: 'hospital-secret-key-2026');
define('MYSQL_HOST', getenv('MYSQL_HOST') ?: '127.0.0.1');
define('MYSQL_PORT', getenv('MYSQL_PORT') ?: 3306);
define('MYSQL_USER', getenv('MYSQL_USER') ?: 'root');
define('MYSQL_PASS', getenv('MYSQL_PASS') ?: '');
define('MYSQL_DB', getenv('MYSQL_DB') ?: 'clinic_appointment_system');

$requestMethod = $_SERVER['REQUEST_METHOD'];
$requestUri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$apiPath = extract_api_path($requestUri);
$segments = $apiPath === '' ? [] : array_values(array_filter(explode('/', $apiPath), 'strlen'));
$body = get_json_body();

if (($segments[0] ?? '') === 'chat') {
    handle_faq_chat($requestMethod, $segments, $body);
}

initialize_data_store();

$allowedResources = ['auth', 'patients', 'users', 'messages', 'appointments', 'organ-donors', 'leaves'];
while (!empty($segments) && !in_array($segments[0], $allowedResources, true)) {
    array_shift($segments);
}

if (count($segments) === 0) {
    respond(200, ['service' => 'Hospital API (PHP)', 'status' => 'ok']);
}

$resource = $segments[0] ?? '';
switch ($resource) {
    case 'auth':
        handle_auth_routes($requestMethod, $segments, $body);
        break;
    case 'patients':
        handle_patient_routes($requestMethod, $segments, $body);
        break;
    case 'users':
        handle_user_routes($requestMethod, $segments, $body);
        break;
    case 'messages':
        handle_message_routes($requestMethod, $segments, $body);
        break;
    case 'appointments':
        handle_appointment_routes($requestMethod, $segments, $body);
        break;
    case 'organ-donors':
        handle_organ_donor_routes($requestMethod, $segments, $body);
        break;
    case 'leaves':
        handle_leave_routes($requestMethod, $segments, $body);
        break;
    default:
        respond(404, ['error' => 'Route not found']);
}

function extract_api_path($requestPath)
{
    $path = trim((string)$requestPath, '/');
    if ($path === '') {
        return '';
    }

    if (strpos($path, 'api/index.php') !== false) {
        $path = str_replace('api/index.php', 'api', $path);
    }

    $apiPos = strpos($path, 'api/');
    if ($apiPos !== false) {
        $path = substr($path, $apiPos + 4);
    } elseif ($path === 'api') {
        return '';
    }

    if (strpos($path, 'index.php') === 0) {
        $path = ltrim(substr($path, strlen('index.php')), '/');
    }

    if ($path === '' || substr($path, -3) === 'api') {
        return '';
    }

    return $path;
}

function get_json_body()
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function respond($statusCode, $payload)
{
    http_response_code((int)$statusCode);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function handle_faq_chat($method, $segments, $body)
{
    if ($method !== 'POST' || count($segments) !== 1) {
        respond(405, ['error' => 'Method not allowed']);
    }

    $message = trim((string)($body['message'] ?? ''));
    if ($message === '' || strlen($message) > 1200) {
        respond(400, ['error' => 'Enter a message under 1,200 characters.']);
    }

    $familyMode = !empty($body['familyMode']);
    $includePatientVitals = !empty($body['includePatientVitals']);
    $familyUser = null;
    $recordedVitals = null;

    if ($familyMode || $includePatientVitals) {
        if (empty($body['familyConsent'])) {
            respond(403, ['error' => 'Consent is required before using family support chat.']);
        }

        $familyUser = require_auth(['family']);
    }

    if ($includePatientVitals) {
        $patient = find_patient_for_user($familyUser);
        if (!$patient) {
            respond(404, ['error' => 'No linked patient record was found for this family account.']);
        }

        $vitals = $patient['vitals'] ?? [];
        $recordedVitals = array_filter([
            'heartRateBpm' => isset($vitals['heartRate']) ? (int)$vitals['heartRate'] : null,
            'bloodPressure' => $vitals['bloodPressure'] ?? null,
            'respiratoryRatePerMinute' => isset($vitals['respiratoryRate']) ? (int)$vitals['respiratoryRate'] : null,
            'oxygenSaturationPercent' => isset($vitals['oxygenSaturation']) ? (int)$vitals['oxygenSaturation'] : null,
            'temperatureCelsius' => isset($vitals['temperature']) ? (float)$vitals['temperature'] : null,
            'recordedAt' => $vitals['lastUpdated'] ?? null
        ], function ($value) {
            return $value !== null && $value !== '';
        });

        if (!$recordedVitals) {
            respond(409, ['error' => 'No recorded vitals are available to share yet.']);
        }
    }

    $forwardedAddresses = explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    $clientAddress = trim((string)($forwardedAddresses[0] ?? ''));
    if ($clientAddress === '') {
        $clientAddress = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    }
    $clientHash = hash('sha256', $clientAddress);
    $rateFile = sys_get_temp_dir() . '/protocol-faq-' . $clientHash . '.json';
    $rateHandle = @fopen($rateFile, 'c+');
    if ($rateHandle) {
        flock($rateHandle, LOCK_EX);
        $rateData = json_decode((string)stream_get_contents($rateHandle), true);
        $recentRequests = array_values(array_filter($rateData['requests'] ?? [], function ($timestamp) {
            return (int)$timestamp > time() - 60;
        }));
        if (count($recentRequests) >= 6) {
            flock($rateHandle, LOCK_UN);
            fclose($rateHandle);
            respond(429, ['error' => 'Too many messages. Please wait a minute and try again.']);
        }

        $recentRequests[] = time();
        ftruncate($rateHandle, 0);
        rewind($rateHandle);
        fwrite($rateHandle, json_encode(['requests' => $recentRequests]));
        fflush($rateHandle);
        flock($rateHandle, LOCK_UN);
        fclose($rateHandle);
    }

    $apiKey = trim((string)getenv('OPENAI_API_KEY'));
    if ($apiKey === '') {
        respond(503, ['error' => 'The FAQ assistant is not configured yet.']);
    }

    $modelInput = $message;
    if ($recordedVitals !== null) {
        $modelInput .= "\n\nLimited patient readings explicitly shared by the signed-in family member: " . json_encode($recordedVitals, JSON_UNESCAPED_SLASHES);
    }

    $requestPayload = [
        'model' => 'gpt-4o-mini',
        'instructions' => 'You are The Protocol Cardiology website FAQ and family support assistant. Answer briefly and empathetically in the language the visitor uses. Help with website navigation, appointments, specialists, Family Access, organ donor tributes, and general non-clinical support for worried family members. If limited recorded vitals are provided, repeat them accurately with their recorded timestamp and explain that you cannot determine the patient\'s condition from them. Never call a patient stable/unstable, diagnose, interpret symptoms, recommend treatment, or interpret heart-rate/ECG readings. Encourage families to contact the patient\'s care team for individual guidance. For urgent symptoms or immediate danger, direct them to local emergency services or immediate medical care. Do not invent clinic hours, contact details, prices, or medical facts. If information is unavailable, direct visitors to the Contact Us page or clinic staff. Do not ask for or expose names, emails, patient IDs, diagnosis, account details, or other identifying information. Use only the limited readings explicitly provided by the server.',
        'input' => $modelInput,
        'max_output_tokens' => 220,
        'store' => false
    ];
    $httpContext = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAuthorization: Bearer {$apiKey}\r\n",
            'content' => json_encode($requestPayload),
            'timeout' => 25,
            'ignore_errors' => true
        ]
    ]);

    $responseBody = @file_get_contents('https://api.openai.com/v1/responses', false, $httpContext);
    $statusCode = 0;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches)) {
            $statusCode = (int)$matches[1];
        }
    }

    if ($responseBody === false || $statusCode < 200 || $statusCode >= 300) {
        respond(502, ['error' => 'The FAQ assistant is temporarily unavailable. Please try again shortly.']);
    }

    $responseData = json_decode($responseBody, true);
    $answer = '';
    foreach ($responseData['output'] ?? [] as $outputItem) {
        if (($outputItem['type'] ?? '') !== 'message') {
            continue;
        }
        foreach ($outputItem['content'] ?? [] as $contentItem) {
            if (($contentItem['type'] ?? '') === 'output_text') {
                $answer .= (string)($contentItem['text'] ?? '');
            }
        }
    }

    if ($answer === '') {
        respond(502, ['error' => 'The FAQ assistant could not prepare a response. Please try again.']);
    }

    respond(200, ['answer' => $answer]);
}

function create_token($user)
{
    $payload = [
        'id' => (int)($user['id'] ?? 0),
        'role' => (string)($user['role'] ?? ''),
        'exp' => time() + (7 * 24 * 60 * 60)
    ];

    $base = base64_encode(json_encode($payload, JSON_UNESCAPED_SLASHES));
    $sig = hash_hmac('sha256', $base, APP_SECRET);
    return $base . '.' . $sig;
}

function verify_token($token)
{
    if (!is_string($token) || strpos($token, '.') === false) {
        return null;
    }

    [$base, $sig] = explode('.', $token, 2);
    $expected = hash_hmac('sha256', $base, APP_SECRET);
    if (!hash_equals($expected, (string)$sig)) {
        return null;
    }

    $decoded = json_decode(base64_decode($base), true);
    if (!is_array($decoded)) {
        return null;
    }

    if ((int)($decoded['exp'] ?? 0) < time()) {
        return null;
    }

    return $decoded;
}

function get_auth_header()
{
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (isset($headers['Authorization'])) {
            return (string)$headers['Authorization'];
        }
        if (isset($headers['authorization'])) {
            return (string)$headers['authorization'];
        }
    }

    return (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
}

function require_auth($allowedRoles = [])
{
    $authHeader = get_auth_header();
    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
        respond(401, ['error' => 'Authorization token required']);
    }

    $claims = verify_token(trim($matches[1]));
    if (!$claims) {
        respond(401, ['error' => 'Invalid or expired token']);
    }

    $user = find_by_id('users', (int)($claims['id'] ?? 0));
    if (!$user) {
        respond(401, ['error' => 'User no longer exists']);
    }

    if (!empty($allowedRoles) && !in_array((string)$user['role'], $allowedRoles, true)) {
        respond(403, ['error' => 'Forbidden']);
    }

    return $user;
}

function get_db()
{
    static $db = null;
    if ($db instanceof mysqli) {
        return $db;
    }

    $bootstrap = @new mysqli(MYSQL_HOST, MYSQL_USER, MYSQL_PASS, '', MYSQL_PORT);
    if ($bootstrap->connect_errno) {
        respond(500, ['error' => 'MySQL connection failed: ' . $bootstrap->connect_error]);
    }

    $dbName = str_replace('`', '``', MYSQL_DB);
    if (!$bootstrap->query("CREATE DATABASE IF NOT EXISTS `{$dbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")) {
        respond(500, ['error' => 'Unable to create/select MySQL database']);
    }

    if (!$bootstrap->select_db(MYSQL_DB)) {
        respond(500, ['error' => 'Unable to select MySQL database']);
    }

    $bootstrap->set_charset('utf8mb4');
    $db = $bootstrap;
    return $db;
}

function get_collection_table($name)
{
    $allowed = [
        'users' => 'collection_users',
        'patients' => 'collection_patients',
        'messages' => 'collection_messages',
        'appointments' => 'collection_appointments',
        'organ_donors' => 'collection_organ_donors',
        'leaves' => 'collection_leaves'
    ];

    if (!isset($allowed[$name])) {
        respond(500, ['error' => 'Invalid collection requested']);
    }

    return $allowed[$name];
}

function ensure_collection_table($name)
{
    $db = get_db();
    $table = get_collection_table($name);
    $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `payload` LONGTEXT NOT NULL,
        `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

    if (!$db->query($sql)) {
        respond(500, ['error' => 'Unable to prepare MySQL collection table']);
    }
}

function collection_count($name)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);
    $result = $db->query("SELECT COUNT(*) AS total FROM `{$table}`");
    if (!$result) {
        respond(500, ['error' => 'Unable to count MySQL collection']);
    }
    $row = $result->fetch_assoc();
    return (int)($row['total'] ?? 0);
}

function read_data($name)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);
    $result = $db->query("SELECT id, payload FROM `{$table}` ORDER BY id ASC");
    if (!$result) {
        respond(500, ['error' => 'Unable to read MySQL collection']);
    }

    $rows = [];
    while ($record = $result->fetch_assoc()) {
        $decoded = json_decode($record['payload'], true);
        if (!is_array($decoded)) {
            continue;
        }
        $decoded['id'] = (int)$record['id'];
        $rows[] = $decoded;
    }

    return $rows;
}

function write_data($name, $rows)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);

    $db->begin_transaction();
    try {
        if (!$db->query("TRUNCATE TABLE `{$table}`")) {
            throw new Exception('truncate failed');
        }

        $stmtWithId = $db->prepare("INSERT INTO `{$table}` (id, payload) VALUES (?, ?)");
        $stmtAuto = $db->prepare("INSERT INTO `{$table}` (payload) VALUES (?)");
        if (!$stmtWithId || !$stmtAuto) {
            throw new Exception('prepare failed');
        }

        foreach (array_values($rows) as $row) {
            $payloadRow = $row;
            $explicitId = isset($payloadRow['id']) ? (int)$payloadRow['id'] : 0;
            if (!isset($payloadRow['createdAt'])) {
                $payloadRow['createdAt'] = gmdate('c');
            }
            unset($payloadRow['id']);
            $payloadJson = json_encode($payloadRow, JSON_UNESCAPED_SLASHES);

            if ($explicitId > 0) {
                $stmtWithId->bind_param('is', $explicitId, $payloadJson);
                if (!$stmtWithId->execute()) {
                    throw new Exception('insert with id failed');
                }
            } else {
                $stmtAuto->bind_param('s', $payloadJson);
                if (!$stmtAuto->execute()) {
                    throw new Exception('insert auto failed');
                }
            }
        }

        $db->commit();
    } catch (Exception $e) {
        $db->rollback();
        respond(500, ['error' => 'Unable to write MySQL collection']);
    }
}

function next_id($rows)
{
    if (empty($rows)) return 1;
    $ids = array_map(function ($item) {
        return (int)($item['id'] ?? 0);
    }, $rows);

    return max($ids) + 1;
}

function add_row($name, $row)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);

    if (!isset($row['createdAt'])) {
        $row['createdAt'] = gmdate('c');
    }

    $payload = $row;
    unset($payload['id']);
    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $stmt = $db->prepare("INSERT INTO `{$table}` (payload) VALUES (?)");
    if (!$stmt) {
        respond(500, ['error' => 'Unable to insert MySQL row']);
    }

    $stmt->bind_param('s', $payloadJson);
    if (!$stmt->execute()) {
        respond(500, ['error' => 'Unable to insert MySQL row']);
    }

    $newId = (int)$db->insert_id;
    return find_by_id($name, $newId);
}

function update_row($name, $id, $updates)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);
    $targetId = (int)$id;

    $existing = find_by_id($name, $targetId);
    if (!$existing) {
        return null;
    }

    $merged = array_merge($existing, $updates, ['updatedAt' => gmdate('c')]);
    $payload = $merged;
    unset($payload['id']);
    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);

    $stmt = $db->prepare("UPDATE `{$table}` SET payload = ? WHERE id = ?");
    if (!$stmt) {
        respond(500, ['error' => 'Unable to update MySQL row']);
    }
    $stmt->bind_param('si', $payloadJson, $targetId);
    if (!$stmt->execute()) {
        respond(500, ['error' => 'Unable to update MySQL row']);
    }

    return find_by_id($name, $targetId);
}

function find_by_id($name, $id)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);
    $targetId = (int)$id;

    $stmt = $db->prepare("SELECT id, payload FROM `{$table}` WHERE id = ? LIMIT 1");
    if (!$stmt) {
        respond(500, ['error' => 'Unable to read MySQL row']);
    }
    $stmt->bind_param('i', $targetId);
    if (!$stmt->execute()) {
        respond(500, ['error' => 'Unable to read MySQL row']);
    }

    $result = $stmt->get_result();
    $record = $result ? $result->fetch_assoc() : null;
    if (!$record) {
        return null;
    }

    $decoded = json_decode($record['payload'], true);
    if (!is_array($decoded)) {
        return null;
    }
    $decoded['id'] = (int)$record['id'];
    return $decoded;
}

function delete_row($name, $id)
{
    ensure_collection_table($name);
    $db = get_db();
    $table = get_collection_table($name);
    $targetId = (int)$id;

    $stmt = $db->prepare("DELETE FROM `{$table}` WHERE id = ?");
    if (!$stmt) {
        respond(500, ['error' => 'Unable to delete MySQL row']);
    }
    $stmt->bind_param('i', $targetId);
    if (!$stmt->execute()) {
        respond(500, ['error' => 'Unable to delete MySQL row']);
    }

    return $stmt->affected_rows > 0;
}

function sanitize_user($user)
{
    return [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'name' => $user['name'],
        'role' => $user['role'],
        'email' => $user['email'] ?? null,
        'phone' => $user['phone'] ?? null,
        'department' => $user['department'] ?? null,
        'linkedPatientId' => isset($user['linkedPatientId']) ? (int)$user['linkedPatientId'] : null,
        'linkedPatientEmail' => $user['linkedPatientEmail'] ?? null,
        'linkedPatientName' => $user['linkedPatientName'] ?? null,
        'relationship' => $user['relationship'] ?? null
    ];
}

function find_patient_for_user($user)
{
    $patients = read_data('patients');

    $linkedId = isset($user['linkedPatientId']) ? (int)$user['linkedPatientId'] : 0;
    if ($linkedId > 0) {
        $linkedPatient = find_by_id('patients', $linkedId);
        if ($linkedPatient) {
            return $linkedPatient;
        }
    }

    $linkedEmail = strtolower(trim((string)($user['linkedPatientEmail'] ?? $user['email'] ?? '')));
    $linkedName = normalize_person_name((string)($user['linkedPatientName'] ?? ''));

    if ($linkedEmail !== '') {
        foreach ($patients as $patient) {
            $patientEmail = strtolower(trim((string)($patient['email'] ?? '')));
            if ($patientEmail !== '' && $patientEmail === $linkedEmail) {
                return $patient;
            }
        }
    }

    if ($linkedName !== '') {
        foreach ($patients as $patient) {
            $patientName = normalize_person_name((string)($patient['name'] ?? ''));
            if ($patientName !== '' && $patientName === $linkedName) {
                return $patient;
            }
        }
    }

    return null;
}

function normalize_login_key($value)
{
    $value = strtolower(trim((string)$value));
    if ($value === '') {
        return '';
    }

    $value = preg_replace('/[^a-z0-9]+/', ' ', $value);
    return preg_replace('/\s+/', ' ', trim((string)$value));
}

function handle_auth_routes($method, $segments, $body)
{
    $route = $segments[1] ?? '';

    if ($method === 'POST' && $route === 'login') {
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $usernameKey = normalize_login_key($username);

        if ($username === '' || $password === '') {
            respond(400, ['error' => 'Username and password required']);
        }

        $users = read_data('users');
        foreach ($users as $user) {
            $storedUsername = trim((string)($user['username'] ?? ''));
            $storedEmail = trim((string)($user['email'] ?? ''));
            $storedName = trim((string)($user['name'] ?? ''));

            $identifierMatched = ($storedUsername === $username)
                || (strcasecmp($storedEmail, $username) === 0)
                || (normalize_login_key($storedName) === $usernameKey);

            if ($identifierMatched && ($user['password'] ?? '') === $password) {
                $token = create_token($user);
                respond(200, ['token' => $token, 'user' => sanitize_user($user)]);
            }
        }

        respond(401, ['error' => 'Invalid credentials']);
    }

    if ($method === 'POST' && $route === 'register') {
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $name = trim((string)($body['name'] ?? ''));
        $email = trim((string)($body['email'] ?? ''));
        $phone = trim((string)($body['phone'] ?? $body['familyPhone'] ?? ''));
        $role = trim((string)($body['role'] ?? 'patient'));

        if ($email !== '' && $username === '') {
            $username = $email;
        }

        if ($username === '' || $password === '' || $name === '' || $email === '') {
            respond(400, ['error' => 'Missing required fields']);
        }

        $users = read_data('users');
        foreach ($users as $user) {
            if (strtolower((string)($user['username'] ?? '')) === strtolower($username) || strtolower((string)($user['email'] ?? '')) === strtolower($email)) {
                respond(400, ['error' => 'Email or username already exists']);
            }
        }

        $allowedRoles = ['doctor', 'staff', 'admin', 'patient', 'family'];
        if (!in_array($role, $allowedRoles, true)) {
            $role = 'patient';
        }

        $linkedPatientId = null;
        $linkedPatientEmail = null;
        $linkedPatientName = null;
        $matchedPatient = null;

        if ($email !== '') {
            $patients = read_data('patients');
            foreach ($patients as $patient) {
                if (strtolower(trim((string)($patient['email'] ?? ''))) === strtolower($email)) {
                    $matchedPatient = $patient;
                    break;
                }
            }
        }

        if ($role === 'family') {
            $linkedPatientEmail = trim((string)($body['patientEmail'] ?? $body['linkedPatientEmail'] ?? ''));
            $linkedPatientName = trim((string)($body['patientName'] ?? $body['linkedPatientName'] ?? ''));

            if ($linkedPatientEmail === '' && $linkedPatientName === '') {
                respond(400, ['error' => 'Family account must include the patient email or name']);
            }

            if ($linkedPatientEmail !== '') {
                $patients = read_data('patients');
                foreach ($patients as $patient) {
                    if (strtolower(trim((string)($patient['email'] ?? ''))) === strtolower($linkedPatientEmail)) {
                        $matchedPatient = $patient;
                        break;
                    }
                }
            }

            if (!$matchedPatient && $linkedPatientName !== '') {
                $patients = read_data('patients');
                foreach ($patients as $patient) {
                    if (normalize_person_name((string)($patient['name'] ?? '')) === normalize_person_name($linkedPatientName)) {
                        $matchedPatient = $patient;
                        break;
                    }
                }
            }

            if (!$matchedPatient) {
                respond(400, ['error' => 'No matching patient record was found for this family access request. Please use the patient email or name registered in the system.']);
            }

            $linkedPatientId = isset($matchedPatient['id']) ? (int)$matchedPatient['id'] : null;
            $linkedPatientEmail = $matchedPatient['email'] ?? $linkedPatientEmail;
            $linkedPatientName = $matchedPatient['name'] ?? $linkedPatientName;
        }

        if ($role === 'patient' && $matchedPatient) {
            $linkedPatientId = isset($matchedPatient['id']) ? (int)$matchedPatient['id'] : null;
            $linkedPatientEmail = $matchedPatient['email'] ?? $email;
            $linkedPatientName = $matchedPatient['name'] ?? $name;
        }

        $newUser = add_row('users', [
            'username' => $username,
            'password' => $password,
            'name' => $name,
            'role' => $role,
            'email' => $email,
            'phone' => $phone !== '' ? $phone : null,
            'department' => $body['department'] ?? null,
            'linkedPatientId' => $linkedPatientId,
            'linkedPatientEmail' => $linkedPatientEmail,
            'linkedPatientName' => $linkedPatientName,
            'relationship' => trim((string)($body['relationship'] ?? '')) ?: null
        ]);

        respond(201, ['message' => 'User registered successfully', 'user' => sanitize_user($newUser)]);
    }

    if ($method === 'POST' && $route === 'verify') {
        $token = get_bearer_token();
        if (!$token) {
            respond(401, ['error' => 'No token provided']);
        }

        $decoded = verify_token($token);
        if (!$decoded) {
            respond(401, ['valid' => false, 'error' => 'Invalid token']);
        }

        respond(200, ['valid' => true, 'user' => $decoded]);
    }

    respond(404, ['error' => 'Route not found']);
}

function handle_patient_routes($method, $segments, $body)
{
    $user = require_auth();

    if ($method === 'GET' && count($segments) === 1) {
        if (!in_array($user['role'], ['doctor', 'staff', 'admin'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }
        respond(200, read_data('patients'));
    }

    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'doctor') {
        $doctorId = (int)$segments[2];
        $patients = array_values(array_filter(read_data('patients'), function ($patient) use ($doctorId) {
            return (int)($patient['assignedDoctor'] ?? 0) === $doctorId;
        }));

        respond(200, $patients);
    }

    if ($method === 'GET' && count($segments) === 2 && $segments[1] === 'me') {
        if (!in_array(($user['role'] ?? ''), ['patient', 'family'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $matched = find_patient_for_user($user);
        if (!$matched) {
            $patients = read_data('patients');
            $emailKey = strtolower(trim((string)($user['email'] ?? '')));
            $nameKey = normalize_person_name((string)($user['name'] ?? ''));

            foreach ($patients as $patient) {
                $patientEmail = strtolower(trim((string)($patient['email'] ?? '')));
                if ($emailKey !== '' && $patientEmail === $emailKey) {
                    $matched = $patient;
                    break;
                }
            }

            if (!$matched) {
                foreach ($patients as $patient) {
                    $patientNameKey = normalize_person_name((string)($patient['name'] ?? ''));
                    if ($nameKey !== '' && $patientNameKey === $nameKey) {
                        $matched = $patient;
                        break;
                    }
                }
            }
        }

        if (!$matched) {
            respond(404, ['error' => 'Patient profile not found']);
        }

        respond(200, $matched);
    }

    if ($method === 'POST' && count($segments) === 2 && $segments[1] === 'code-blue') {
        if (!in_array($user['role'], ['staff', 'doctor'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $patientId = isset($body['patientId']) ? (int)$body['patientId'] : null;
        $roomNumber = trim((string)($body['roomNumber'] ?? ''));
        $note = trim((string)($body['note'] ?? ''));
        $patient = $patientId ? find_by_id('patients', $patientId) : null;
        $patientName = $patient['name'] ?? trim((string)($body['patientName'] ?? ''));
        $responderLabel = ($user['role'] === 'doctor') ? 'Doctor' : 'Nurse';

        $message = 'CODE BLUE emergency';
        if ($patientName !== '') {
            $message .= ' for ' . $patientName;
        }
        if ($roomNumber !== '') {
            $message .= ' in room ' . $roomNumber;
        }
        $message .= '. ' . $responderLabel . ' ' . $user['name'] . ' requires immediate assistance.';

        $newMessage = add_row('messages', [
            'senderId' => (int)$user['id'],
            'senderName' => $user['name'],
            'recipientId' => null,
            'groupId' => 'all',
            'content' => $message,
            'type' => 'code-blue',
            'metadata' => [
                'patientId' => $patient ? (int)$patient['id'] : ($patientId ?: null),
                'patientName' => $patientName !== '' ? $patientName : null,
                'roomNumber' => $roomNumber !== '' ? $roomNumber : null,
                'note' => $note !== '' ? $note : null
            ],
            'timestamp' => gmdate('c'),
            'read' => false
        ]);

        respond(201, ['message' => 'Code blue alert sent to everyone', 'data' => $newMessage]);
    }

    if ($method === 'POST' && count($segments) === 1) {
        if (!in_array($user['role'], ['staff', 'doctor', 'admin'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $name = trim((string)($body['name'] ?? ''));
        $patientCode = trim((string)($body['patientCode'] ?? ''));
        $diagnosis = trim((string)($body['diagnosis'] ?? ''));
        $sicknessCategory = trim((string)($body['sicknessCategory'] ?? 'General Medicine'));
        $severity = trim((string)($body['severity'] ?? 'Moderate'));
        $assignedDoctorId = isset($body['assignedDoctor']) ? (int)$body['assignedDoctor'] : 0;

        if ($name === '' || $patientCode === '' || $diagnosis === '' || $severity === '' || $assignedDoctorId <= 0) {
            respond(400, ['error' => 'Missing required fields (doctor assignment is required)']);
        }

        $allowedSeverity = ['Critical', 'Severe', 'Moderate', 'Mild'];
        if (!in_array($severity, $allowedSeverity, true)) {
            $severity = 'Moderate';
        }

        $doctorUser = find_by_id('users', $assignedDoctorId);
        if (!$doctorUser || ($doctorUser['role'] ?? '') !== 'doctor') {
            respond(400, ['error' => 'Assigned doctor is invalid']);
        }

        $newPatient = add_row('patients', [
            'name' => $name,
            'patientCode' => $patientCode,
            'age' => $body['age'] ?? null,
            'gender' => $body['gender'] ?? null,
            'bloodType' => $body['bloodType'] ?? null,
            'phone' => $body['phone'] ?? null,
            'email' => $body['email'] ?? null,
            'address' => $body['address'] ?? null,
            'diagnosis' => $diagnosis,
            'sicknessCategory' => $sicknessCategory,
            'severity' => $severity,
            'admittedDate' => gmdate('Y-m-d'),
            'admittedBy' => (int)$user['id'],
            'assignedDoctor' => $assignedDoctorId,
            'requiredDoctorDepartment' => $doctorUser['department'] ?? null,
            'assignedStaff' => isset($body['assignedStaff']) ? (int)$body['assignedStaff'] : null,
            'vitals' => [
                'temperature' => null,
                'bloodPressure' => null,
                'heartRate' => null,
                'respiratoryRate' => null,
                'lastUpdated' => gmdate('c')
            ],
            'notes' => ''
        ]);

        $newPatientEmail = strtolower(trim((string)($newPatient['email'] ?? '')));
        if ($newPatientEmail !== '') {
            $users = read_data('users');
            foreach ($users as $existingUser) {
                if ((string)($existingUser['role'] ?? '') !== 'patient') {
                    continue;
                }

                if (strtolower(trim((string)($existingUser['email'] ?? ''))) === $newPatientEmail) {
                    update_row('users', (int)$existingUser['id'], [
                        'linkedPatientId' => (int)$newPatient['id'],
                        'linkedPatientEmail' => $newPatient['email'],
                        'linkedPatientName' => $newPatient['name']
                    ]);
                    break;
                }
            }
        }

        respond(201, ['message' => 'Patient created successfully', 'patient' => $newPatient]);
    }

    if ($method === 'GET' && count($segments) === 2 && is_numeric($segments[1])) {
        $patient = find_by_id('patients', (int)$segments[1]);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        respond(200, $patient);
    }

    if ($method === 'PUT' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'vitals') {
        if (!in_array($user['role'], ['staff', 'doctor', 'admin'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $patientId = (int)$segments[1];
        $patient = find_by_id('patients', $patientId);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        $vitals = $patient['vitals'] ?? [];
        if ($user['role'] === 'staff') {
            $vitals['bloodPressure'] = $body['bloodPressure'] ?? ($vitals['bloodPressure'] ?? null);
        } else {
            $vitals['temperature'] = $body['temperature'] ?? ($vitals['temperature'] ?? null);
            $vitals['bloodPressure'] = $body['bloodPressure'] ?? ($vitals['bloodPressure'] ?? null);
            $vitals['heartRate'] = $body['heartRate'] ?? ($vitals['heartRate'] ?? null);
            $vitals['respiratoryRate'] = $body['respiratoryRate'] ?? ($vitals['respiratoryRate'] ?? null);
        }
        $vitals['lastUpdated'] = gmdate('c');

        $updatedPatient = update_row('patients', $patientId, ['vitals' => $vitals]);
        respond(200, ['message' => 'Patient vitals updated successfully', 'patient' => $updatedPatient]);
    }

    if ($method === 'PUT' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'severity') {
        if (!in_array($user['role'], ['doctor', 'admin'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $severity = trim((string)($body['severity'] ?? ''));
        $allowedSeverity = ['Critical', 'Severe', 'Moderate', 'Mild'];
        if (!in_array($severity, $allowedSeverity, true)) {
            respond(400, ['error' => 'Invalid severity level']);
        }

        $patientId = (int)$segments[1];
        $patient = find_by_id('patients', $patientId);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        $updatedPatient = update_row('patients', $patientId, ['severity' => $severity]);
        respond(200, ['message' => 'Patient severity updated successfully', 'patient' => $updatedPatient]);
    }

    if ($method === 'PUT' && count($segments) === 2 && is_numeric($segments[1])) {
        if (!in_array($user['role'], ['doctor', 'staff', 'admin'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $patientId = (int)$segments[1];
        $patient = find_by_id('patients', $patientId);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        $updatedPatient = update_row('patients', $patientId, $body);
        respond(200, ['message' => 'Patient updated successfully', 'patient' => $updatedPatient]);
    }

    if ($method === 'DELETE' && count($segments) === 2 && is_numeric($segments[1])) {
        if (!in_array($user['role'], ['admin', 'staff', 'doctor'], true)) {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $patientId = (int)$segments[1];
        $patient = find_by_id('patients', $patientId);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        if ($user['role'] === 'doctor' && (int)($patient['assignedDoctor'] ?? 0) !== (int)$user['id']) {
            respond(403, ['error' => 'Doctors can only delete their assigned patients']);
        }

        $deleted = delete_row('patients', $patientId);
        if (!$deleted) {
            respond(404, ['error' => 'Patient not found']);
        }

        respond(200, ['message' => 'Patient deleted successfully']);
    }

    respond(404, ['error' => 'Route not found']);
}

function handle_user_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'role' && $segments[2] === 'doctor') {
        $doctors = array_values(array_filter(read_data('users'), function ($item) {
            return ($item['role'] ?? '') === 'doctor';
        }));

        // Keep one doctor profile per real doctor name (lowest ID wins) to avoid duplicate selections.
        usort($doctors, function ($a, $b) {
            return ((int)$a['id']) <=> ((int)$b['id']);
        });

        $unique = [];
        foreach ($doctors as $item) {
            $key = normalize_person_name((string)($item['name'] ?? ''));
            if ($key === '') {
                $key = 'doctor-' . (string)($item['id'] ?? '');
            }
            if (!isset($unique[$key])) {
                $unique[$key] = $item;
            }
        }

        $doctors = array_values($unique);

        $doctors = array_map(function ($item) {
            return [
                'id' => (int)$item['id'],
                'name' => $item['name'],
                'email' => $item['email'] ?? null,
                'department' => $item['department'] ?? null
            ];
        }, $doctors);

        respond(200, $doctors);
    }

    $user = require_auth();

    if ($method === 'GET' && count($segments) === 1) {
        if ($user['role'] !== 'admin') {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $users = array_map('sanitize_user', read_data('users'));
        respond(200, $users);
    }

    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'role' && $segments[2] === 'staff') {
        $staff = array_values(array_filter(read_data('users'), function ($item) {
            return ($item['role'] ?? '') === 'staff';
        }));

        $staff = array_map(function ($item) {
            return [
                'id' => (int)$item['id'],
                'name' => $item['name'],
                'email' => $item['email'] ?? null,
                'department' => $item['department'] ?? null
            ];
        }, $staff);

        respond(200, $staff);
    }

    if ($method === 'GET' && count($segments) === 2 && is_numeric($segments[1])) {
        $target = find_by_id('users', (int)$segments[1]);
        if (!$target) {
            respond(404, ['error' => 'User not found']);
        }

        respond(200, sanitize_user($target));
    }

    if ($method === 'PUT' && count($segments) === 2 && is_numeric($segments[1])) {
        $targetId = (int)$segments[1];
        $target = find_by_id('users', $targetId);
        if (!$target) {
            respond(404, ['error' => 'User not found']);
        }

        if ((int)$user['id'] !== $targetId && $user['role'] !== 'admin') {
            respond(403, ['error' => 'Insufficient permissions']);
        }

        $updated = update_row('users', $targetId, $body);
        respond(200, ['message' => 'User updated successfully', 'user' => sanitize_user($updated)]);
    }

    respond(404, ['error' => 'Route not found']);
}

function handle_message_routes($method, $segments, $body)
{
    $user = require_auth();

    if ($method === 'GET' && count($segments) === 1) {
        $messages = read_data('messages');
        $userMessages = array_values(array_filter($messages, function ($msg) use ($user) {
            return (int)($msg['senderId'] ?? 0) === (int)$user['id']
                || (int)($msg['recipientId'] ?? 0) === (int)$user['id'];
        }));

        usort($userMessages, function ($a, $b) {
            return strtotime($b['timestamp'] ?? '') <=> strtotime($a['timestamp'] ?? '');
        });

        respond(200, $userMessages);
    }

    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'conversation' && is_numeric($segments[2])) {
        $otherId = (int)$segments[2];
        $messages = read_data('messages');

        $conversation = array_values(array_filter($messages, function ($msg) use ($user, $otherId) {
            $sender = (int)($msg['senderId'] ?? 0);
            $recipient = (int)($msg['recipientId'] ?? 0);
            return ($sender === (int)$user['id'] && $recipient === $otherId)
                || ($sender === $otherId && $recipient === (int)$user['id']);
        }));

        usort($conversation, function ($a, $b) {
            return strtotime($a['timestamp'] ?? '') <=> strtotime($b['timestamp'] ?? '');
        });

        respond(200, $conversation);
    }

    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'group') {
        $groupId = $segments[2];
        $messages = read_data('messages');
        $groupMessages = array_values(array_filter($messages, function ($msg) use ($groupId) {
            return ($msg['groupId'] ?? null) === $groupId;
        }));

        usort($groupMessages, function ($a, $b) {
            return strtotime($a['timestamp'] ?? '') <=> strtotime($b['timestamp'] ?? '');
        });

        respond(200, $groupMessages);
    }

    if ($method === 'POST' && count($segments) === 1) {
        $content = trim((string)($body['content'] ?? ''));
        $recipientId = isset($body['recipientId']) ? (int)$body['recipientId'] : null;
        $groupId = isset($body['groupId']) ? (string)$body['groupId'] : null;
        $type = trim((string)($body['type'] ?? 'text'));

        if ($content === '' || (!$recipientId && !$groupId)) {
            respond(400, ['error' => 'Missing required fields']);
        }

        $newMessage = add_row('messages', [
            'senderId' => (int)$user['id'],
            'senderName' => $user['name'],
            'recipientId' => $recipientId,
            'groupId' => $groupId,
            'content' => $content,
            'type' => $type,
            'timestamp' => gmdate('c'),
            'read' => false
        ]);

        respond(201, ['message' => 'Message sent successfully', 'data' => $newMessage]);
    }

    if ($method === 'POST' && count($segments) === 3 && $segments[1] === 'group') {
        $groupId = $segments[2];
        $content = trim((string)($body['content'] ?? ''));

        if ($content === '') {
            respond(400, ['error' => 'Message content required']);
        }

        $newMessage = add_row('messages', [
            'senderId' => (int)$user['id'],
            'senderName' => $user['name'],
            'groupId' => $groupId,
            'content' => $content,
            'timestamp' => gmdate('c'),
            'read' => false
        ]);

        respond(201, ['message' => 'Group message sent successfully', 'data' => $newMessage]);
    }

    if ($method === 'PUT' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'read') {
        $messageId = (int)$segments[1];
        $message = find_by_id('messages', $messageId);
        if (!$message) {
            respond(404, ['error' => 'Message not found']);
        }

        $updated = update_row('messages', $messageId, ['read' => true]);
        respond(200, ['message' => 'Message marked as read', 'data' => $updated]);
    }

    respond(404, ['error' => 'Route not found']);
}

function handle_appointment_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 2 && $segments[1] === 'availability') {
        $doctorId = (int)($_GET['doctorId'] ?? 0);
        $date = trim((string)($_GET['date'] ?? ''));
        if ($doctorId <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            respond(400, ['error' => 'Doctor and date are required']);
        }

        $booked = array_values(array_filter(read_data('appointments'), function ($item) use ($doctorId, $date) {
            return (int)($item['doctorId'] ?? 0) === $doctorId && ($item['date'] ?? '') === $date;
        }));
        $bookedTimes = array_values(array_unique(array_map(function ($item) {
            return (string)($item['time'] ?? '');
        }, $booked)));
        $approvedLeave = find_approved_doctor_leave($doctorId, $date);

        $slots = [];
        for ($hour = 8; $hour <= 17; $hour++) {
            foreach ([0, 30] as $minute) {
                $slot = sprintf('%02d:%02d', $hour, $minute);
                $slots[] = [
                    'time' => $slot,
                    'available' => !$approvedLeave && !in_array($slot, $bookedTimes, true)
                ];
            }
        }

        respond(200, [
            'doctorId' => $doctorId,
            'date' => $date,
            'booked' => $bookedTimes,
            'onLeave' => (bool)$approvedLeave,
            'leaveReason' => $approvedLeave['reason'] ?? null,
            'slots' => $slots
        ]);
    }

    if ($method === 'GET' && count($segments) === 1) {
        $appointments = read_data('appointments');
        $patientEmail = trim((string)($_GET['patientEmail'] ?? ''));

        if ($patientEmail !== '') {
            $normalizedEmail = strtolower($patientEmail);
            $appointments = array_values(array_filter($appointments, function ($item) use ($normalizedEmail) {
                return strtolower((string)($item['patientEmail'] ?? '')) === $normalizedEmail;
            }));
        }

        usort($appointments, function ($a, $b) {
            return strcmp(($a['date'] ?? '') . ' ' . ($a['time'] ?? ''), ($b['date'] ?? '') . ' ' . ($b['time'] ?? ''));
        });

        respond(200, $appointments);
    }

    if ($method === 'POST' && count($segments) === 1) {
        $patientName = trim((string)($body['patientName'] ?? ''));
        $patientEmail = trim((string)($body['patientEmail'] ?? ''));
        $patientPhone = trim((string)($body['patientPhone'] ?? ''));
        $date = trim((string)($body['date'] ?? ''));
        $time = trim((string)($body['time'] ?? ''));
        $doctorId = isset($body['doctorId']) ? (int)$body['doctorId'] : 0;

        if ($patientName === '' || $patientEmail === '' || $patientPhone === '' || $date === '' || $time === '' || $doctorId <= 0) {
            respond(400, ['error' => 'Missing required appointment fields']);
        }

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $time)) {
            respond(400, ['error' => 'Invalid appointment date or time format']);
        }

        $doctor = find_by_id('users', $doctorId);
        if (!$doctor || ($doctor['role'] ?? '') !== 'doctor') {
            respond(400, ['error' => 'Selected doctor is invalid']);
        }

        // Canonical doctor profile: if duplicates exist, map to lowest doctor ID by same name.
        $canonicalDoctor = get_canonical_doctor($doctor);
        $doctorId = (int)$canonicalDoctor['id'];

        $department = $canonicalDoctor['department'] ?? 'General Medicine';
        if (!is_doctor_schedule_valid($date, $time, $department)) {
            respond(400, ['error' => 'Selected time is outside this doctor specialty schedule']);
        }

        if (find_approved_doctor_leave($doctorId, $date)) {
            respond(409, ['error' => 'This doctor is on approved leave for the selected date']);
        }

        $appointments = read_data('appointments');
        foreach ($appointments as $item) {
            if ((int)($item['doctorId'] ?? 0) === $doctorId && ($item['date'] ?? '') === $date && ($item['time'] ?? '') === $time) {
                respond(409, ['error' => 'Doctor already has an appointment at this time']);
            }
        }

        $newAppointment = add_row('appointments', [
            'patientName' => $patientName,
            'patientEmail' => $patientEmail,
            'patientPhone' => $patientPhone,
            'date' => $date,
            'time' => $time,
            'doctorId' => $doctorId,
            'doctorName' => $canonicalDoctor['name'] ?? 'Doctor',
            'doctorDepartment' => $department,
            'status' => 'Scheduled'
        ]);

        respond(201, ['message' => 'Appointment booked successfully', 'appointment' => $newAppointment]);
    }

    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'doctor' && is_numeric($segments[2])) {
        $user = require_auth(['doctor', 'staff', 'admin']);
        $doctorId = (int)$segments[2];

        if ($user['role'] === 'doctor' && (int)$user['id'] !== $doctorId) {
            respond(403, ['error' => 'Doctors can only view their own appointment list']);
        }

        $doctorUser = find_by_id('users', $doctorId);
        $doctorNameKey = normalize_person_name((string)($doctorUser['name'] ?? ''));
        $aliasDoctorIds = get_doctor_alias_ids($doctorId);

        $appointments = array_values(array_filter(read_data('appointments'), function ($item) use ($doctorId, $aliasDoctorIds, $doctorNameKey) {
            $itemDoctorId = (int)($item['doctorId'] ?? 0);
            $itemDoctorNameKey = normalize_person_name((string)($item['doctorName'] ?? ''));

            if ($itemDoctorId === $doctorId) {
                return true;
            }

            if (!empty($aliasDoctorIds) && in_array($itemDoctorId, $aliasDoctorIds, true)) {
                return true;
            }

            if ($doctorNameKey !== '' && $itemDoctorNameKey === $doctorNameKey) {
                return true;
            }

            return false;
        }));

        usort($appointments, function ($a, $b) {
            return strcmp(($a['date'] ?? '') . ' ' . ($a['time'] ?? ''), ($b['date'] ?? '') . ' ' . ($b['time'] ?? ''));
        });

        respond(200, $appointments);
    }

    if ($method === 'DELETE' && count($segments) === 2 && is_numeric($segments[1])) {
        $user = require_auth(['doctor', 'staff', 'admin']);
        $appointmentId = (int)$segments[1];
        $appointment = find_by_id('appointments', $appointmentId);

        if (!$appointment) {
            respond(404, ['error' => 'Appointment not found']);
        }

        if ($user['role'] === 'doctor') {
            $doctorOwnIds = get_doctor_alias_ids((int)$user['id']);
            $appointmentDoctorId = (int)($appointment['doctorId'] ?? 0);
            if (empty($doctorOwnIds) || !in_array($appointmentDoctorId, $doctorOwnIds, true)) {
                respond(403, ['error' => 'Doctors can only delete appointments assigned to their account']);
            }
        }

        $deleted = delete_row('appointments', $appointmentId);
        if (!$deleted) {
            respond(404, ['error' => 'Appointment not found']);
        }

        respond(200, ['message' => 'Appointment deleted successfully']);
    }

    respond(404, ['error' => 'Route not found']);
}

function handle_leave_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 1) {
        $user = require_auth(['admin', 'doctor']);
        $leaves = read_data('leaves');

        if ($user['role'] === 'doctor') {
            $doctorIds = get_doctor_alias_ids((int)$user['id']);
            $leaves = array_values(array_filter($leaves, function ($item) use ($doctorIds) {
                return in_array((int)($item['doctorId'] ?? 0), $doctorIds, true);
            }));
        }

        usort($leaves, function ($a, $b) {
            return strcmp(($a['startDate'] ?? '') . ($a['createdAt'] ?? ''), ($b['startDate'] ?? '') . ($b['createdAt'] ?? ''));
        });
        respond(200, $leaves);
    }

    if ($method === 'GET' && count($segments) === 3 && $segments[1] === 'doctor' && is_numeric($segments[2])) {
        $user = require_auth(['admin', 'doctor']);
        $doctorId = (int)$segments[2];
        if ($user['role'] === 'doctor' && !in_array($doctorId, get_doctor_alias_ids((int)$user['id']), true)) {
            respond(403, ['error' => 'Doctors can only view their own leave requests']);
        }

        $leaves = array_values(array_filter(read_data('leaves'), function ($item) use ($doctorId) {
            return (int)($item['doctorId'] ?? 0) === $doctorId;
        }));
        respond(200, $leaves);
    }

    if ($method === 'POST' && count($segments) === 1) {
        $user = require_auth(['doctor']);
        $startDate = trim((string)($body['startDate'] ?? ''));
        $endDate = trim((string)($body['endDate'] ?? ''));
        $reason = trim((string)($body['reason'] ?? ''));

        if (!valid_iso_date($startDate) || !valid_iso_date($endDate) || $startDate > $endDate) {
            respond(400, ['error' => 'Please provide a valid leave date range']);
        }
        if (strlen($reason) < 3 || strlen($reason) > 300) {
            respond(400, ['error' => 'Leave reason must be between 3 and 300 characters']);
        }

        $doctor = find_by_id('users', (int)$user['id']);
        $doctorIds = get_doctor_alias_ids((int)$user['id']);
        foreach (read_data('leaves') as $item) {
            $sameDoctor = in_array((int)($item['doctorId'] ?? 0), $doctorIds, true);
            $activeStatus = in_array(($item['status'] ?? ''), ['Pending', 'Approved'], true);
            if ($sameDoctor && $activeStatus && date_ranges_overlap($startDate, $endDate, $item['startDate'] ?? '', $item['endDate'] ?? '')) {
                respond(409, ['error' => 'You already have a pending or approved leave in this date range']);
            }
        }

        $leave = add_row('leaves', [
            'doctorId' => (int)$user['id'],
            'doctorName' => $doctor['name'] ?? $user['name'],
            'startDate' => $startDate,
            'endDate' => $endDate,
            'reason' => $reason,
            'status' => 'Pending',
            'createdAt' => gmdate('c')
        ]);
        respond(201, ['message' => 'Leave request submitted for admin approval', 'leave' => $leave]);
    }

    if ($method === 'PUT' && count($segments) === 2 && is_numeric($segments[1])) {
        $user = require_auth(['admin']);
        $leaveId = (int)$segments[1];
        $leave = find_by_id('leaves', $leaveId);
        $status = trim((string)($body['status'] ?? ''));
        if (!$leave) {
            respond(404, ['error' => 'Leave request not found']);
        }
        if (!in_array($status, ['Approved', 'Rejected'], true)) {
            respond(400, ['error' => 'Leave status must be Approved or Rejected']);
        }

        if ($status === 'Approved') {
            foreach (read_data('leaves') as $item) {
                if ((int)($item['id'] ?? 0) === $leaveId || ($item['status'] ?? '') !== 'Approved') {
                    continue;
                }
                if ((int)($item['doctorId'] ?? 0) === (int)($leave['doctorId'] ?? 0) && date_ranges_overlap($leave['startDate'] ?? '', $leave['endDate'] ?? '', $item['startDate'] ?? '', $item['endDate'] ?? '')) {
                    respond(409, ['error' => 'Another approved leave overlaps this date range']);
                }
            }
        }

        $updated = update_row('leaves', $leaveId, [
            'status' => $status,
            'reviewedBy' => $user['name'],
            'reviewedAt' => gmdate('c')
        ]);
        respond(200, ['message' => 'Leave request updated', 'leave' => $updated]);
    }

    respond(404, ['error' => 'Route not found']);
}

function valid_iso_date($date)
{
    $parsed = DateTime::createFromFormat('!Y-m-d', (string)$date);
    return $parsed && $parsed->format('Y-m-d') === $date;
}

function date_ranges_overlap($startA, $endA, $startB, $endB)
{
    return valid_iso_date($startA) && valid_iso_date($endA) && valid_iso_date($startB) && valid_iso_date($endB)
        && $startA <= $endB && $endA >= $startB;
}

function find_approved_doctor_leave($doctorId, $date)
{
    foreach (read_data('leaves') as $item) {
        if ((int)($item['doctorId'] ?? 0) === (int)$doctorId
            && ($item['status'] ?? '') === 'Approved'
            && $date >= ($item['startDate'] ?? '')
            && $date <= ($item['endDate'] ?? '')) {
            return $item;
        }
    }
    return null;
}

function handle_organ_donor_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 1) {
        $donors = read_data('organ_donors');
        usort($donors, function ($a, $b) {
            return strtotime($b['createdAt'] ?? '') <=> strtotime($a['createdAt'] ?? '');
        });

        respond(200, array_map(function ($donor) {
            return [
                'id' => (int)($donor['id'] ?? 0),
                'name' => $donor['name'] ?? '',
                'organType' => $donor['organType'] ?? 'Any organ',
                'tribute' => $donor['tribute'] ?? '',
                'createdAt' => $donor['createdAt'] ?? null
            ];
        }, $donors));
    }

    if ($method === 'POST' && count($segments) === 1) {
        $name = trim((string)($body['name'] ?? ''));
        $organType = trim((string)($body['organType'] ?? 'Any organ'));
        $tribute = trim((string)($body['tribute'] ?? ''));

        if ($name === '' || strlen($name) < 2) {
            respond(400, ['error' => 'Please enter a valid donor name']);
        }

        if (strlen($name) > 120 || strlen($tribute) > 300) {
            respond(400, ['error' => 'Donor details are too long']);
        }

        $allowedOrganTypes = ['Any organ', 'Kidney', 'Liver', 'Heart', 'Lung', 'Cornea', 'Tissue'];
        if (!in_array($organType, $allowedOrganTypes, true)) {
            $organType = 'Any organ';
        }

        $donor = add_row('organ_donors', [
            'name' => $name,
            'organType' => $organType,
            'tribute' => $tribute,
            'createdAt' => gmdate('c')
        ]);

        respond(201, [
            'message' => 'Organ donor tribute added successfully',
            'donor' => $donor
        ]);
    }

    respond(404, ['error' => 'Route not found']);
}

function is_doctor_schedule_valid($date, $time, $department)
{
    $timestamp = strtotime($date . ' ' . $time);
    if ($timestamp === false) {
        return false;
    }

    $minutes = to_minutes($time);
    if ($minutes < 0) {
        return false;
    }

    // Accept full 24-hour schedule for competition mode: 00:00 through 23:59.
    return $minutes >= 0 && $minutes <= (23 * 60 + 59);
}

function to_minutes($hhmm)
{
    if (!preg_match('/^(\d{2}):(\d{2})$/', $hhmm, $matches)) {
        return -1;
    }

    $hours = (int)$matches[1];
    $minutes = (int)$matches[2];
    if ($hours > 23 || $minutes > 59) {
        return -1;
    }

    return $hours * 60 + $minutes;
}

function initialize_data_store()
{
    foreach (['users', 'patients', 'messages', 'appointments', 'organ_donors', 'leaves'] as $collection) {
        ensure_collection_table($collection);
    }

    if (collection_count('users') === 0) {
        $users = [
            [
                'id' => 1,
                'username' => 'admin',
                'password' => 'admin123',
                'name' => 'Admin User',
                'role' => 'admin',
                'email' => 'admin@hospital.com',
                'department' => 'Administration',
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 2,
                'username' => 'muhammad.irfan',
                'password' => 'password123',
                'name' => 'Dr. Muhammad Irfan',
                'role' => 'doctor',
                'email' => 'doctor1@hospital.com',
                'department' => 'Cardiology',
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 3,
                'username' => 'afif.wahdi',
                'password' => 'password123',
                'name' => 'Dr. Afif Wahdi',
                'role' => 'doctor',
                'email' => 'doctor2@hospital.com',
                'department' => 'Psychiatry',
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 4,
                'username' => 'nurse1',
                'password' => 'password123',
                'name' => 'Nurse Sarah',
                'role' => 'staff',
                'email' => 'nurse1@hospital.com',
                'department' => 'Emergency',
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 5,
                'username' => 'patient1',
                'password' => 'password123',
                'name' => 'Ahmad',
                'role' => 'patient',
                'email' => 'ahmad@email.com',
                'department' => null,
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 6,
                'username' => 'patient2',
                'password' => 'password123',
                'name' => 'Fatimah',
                'role' => 'patient',
                'email' => 'fatimah@email.com',
                'department' => null,
                'createdAt' => gmdate('c')
            ]
        ];
        write_data('users', $users);
    }

    sync_doctor_profiles();
    sync_staff_profiles();

    if (collection_count('patients') === 0) {
        $patients = [
            [
                'id' => 1,
                'name' => 'Ahmad',
                'patientCode' => 'AHM-001',
                'age' => 45,
                'gender' => 'Male',
                'bloodType' => 'O+',
                'phone' => '+60123456789',
                'email' => 'ahmad@email.com',
                'address' => '123 Jln Ampang, Kuala Lumpur',
                'diagnosis' => 'Chest pain',
                'severity' => 'Moderate',
                'admittedDate' => '2026-07-10',
                'admittedBy' => 1,
                'assignedDoctor' => 2,
                'assignedStaff' => 4,
                'vitals' => [
                    'temperature' => 37.5,
                    'bloodPressure' => '140/90',
                    'heartRate' => 85,
                    'respiratoryRate' => 18,
                    'lastUpdated' => gmdate('c')
                ],
                'notes' => 'Patient complained of severe chest pain',
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 2,
                'name' => 'Fatimah',
                'patientCode' => 'FAT-002',
                'age' => 32,
                'gender' => 'Female',
                'bloodType' => 'B+',
                'phone' => '+60187654321',
                'email' => 'fatimah@email.com',
                'address' => '456 Jln Sultan, Kuala Lumpur',
                'diagnosis' => 'Post-operation check',
                'severity' => 'Mild',
                'admittedDate' => '2026-07-12',
                'admittedBy' => 2,
                'assignedDoctor' => 2,
                'assignedStaff' => 3,
                'vitals' => [
                    'temperature' => 37.2,
                    'bloodPressure' => '118/76',
                    'heartRate' => 72,
                    'respiratoryRate' => 16,
                    'lastUpdated' => gmdate('c')
                ],
                'notes' => 'Recovering well from surgery',
                'createdAt' => gmdate('c')
            ],
            [
                'id' => 3,
                'name' => 'Rajesh',
                'patientCode' => 'RAJ-003',
                'age' => 58,
                'gender' => 'Male',
                'bloodType' => 'A+',
                'phone' => '+60198765432',
                'email' => 'rajesh@email.com',
                'address' => '789 Jln Dato, Kuala Lumpur',
                'diagnosis' => 'Hypertension',
                'severity' => 'Severe',
                'admittedDate' => '2026-07-08',
                'admittedBy' => 1,
                'assignedDoctor' => 1,
                'assignedStaff' => 3,
                'vitals' => [
                    'temperature' => 36.8,
                    'bloodPressure' => '160/100',
                    'heartRate' => 92,
                    'respiratoryRate' => 20,
                    'lastUpdated' => gmdate('c')
                ],
                'notes' => 'Severe hypertension, monitoring closely',
                'createdAt' => gmdate('c')
            ]
        ];
        write_data('patients', $patients);
    }

    if (collection_count('messages') === 0) {
        write_data('messages', []);
    }

    if (collection_count('appointments') === 0) {
        write_data('appointments', []);
    }
}

function sync_doctor_profiles()
{
    $users = read_data('users');
    if (empty($users)) return;

    $changed = false;

    foreach ($users as $index => $user) {
        if (($user['username'] ?? '') === 'doctor1' || normalize_person_name($user['name'] ?? '') === 'dr muhammad irfan') {
            if (($users[$index]['username'] ?? '') !== 'muhammad.irfan') {
                $users[$index]['username'] = 'muhammad.irfan';
                $changed = true;
            }
            if (($users[$index]['name'] ?? '') !== 'Dr. Muhammad Irfan') {
                $users[$index]['name'] = 'Dr. Muhammad Irfan';
                $changed = true;
            }
            if (($users[$index]['department'] ?? '') !== 'Cardiology') {
                $users[$index]['department'] = 'Cardiology';
                $changed = true;
            }
        }

        if (($user['username'] ?? '') === 'doctor2' || ($user['username'] ?? '') === 'ariff.zafrizat' || normalize_person_name($user['name'] ?? '') === 'dr ariff zafrizat') {
            if (($users[$index]['username'] ?? '') !== 'afif.wahdi') {
                $users[$index]['username'] = 'afif.wahdi';
                $changed = true;
            }
            if (($users[$index]['name'] ?? '') !== 'Dr. Afif Wahdi') {
                $users[$index]['name'] = 'Dr. Afif Wahdi';
                $changed = true;
            }
            if (($users[$index]['department'] ?? '') !== 'Psychiatry') {
                $users[$index]['department'] = 'Psychiatry';
                $changed = true;
            }
        }

        if (($user['username'] ?? '') === 'doctor3' || normalize_person_name($user['name'] ?? '') === 'dr aizul eirfan') {
            if (($users[$index]['username'] ?? '') !== 'aizul.eirfan') {
                $users[$index]['username'] = 'aizul.eirfan';
                $changed = true;
            }
            if (($users[$index]['name'] ?? '') !== 'Dr. Aizul Eirfan') {
                $users[$index]['name'] = 'Dr. Aizul Eirfan';
                $changed = true;
            }
            if (($users[$index]['department'] ?? '') !== 'Neuro-Oftalmology') {
                $users[$index]['department'] = 'Neuro-Oftalmology';
                $changed = true;
            }
            if (($users[$index]['role'] ?? '') !== 'doctor') {
                $users[$index]['role'] = 'doctor';
                $changed = true;
            }
        }
    }

    $hasDoctor3 = false;
    foreach ($users as $user) {
        if (($user['username'] ?? '') === 'aizul.eirfan') {
            $hasDoctor3 = true;
            break;
        }
    }

    if (!$hasDoctor3) {
        $users[] = [
            'id' => next_id($users),
            'username' => 'aizul.eirfan',
            'password' => 'password123',
            'name' => 'Dr. Aizul Eirfan',
            'role' => 'doctor',
            'email' => 'doctor3@hospital.com',
            'department' => 'Neuro-Oftalmology',
            'createdAt' => gmdate('c')
        ];
        $changed = true;
    }

    if ($changed) {
        write_data('users', $users);
    }
}

function sync_staff_profiles()
{
    $users = read_data('users');
    if (empty($users)) return;

    $hasNurse1 = false;
    foreach ($users as $user) {
        if (($user['username'] ?? '') === 'nurse1') {
            $hasNurse1 = true;
            break;
        }
    }

    if (!$hasNurse1) {
        $users[] = [
            'id' => next_id($users),
            'username' => 'nurse1',
            'password' => 'password123',
            'name' => 'Nurse Sarah',
            'role' => 'staff',
            'email' => 'nurse1@hospital.com',
            'department' => 'Emergency',
            'createdAt' => gmdate('c')
        ];
        write_data('users', $users);
    }
}

function normalize_person_name($value)
{
    $value = strtolower(trim((string)$value));
    if ($value === '') {
        return '';
    }

    return preg_replace('/\s+/', ' ', $value);
}

function get_canonical_doctor($doctor)
{
    $users = read_data('users');
    $nameKey = normalize_person_name((string)($doctor['name'] ?? ''));

    if ($nameKey === '') {
        return $doctor;
    }

    $sameNameDoctors = array_values(array_filter($users, function ($item) use ($nameKey) {
        return ($item['role'] ?? '') === 'doctor'
            && normalize_person_name((string)($item['name'] ?? '')) === $nameKey;
    }));

    if (empty($sameNameDoctors)) {
        return $doctor;
    }

    usort($sameNameDoctors, function ($a, $b) {
        return ((int)$a['id']) <=> ((int)$b['id']);
    });

    return $sameNameDoctors[0];
}

function get_doctor_alias_ids($doctorId)
{
    $target = find_by_id('users', (int)$doctorId);
    if (!$target || ($target['role'] ?? '') !== 'doctor') {
        return [];
    }

    $users = read_data('users');
    $nameKey = normalize_person_name((string)($target['name'] ?? ''));
    if ($nameKey === '') {
        return [];
    }

    $ids = [];
    foreach ($users as $user) {
        if (($user['role'] ?? '') !== 'doctor') {
            continue;
        }

        if (normalize_person_name((string)($user['name'] ?? '')) === $nameKey) {
            $ids[] = (int)($user['id'] ?? 0);
        }
    }

    return array_values(array_unique(array_filter($ids, function ($id) {
        return $id > 0;
    })));
}
