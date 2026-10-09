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

$allowedResources = ['auth', 'patients', 'users', 'messages', 'appointments', 'organ-donors', 'leaves', 'bulletins', 'site-status', 'clinical-requests', 'death-certificates', 'medicine-stock', 'notifications', 'audit-logs', 'medical-documents'];
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
    case 'bulletins':
        handle_bulletin_routes($requestMethod, $segments, $body);
        break;
    case 'site-status':
        handle_site_status_routes($requestMethod, $segments, $body);
        break;
    case 'clinical-requests':
        handle_clinical_request_routes($requestMethod, $segments, $body);
        break;
    case 'death-certificates':
        handle_death_certificate_routes($requestMethod, $segments, $body);
        break;
    case 'medicine-stock':
        handle_medicine_stock_routes($requestMethod, $segments, $body);
        break;
    case 'notifications':
        handle_notification_routes($requestMethod, $segments, $body);
        break;
    case 'audit-logs':
        handle_audit_log_routes($requestMethod, $segments, $body);
        break;
    case 'medical-documents':
        handle_medical_document_routes($requestMethod, $segments, $body);
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
        'leaves' => 'collection_leaves',
        'bulletins' => 'collection_bulletins',
        'site_settings' => 'collection_site_settings',
        'clinical_requests' => 'collection_clinical_requests',
        'death_certificates' => 'collection_death_certificates',
        'medicine_stock' => 'collection_medicine_stock',
        'notifications' => 'collection_notifications',
        'audit_logs' => 'collection_audit_logs',
        'medical_documents' => 'collection_medical_documents'
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
        error_log('MySQL insert failed for collection ' . $name . ': ' . $stmt->error);
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

function audit_event($user, $action, $resource, $resourceId, $metadata = [])
{
    $safeMetadata = [];
    foreach (['patientId', 'appointmentId', 'requestId', 'documentId', 'stockId', 'fromStatus', 'toStatus'] as $key) {
        if (array_key_exists($key, $metadata)) {
            $safeMetadata[$key] = $metadata[$key];
        }
    }

    return add_row('audit_logs', [
        'actorId' => (int)($user['id'] ?? 0),
        'actorName' => (string)($user['name'] ?? 'System'),
        'actorRole' => (string)($user['role'] ?? 'system'),
        'action' => substr((string)$action, 0, 80),
        'resource' => substr((string)$resource, 0, 60),
        'resourceId' => (int)$resourceId,
        'metadata' => $safeMetadata,
        'timestamp' => gmdate('c')
    ]);
}

function create_user_notification($userId, $type, $title, $message, $metadata = [])
{
    $target = find_by_id('users', (int)$userId);
    if (!$target) return null;

    return add_row('notifications', [
        'userId' => (int)$target['id'],
        'type' => substr((string)$type, 0, 60),
        'title' => substr((string)$title, 0, 120),
        'message' => substr((string)$message, 0, 240),
        'metadata' => $metadata,
        'readAt' => null,
        'createdAt' => gmdate('c')
    ]);
}

function notify_patient_contacts($patient, $type, $title, $message, $metadata = [])
{
    if (!$patient || empty($patient['id'])) return;

    $patientId = (int)$patient['id'];
    $patientEmail = strtolower(trim((string)($patient['email'] ?? '')));
    $recipients = [];
    foreach (read_data('users') as $candidate) {
        $role = (string)($candidate['role'] ?? '');
        if (!in_array($role, ['patient', 'family'], true)) continue;

        $linked = $role === 'family' ? find_patient_for_user($candidate) : null;
        $matchesPatient = ($linked && (int)($linked['id'] ?? 0) === $patientId)
            || ($role === 'patient' && $patientEmail !== '' && strtolower(trim((string)($candidate['email'] ?? ''))) === $patientEmail);
        if ($matchesPatient) $recipients[(int)$candidate['id']] = true;
    }

    foreach (array_keys($recipients) as $recipientId) {
        create_user_notification($recipientId, $type, $title, $message, array_merge($metadata, ['patientId' => $patientId]));
    }
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

        $allowedRoles = ['doctor', 'staff', 'admin', 'patient', 'family', 'pharmacy'];
        if (!in_array($role, $allowedRoles, true)) {
            $role = 'patient';
        }

        $department = trim((string)($body['department'] ?? ''));
        if (in_array($role, ['doctor', 'staff', 'admin', 'pharmacy'], true)) {
            require_auth(['admin']);
            if (strlen($password) < 8) {
                respond(400, ['error' => 'Password must be at least 8 characters']);
            }
            if ($role === 'doctor' && $department === '') {
                respond(400, ['error' => 'Doctor accounts need a department']);
            }
        }
        if (strlen($department) > 100 || strlen($name) > 120 || strlen($username) > 120 || strlen($email) > 160) {
            respond(400, ['error' => 'One or more fields are too long']);
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
            'department' => $department !== '' ? $department : null,
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
            return (int)($patient['assignedDoctor'] ?? 0) === $doctorId
                && ($patient['status'] ?? 'active') !== 'discharged';
        }));

        respond(200, $patients);
    }

    if ($method === 'POST' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'case-complete') {
        if (($user['role'] ?? '') !== 'doctor') {
            respond(403, ['error' => 'Only doctors can complete a patient case']);
        }

        $patientId = (int)$segments[1];
        $patient = find_by_id('patients', $patientId);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        $doctorIds = get_doctor_alias_ids((int)$user['id']);
        if (!in_array((int)($patient['assignedDoctor'] ?? 0), $doctorIds, true)) {
            respond(403, ['error' => 'You can only complete a case assigned to you']);
        }
        if (($patient['status'] ?? '') === 'discharged') {
            respond(409, ['error' => 'This patient case is already complete']);
        }

        $linkedFamilyIds = [];
        foreach (read_data('users') as $familyUser) {
            if (($familyUser['role'] ?? '') !== 'family') {
                continue;
            }
            $linkedPatient = find_patient_for_user($familyUser);
            if ($linkedPatient && (int)($linkedPatient['id'] ?? 0) === $patientId) {
                $linkedFamilyIds[] = (int)$familyUser['id'];
            }
        }

        $db = get_db();
        $db->begin_transaction();
        try {
            $updatedPatient = update_row('patients', $patientId, [
                'status' => 'discharged',
                'dischargedAt' => gmdate('c'),
                'dischargedBy' => (int)$user['id']
            ]);
            foreach ($linkedFamilyIds as $familyId) {
                delete_row('users', $familyId);
            }
            $db->commit();
        } catch (Throwable $error) {
            $db->rollback();
            respond(500, ['error' => 'Unable to complete this patient case']);
        }

        respond(200, [
            'message' => 'Patient case completed and family accounts removed',
            'patient' => $updatedPatient,
            'familyAccountsDeleted' => count($linkedFamilyIds)
        ]);
    }

    if ($method === 'POST' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'family-alert') {
        if (($user['role'] ?? '') !== 'doctor') {
            respond(403, ['error' => 'Only the assigned doctor can alert this patient\'s family']);
        }

        $patientId = (int)$segments[1];
        $patient = find_by_id('patients', $patientId);
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }

        $doctorIds = get_doctor_alias_ids((int)$user['id']);
        if (!in_array((int)($patient['assignedDoctor'] ?? 0), $doctorIds, true)) {
            respond(403, ['error' => 'You can only alert family for a patient assigned to you']);
        }

        $messages = read_data('messages');
        foreach ($messages as $existingMessage) {
            $metadata = $existingMessage['metadata'] ?? [];
            if (($existingMessage['type'] ?? '') === 'family-hospital-alert'
                && (int)($metadata['patientId'] ?? 0) === $patientId
                && strtotime((string)($existingMessage['timestamp'] ?? '')) > time() - 300) {
                respond(429, ['error' => 'A family hospital alert was already sent for this patient in the last five minutes']);
            }
        }

        $linkedFamilies = [];
        foreach (read_data('users') as $familyUser) {
            if (($familyUser['role'] ?? '') !== 'family') {
                continue;
            }

            $linkedPatient = find_patient_for_user($familyUser);
            if ($linkedPatient && (int)($linkedPatient['id'] ?? 0) === $patientId) {
                $linkedFamilies[] = $familyUser;
            }
        }

        if (empty($linkedFamilies)) {
            respond(409, ['error' => 'No family accounts are linked to this patient']);
        }

        $patientName = trim((string)($patient['name'] ?? 'your family member'));
        $content = "URGENT: Please come to the hospital now. Dr. {$user['name']} has requested family presence because {$patientName}'s health has deteriorated significantly. Please contact the care team for instructions.";
        $sendEmail = !empty($body['sendEmail']);
        $emailAcceptedCount = 0;
        $emailFailedCount = 0;
        $emailFailureReasons = [];
        foreach ($linkedFamilies as $familyUser) {
            add_row('messages', [
                'senderId' => (int)$user['id'],
                'senderName' => (string)($user['name'] ?? 'Doctor'),
                'recipientId' => (int)$familyUser['id'],
                'groupId' => null,
                'content' => $content,
                'type' => 'family-hospital-alert',
                'title' => 'Urgent: Please come to the hospital',
                'metadata' => ['patientId' => $patientId],
                'timestamp' => gmdate('c'),
                'read' => false
            ]);

            if ($sendEmail) {
                $recipientEmail = trim((string)($familyUser['email'] ?? ''));
                if (!filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
                    $emailFailedCount++;
                    $emailFailureReasons[] = 'A linked family account has no valid email address';
                    continue;
                }

                $emailResult = send_bird_email(
                    $recipientEmail,
                    'Urgent: Please come to the hospital now',
                    'URGENT: The Protocol care team asks you to come to the hospital now to support your family member. Please contact the care team when you arrive. For immediate danger, call local emergency services.',
                    'family-alert-' . $patientId . '-' . (int)$familyUser['id'] . '-' . time()
                );
                if ($emailResult['accepted']) {
                    $emailAcceptedCount++;
                } else {
                    $emailFailedCount++;
                    $emailFailureReasons[] = $emailResult['error'];
                }
            }
        }

        respond(201, [
            'message' => 'Urgent hospital alert sent to linked family accounts',
            'recipientCount' => count($linkedFamilies),
            'emailRequested' => $sendEmail,
            'emailAcceptedCount' => $emailAcceptedCount,
            'emailFailedCount' => $emailFailedCount,
            'emailFailureReasons' => array_values(array_unique($emailFailureReasons))
        ]);
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

        audit_event($user, 'patient-created', 'patient', $newPatient['id'], ['patientId' => $newPatient['id']]);

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
        audit_event($user, 'patient-vitals-updated', 'patient', $patientId, ['patientId' => $patientId]);
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
        audit_event($user, 'patient-severity-updated', 'patient', $patientId, ['patientId' => $patientId]);
        if (in_array($severity, ['Critical', 'Severe'], true)) {
            notify_patient_contacts($patient, 'patient-severity-updated', 'Patient status updated', 'The care team updated the linked patient’s severity. Please open the family account for details.');
        }
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
        audit_event($user, 'patient-record-updated', 'patient', $patientId, ['patientId' => $patientId]);
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

        audit_event($user, 'patient-record-deleted', 'patient', $patientId, ['patientId' => $patientId]);
        respond(200, ['message' => 'Patient deleted successfully']);
    }

    respond(404, ['error' => 'Route not found']);
}

function send_bird_email($recipientEmail, $subject, $text, $idempotencyKey)
{
    $apiKey = trim((string)getenv('BIRD_API_KEY'));
    $senderEmail = trim((string)getenv('BIRD_EMAIL_FROM'));
    if ($apiKey === '' || $senderEmail === '') {
        return ['accepted' => false, 'error' => 'Bird email is not configured (BIRD_API_KEY or BIRD_EMAIL_FROM missing)'];
    }

    if (!preg_match('/^bk_([a-z]{2}\d+)_/', $apiKey, $matches)) {
        return ['accepted' => false, 'error' => 'Bird API key has an unsupported format'];
    }
    $region = $matches[1];
    $payload = [
        'from' => [
            'email' => $senderEmail,
            'name' => trim((string)(getenv('BIRD_EMAIL_FROM_NAME') ?: 'The Protocol Hospital'))
        ],
        'to' => [$recipientEmail],
        'subject' => $subject,
        'text' => $text,
        'category' => 'transactional',
        'track_opens' => false,
        'track_clicks' => false
    ];
    $httpContext = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAccept: application/json\r\nAuthorization: Bearer {$apiKey}\r\nIdempotency-Key: {$idempotencyKey}\r\n",
            'content' => json_encode($payload, JSON_UNESCAPED_SLASHES),
            'timeout' => 20,
            'ignore_errors' => true
        ]
    ]);
    $responseBody = @file_get_contents("https://{$region}.platform.bird.com/v1/email/messages", false, $httpContext);
    $statusCode = 0;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $statusMatches)) {
            $statusCode = (int)$statusMatches[1];
        }
    }

    if ($responseBody !== false && $statusCode >= 200 && $statusCode < 300) {
        return ['accepted' => true, 'error' => ''];
    }

    $errorData = json_decode((string)$responseBody, true);
    $errorCode = trim((string)($errorData['code'] ?? $errorData['error']['code'] ?? ''));
    $errorMessage = trim((string)($errorData['message'] ?? $errorData['error']['message'] ?? ''));
    $errorMessage = substr(preg_replace('/\s+/', ' ', strip_tags($errorMessage)), 0, 240);
    $errorSummary = 'Bird did not accept one email (HTTP ' . ($statusCode ?: 'network error') . ')';
    if ($errorCode !== '') {
        $errorSummary .= ' [' . substr($errorCode, 0, 60) . ']';
    }
    if ($errorMessage !== '') {
        $errorSummary .= ': ' . $errorMessage;
    }

    return ['accepted' => false, 'error' => $errorSummary];
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

    if ($method === 'DELETE' && count($segments) === 2 && is_numeric($segments[1])) {
        if (($user['role'] ?? '') !== 'admin') {
            respond(403, ['error' => 'Only admins can delete family accounts']);
        }

        $targetId = (int)$segments[1];
        $target = find_by_id('users', $targetId);
        if (!$target) {
            respond(404, ['error' => 'User not found']);
        }
        if (($target['role'] ?? '') !== 'family') {
            respond(403, ['error' => 'This action only deletes family accounts']);
        }

        if (!delete_row('users', $targetId)) {
            respond(404, ['error' => 'Family account not found']);
        }
        respond(200, ['message' => 'Family account deleted']);
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

function is_future_appointment_slot($date, $time)
{
    if (!valid_iso_date((string)$date) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', (string)$time)) return false;
    $timezone = new DateTimeZone('Asia/Kuala_Lumpur');
    $slot = DateTimeImmutable::createFromFormat('!Y-m-d H:i', (string)$date . ' ' . (string)$time, $timezone);
    return $slot && $slot > new DateTimeImmutable('now', $timezone);
}

function handle_appointment_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 2 && $segments[1] === 'me') {
        $user = require_auth(['patient', 'family', 'doctor', 'staff', 'admin']);
        $items = array_values(array_filter(read_data('appointments'), function ($appointment) use ($user) {
            return appointment_belongs_to_user($appointment, $user);
        }));
        usort($items, function ($a, $b) {
            return strcmp(($a['date'] ?? '') . ' ' . ($a['time'] ?? ''), ($b['date'] ?? '') . ' ' . ($b['time'] ?? ''));
        });
        respond(200, $items);
    }

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
        if (!is_future_appointment_slot($date, $time)) respond(400, ['error' => 'Appointment must be booked for a future date and time']);

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

        create_user_notification((int)$canonicalDoctor['id'], 'appointment-booked', 'New appointment booked', 'A patient booked an appointment on your schedule.', ['appointmentId' => (int)$newAppointment['id']]);
        $patientRecord = find_patient_by_email($patientEmail);
        if ($patientRecord) {
            notify_patient_contacts($patientRecord, 'appointment-booked', 'Appointment booked', 'Your appointment has been booked.', ['appointmentId' => (int)$newAppointment['id']]);
        } else {
            foreach (read_data('users') as $patientUser) {
                if (($patientUser['role'] ?? '') === 'patient' && strtolower(trim((string)($patientUser['email'] ?? ''))) === strtolower($patientEmail)) {
                    create_user_notification((int)$patientUser['id'], 'appointment-booked', 'Appointment booked', 'Your appointment has been booked.', ['appointmentId' => (int)$newAppointment['id']]);
                }
            }
        }
        audit_event(['id' => 0, 'name' => 'Booking portal', 'role' => 'public'], 'appointment-booked', 'appointment', $newAppointment['id'], ['appointmentId' => $newAppointment['id']]);

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

    if ($method === 'PUT' && count($segments) === 2 && is_numeric($segments[1])) {
        $user = require_auth(['patient', 'family', 'doctor', 'staff', 'admin']);
        $appointmentId = (int)$segments[1];
        $appointment = find_by_id('appointments', $appointmentId);
        if (!$appointment) respond(404, ['error' => 'Appointment not found']);

        $action = trim((string)($body['action'] ?? ''));
        if (in_array($action, ['confirm', 'request-reschedule'], true)) {
            if (!in_array($user['role'], ['patient', 'family'], true) || !appointment_belongs_to_user($appointment, $user)) {
                respond(403, ['error' => 'Only the booked patient or their linked family account can confirm or request a reschedule']);
            }
            if (in_array(($appointment['status'] ?? ''), ['Cancelled', 'Completed'], true)) {
                respond(409, ['error' => 'This appointment can no longer be changed']);
            }
            if (($appointment['status'] ?? '') === 'Reschedule Requested') {
                respond(409, ['error' => 'A reschedule request is already waiting for the care team']);
            }

            if ($action === 'confirm') {
                if (!is_future_appointment_slot($appointment['date'] ?? '', $appointment['time'] ?? '')) respond(409, ['error' => 'This appointment time has passed']);
                $updated = update_row('appointments', $appointmentId, [
                    'status' => 'Confirmed',
                    'confirmedBy' => (int)$user['id'],
                    'confirmedAt' => gmdate('c')
                ]);
                create_user_notification((int)$appointment['doctorId'], 'appointment-confirmed', 'Appointment confirmed', 'A patient or linked family member confirmed an appointment.', ['appointmentId' => $appointmentId]);
                audit_event($user, 'appointment-confirmed', 'appointment', $appointmentId, ['appointmentId' => $appointmentId]);
                respond(200, ['message' => 'Appointment confirmed', 'appointment' => $updated]);
            }

            $date = trim((string)($body['date'] ?? ''));
            $time = trim((string)($body['time'] ?? ''));
            $note = clinical_text($body['note'] ?? '', 240);
            if (!is_future_appointment_slot($date, $time)) {
                respond(400, ['error' => 'Choose a valid future date and time']);
            }
            if ($note === null) respond(400, ['error' => 'Reschedule note is too long']);
            $request = ['date' => $date, 'time' => $time, 'note' => $note, 'requestedBy' => (int)$user['id'], 'requestedByName' => (string)($user['name'] ?? ''), 'requestedAt' => gmdate('c'), 'previousStatus' => (string)($appointment['status'] ?? 'Scheduled'), 'status' => 'Pending'];
            $updated = update_row('appointments', $appointmentId, ['status' => 'Reschedule Requested', 'rescheduleRequest' => $request]);
            create_user_notification((int)$appointment['doctorId'], 'appointment-reschedule', 'Reschedule request', 'A patient or linked family member requested a new appointment time.', ['appointmentId' => $appointmentId]);
            foreach (read_data('users') as $staffUser) {
                if (($staffUser['role'] ?? '') === 'staff') create_user_notification((int)$staffUser['id'], 'appointment-reschedule', 'Reschedule request', 'An appointment needs a reschedule decision.', ['appointmentId' => $appointmentId]);
            }
            audit_event($user, 'appointment-reschedule-requested', 'appointment', $appointmentId, ['appointmentId' => $appointmentId]);
            respond(200, ['message' => 'Reschedule request sent for care-team review', 'appointment' => $updated]);
        }

        if (in_array($action, ['approve-reschedule', 'reject-reschedule'], true)) {
            if (!in_array($user['role'], ['doctor', 'staff', 'admin'], true)) respond(403, ['error' => 'Only the care team can review reschedule requests']);
            if ($user['role'] === 'doctor' && !in_array((int)($appointment['doctorId'] ?? 0), get_doctor_alias_ids((int)$user['id']), true)) {
                respond(403, ['error' => 'Only the assigned doctor can review this appointment']);
            }
            $request = $appointment['rescheduleRequest'] ?? null;
            if (($appointment['status'] ?? '') !== 'Reschedule Requested' || !is_array($request)) respond(409, ['error' => 'No reschedule request is waiting for review']);

            if ($action === 'reject-reschedule') {
                $updated = update_row('appointments', $appointmentId, [
                    'status' => $request['previousStatus'] ?? 'Scheduled',
                    'rescheduleRequest' => array_merge($request, ['status' => 'Rejected', 'reviewedBy' => (string)($user['name'] ?? ''), 'reviewedAt' => gmdate('c')])
                ]);
                $patient = find_patient_by_email((string)($appointment['patientEmail'] ?? ''));
                notify_patient_contacts($patient, 'appointment-reschedule-rejected', 'Reschedule request not approved', 'Your original appointment time remains scheduled.', ['appointmentId' => $appointmentId]);
                audit_event($user, 'appointment-reschedule-rejected', 'appointment', $appointmentId, ['appointmentId' => $appointmentId]);
                respond(200, ['message' => 'Reschedule request rejected; original time remains scheduled', 'appointment' => $updated]);
            }

            $newDate = (string)($request['date'] ?? '');
            $newTime = (string)($request['time'] ?? '');
            $doctor = find_by_id('users', (int)($appointment['doctorId'] ?? 0));
            if (!is_future_appointment_slot($newDate, $newTime) || !is_doctor_schedule_valid($newDate, $newTime, $doctor['department'] ?? 'General Medicine') || find_approved_doctor_leave((int)$appointment['doctorId'], $newDate)) {
                respond(409, ['error' => 'The requested time is outside the doctor schedule or on approved leave']);
            }
            foreach (read_data('appointments') as $other) {
                if ((int)($other['id'] ?? 0) !== $appointmentId && (int)($other['doctorId'] ?? 0) === (int)$appointment['doctorId'] && ($other['date'] ?? '') === $newDate && ($other['time'] ?? '') === $newTime && ($other['status'] ?? '') !== 'Cancelled') {
                    respond(409, ['error' => 'Doctor already has an appointment at that time']);
                }
            }

            $updated = update_row('appointments', $appointmentId, [
                'date' => $newDate,
                'time' => $newTime,
                'status' => 'Confirmed',
                'rescheduleRequest' => array_merge($request, ['status' => 'Approved', 'reviewedBy' => (string)($user['name'] ?? ''), 'reviewedAt' => gmdate('c')])
            ]);
            $patient = find_patient_by_email((string)($appointment['patientEmail'] ?? ''));
            notify_patient_contacts($patient, 'appointment-rescheduled', 'Appointment rescheduled', 'The care team approved a new appointment time.', ['appointmentId' => $appointmentId]);
            audit_event($user, 'appointment-reschedule-approved', 'appointment', $appointmentId, ['appointmentId' => $appointmentId]);
            respond(200, ['message' => 'Reschedule approved', 'appointment' => $updated]);
        }

        respond(400, ['error' => 'Unsupported appointment action']);
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

function clinical_text($value, $maxLength, $required = false)
{
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', trim((string)$value));
    if ($required && $text === '') {
        return null;
    }
    if (strlen($text) > $maxLength) {
        return null;
    }
    return $text;
}

function clinical_clean_medicine($input)
{
    if (!is_array($input)) {
        return null;
    }

    $quantity = filter_var($input['quantity'] ?? 1, FILTER_VALIDATE_INT);
    if ($quantity === false || $quantity < 1 || $quantity > 10000) return null;

    $medicine = [
        'name' => clinical_text($input['name'] ?? '', 120, true),
        'dose' => clinical_text($input['dose'] ?? '', 60, true),
        'frequency' => clinical_text($input['frequency'] ?? '', 80, true),
        'duration' => clinical_text($input['duration'] ?? '', 60),
        'instructions' => clinical_text($input['instructions'] ?? '', 300),
        'quantity' => $quantity
    ];

    return in_array(null, $medicine, true) ? null : $medicine;
}

function clinical_clean_blood_result($input)
{
    $collectedDate = trim((string)($input['collectedDate'] ?? ''));
    if (!valid_iso_date($collectedDate) || $collectedDate > gmdate('Y-m-d', time() + 86400)) {
        return null;
    }

    $rows = $input['results'] ?? null;
    if (!is_array($rows) || count($rows) < 1 || count($rows) > 30) {
        return null;
    }

    $results = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            return null;
        }

        $entry = [
            'test' => clinical_text($row['test'] ?? '', 80, true),
            'value' => clinical_text($row['value'] ?? '', 40, true),
            'unit' => clinical_text($row['unit'] ?? '', 30),
            'range' => clinical_text($row['range'] ?? '', 40)
        ];
        if (in_array(null, $entry, true)) {
            return null;
        }

        $flag = strtolower(trim((string)($row['flag'] ?? 'normal')));
        $entry['flag'] = in_array($flag, ['normal', 'high', 'low', 'critical'], true) ? $flag : 'normal';
        $results[] = $entry;
    }

    $note = clinical_text($input['note'] ?? '', 300);
    if ($note === null) {
        return null;
    }

    return ['collectedDate' => $collectedDate, 'results' => $results, 'note' => $note];
}

function clinical_history_entry($user, $action, $note = '')
{
    return [
        'action' => $action,
        'by' => (string)($user['name'] ?? ''),
        'role' => (string)($user['role'] ?? ''),
        'at' => gmdate('c'),
        'note' => $note
    ];
}

function public_clinical_request($item)
{
    $public = [
        'id' => (int)$item['id'],
        'type' => (string)($item['type'] ?? ''),
        'patientName' => (string)($item['patientName'] ?? ''),
        'doctorName' => (string)($item['doctorName'] ?? ''),
        'nurseName' => (string)($item['nurseName'] ?? ''),
        'status' => (string)($item['status'] ?? ''),
        'createdAt' => $item['createdAt'] ?? null,
        'approvedAt' => $item['approvedAt'] ?? null
    ];

    if (!empty($item['familyRequest'])) {
        $public['familyRequest'] = [
            'medicineName' => (string)($item['familyRequest']['medicineName'] ?? ''),
            'note' => (string)($item['familyRequest']['note'] ?? '')
        ];
    }

    if ($public['type'] === 'medicine') {
        $public['medicine'] = $item['medicine'] ?? null;
        if (!empty($item['originalMedicine'])) {
            $public['originalMedicine'] = $item['originalMedicine'];
            $public['changeReason'] = (string)($item['nurseChange']['note'] ?? '');
        }
    } elseif ($public['type'] === 'family-medicine-request') {
        $public['familyRequest'] = [
            'medicineName' => (string)($item['familyRequest']['medicineName'] ?? ''),
            'note' => (string)($item['familyRequest']['note'] ?? '')
        ];
    } else {
        $public['collectedDate'] = $item['collectedDate'] ?? null;
        $public['results'] = $item['results'] ?? [];
        $public['note'] = (string)($item['note'] ?? '');
    }

    return $public;
}

function handle_clinical_request_routes($method, $segments, $body)
{
    $user = require_auth(['doctor', 'staff', 'admin', 'family']);
    $role = (string)$user['role'];

    if ($method === 'GET' && count($segments) === 1) {
        $items = read_data('clinical_requests');

        if ($role === 'doctor') {
            $doctorIds = get_doctor_alias_ids((int)$user['id']);
            $items = array_filter($items, function ($item) use ($doctorIds) {
                return in_array((int)($item['doctorId'] ?? 0), $doctorIds, true);
            });
        } elseif ($role === 'family') {
            $patient = find_patient_for_user($user);
            $patientId = $patient ? (int)$patient['id'] : 0;
            $familyUserId = (int)$user['id'];
            $items = array_filter($items, function ($item) use ($patientId, $familyUserId) {
                if ($patientId <= 0 || (int)($item['patientId'] ?? 0) !== $patientId) {
                    return false;
                }

                if (($item['status'] ?? '') === 'approved') {
                    return true;
                }

                return !empty($item['familyRequest'])
                    && (int)($item['familyRequest']['requesterId'] ?? 0) === $familyUserId
                    && in_array(($item['status'] ?? ''), ['awaiting_doctor', 'awaiting_nurse', 'rejected'], true);
            });
        }

        $items = array_values($items);
        usort($items, function ($a, $b) {
            return strtotime($b['createdAt'] ?? '') <=> strtotime($a['createdAt'] ?? '');
        });
        if ($role === 'family') {
            $items = array_map('public_clinical_request', $items);
        }
        respond(200, $items);
    }

    if ($method === 'POST' && count($segments) === 1) {
        if ($role === 'family') {
            $type = trim((string)($body['type'] ?? ''));
            $requestedName = clinical_text($body['medicineName'] ?? '', 120, true);
            $requestNote = clinical_text($body['note'] ?? '', 300);
            if ($type !== 'family-medicine-request' || $requestedName === null || $requestNote === null) {
                respond(400, ['error' => 'Provide a medicine name and a note no longer than 300 characters']);
            }

            $patient = find_patient_for_user($user);
            if (!$patient) {
                respond(409, ['error' => 'Your family account is not linked to a patient']);
            }
            if (($patient['status'] ?? '') === 'discharged') {
                respond(409, ['error' => 'This patient case is already complete']);
            }

            $doctorId = (int)($patient['assignedDoctor'] ?? 0);
            $doctor = $doctorId > 0 ? find_by_id('users', $doctorId) : null;
            if (!$doctor || ($doctor['role'] ?? '') !== 'doctor') {
                respond(409, ['error' => 'No doctor is assigned to this patient yet']);
            }

            $record = [
                'type' => 'family-medicine-request',
                'patientId' => (int)$patient['id'],
                'patientName' => (string)($patient['name'] ?? ''),
                'patientCode' => (string)($patient['patientCode'] ?? ''),
                'doctorId' => $doctorId,
                'doctorName' => (string)($doctor['name'] ?? ''),
                'familyRequest' => [
                    'requesterId' => (int)$user['id'],
                    'requesterName' => (string)($user['name'] ?? ''),
                    'medicineName' => $requestedName,
                    'note' => $requestNote
                ],
                'status' => 'awaiting_doctor',
                'history' => [clinical_history_entry($user, 'family-requested-medicine')]
            ];
            $saved = add_row('clinical_requests', $record);
            create_user_notification($doctorId, 'family-medicine-request', 'Family medicine request', 'A linked family member requested a medicine review.', ['patientId' => (int)$patient['id'], 'requestId' => (int)$saved['id']]);
            audit_event($user, 'family-medicine-requested', 'clinical-request', $saved['id'], ['patientId' => $patient['id'], 'requestId' => $saved['id']]);
            respond(201, ['message' => 'Request sent to the patient’s assigned doctor', 'requestId' => (int)$saved['id']]);
        }

        if ($role !== 'doctor') {
            respond(403, ['error' => 'Only doctors can create medicine requests or blood results']);
        }

        $type = trim((string)($body['type'] ?? ''));
        if (!in_array($type, ['medicine', 'blood-result'], true)) {
            respond(400, ['error' => 'Request type must be medicine or blood-result']);
        }

        $patient = find_by_id('patients', (int)($body['patientId'] ?? 0));
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }
        if (($patient['status'] ?? '') === 'discharged') {
            respond(409, ['error' => 'This patient case is already complete']);
        }
        if (!in_array((int)($patient['assignedDoctor'] ?? 0), get_doctor_alias_ids((int)$user['id']), true)) {
            respond(403, ['error' => 'You can only create requests for patients assigned to you']);
        }

        $record = [
            'type' => $type,
            'patientId' => (int)$patient['id'],
            'patientName' => (string)($patient['name'] ?? ''),
            'patientCode' => (string)($patient['patientCode'] ?? ''),
            'doctorId' => (int)$user['id'],
            'doctorName' => (string)($user['name'] ?? ''),
            'status' => 'awaiting_nurse'
        ];

        if ($type === 'medicine') {
            $medicine = clinical_clean_medicine($body['medicine'] ?? null);
            if (!$medicine) {
                respond(400, ['error' => 'Medicine name, dose and frequency are required, and fields must stay within their length limits']);
            }
            $record['medicine'] = $medicine;
        } else {
            $blood = clinical_clean_blood_result($body);
            if (!$blood) {
                respond(400, ['error' => 'Blood result needs a valid collection date and 1-30 rows, each with a test name and value']);
            }
            $record = array_merge($record, $blood);
        }

        $record['history'] = [clinical_history_entry($user, 'submitted')];
        $saved = add_row('clinical_requests', $record);
        audit_event($user, 'clinical-request-submitted', 'clinical-request', $saved['id'], ['patientId' => $patient['id'], 'requestId' => $saved['id']]);
        create_user_notification((int)$user['id'], 'clinical-request-submitted', 'Clinical request submitted', 'Your request is waiting for the nursing team.', ['requestId' => (int)$saved['id'], 'patientId' => (int)$patient['id']]);
        foreach (read_data('users') as $staffUser) {
            if (($staffUser['role'] ?? '') === 'staff') {
                create_user_notification((int)$staffUser['id'], 'clinical-review-needed', 'Clinical review needed', 'A doctor submitted an item for nursing review.', ['requestId' => (int)$saved['id'], 'patientId' => (int)$patient['id']]);
            }
        }
        respond(201, ['message' => 'Submitted for nurse review', 'request' => $saved]);
    }

    if ($method === 'POST' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'nurse-review') {
        if ($role !== 'staff') {
            respond(403, ['error' => 'Only nurses can give the second approval']);
        }

        $requestId = (int)$segments[1];
        $item = find_by_id('clinical_requests', $requestId);
        if (!$item) {
            respond(404, ['error' => 'Request not found']);
        }
        if (($item['status'] ?? '') !== 'awaiting_nurse') {
            respond(409, ['error' => 'This request is not waiting for nurse review']);
        }

        $decision = trim((string)($body['decision'] ?? ''));
        $history = $item['history'] ?? [];

        if ($decision === 'approve') {
            $stock = null;
            $needed = 0;
            if (($item['type'] ?? '') === 'medicine') {
                $stock = find_medicine_stock($item['medicine']['name'] ?? '');
                $needed = (int)($item['medicine']['quantity'] ?? 1);
                if (!$stock) {
                    respond(409, ['error' => 'Insufficient stock. Use “Out of stock / change” and send a replacement to the doctor.']);
                }
            }

            $history[] = clinical_history_entry($user, 'nurse-approved');
            $db = get_db();
            $db->begin_transaction();
            try {
                if ($stock) {
                    $stockId = (int)$stock['id'];
                    $stockTable = get_collection_table('medicine_stock');
                    $stockQuery = $db->prepare("SELECT payload FROM `{$stockTable}` WHERE id = ? FOR UPDATE");
                    if (!$stockQuery) throw new Exception('Unable to lock stock row');
                    $stockQuery->bind_param('i', $stockId);
                    if (!$stockQuery->execute()) throw new Exception('Unable to lock stock row');
                    $lockedRow = $stockQuery->get_result()->fetch_assoc();
                    $lockedStock = $lockedRow ? json_decode($lockedRow['payload'], true) : null;
                    if (!is_array($lockedStock) || (int)($lockedStock['quantity'] ?? 0) < $needed) {
                        $db->rollback();
                        respond(409, ['error' => 'Insufficient stock. Use “Out of stock / change” and send a replacement to the doctor.']);
                    }
                    update_row('medicine_stock', $stockId, [
                        'quantity' => (int)$lockedStock['quantity'] - $needed,
                        'updatedBy' => (int)$user['id']
                    ]);
                }

                $updated = update_row('clinical_requests', $requestId, [
                    'status' => 'approved',
                    'nurseId' => (int)$user['id'],
                    'nurseName' => (string)($user['name'] ?? ''),
                    'approvedAt' => gmdate('c'),
                    'history' => $history
                ]);
                $db->commit();
            } catch (Throwable $error) {
                $db->rollback();
                error_log('Clinical approval transaction failed: ' . $error->getMessage());
                respond(500, ['error' => 'Unable to approve this request; no stock was changed']);
            }
            if ($stock) audit_event($user, 'medicine-stock-deducted', 'medicine-stock', $stock['id'], ['patientId' => $item['patientId'] ?? 0, 'requestId' => $requestId, 'stockId' => $stock['id']]);
            audit_event($user, 'clinical-request-approved', 'clinical-request', $requestId, ['patientId' => $item['patientId'] ?? 0, 'requestId' => $requestId]);
            notify_patient_contacts(find_by_id('patients', (int)($item['patientId'] ?? 0)), 'clinical-request-approved', 'Clinical update approved', 'An approved medicine request or blood result is available in the family account.', ['requestId' => $requestId]);
            respond(200, ['message' => 'Approved and released to the family account', 'request' => $updated]);
        }

        if ($decision === 'change') {
            $note = clinical_text($body['note'] ?? '', 300, true);
            if ($note === null || strlen($note) < 3) {
                respond(400, ['error' => 'Explain the change in 3-300 characters']);
            }

            $change = [
                'note' => $note,
                'by' => (string)($user['name'] ?? ''),
                'nurseId' => (int)$user['id'],
                'at' => gmdate('c')
            ];
            if (($item['type'] ?? '') === 'medicine') {
                $substitute = clinical_clean_medicine($body['substitute'] ?? null);
                if (!$substitute) {
                    respond(400, ['error' => 'A replacement medicine with dose and frequency is required']);
                }
                $change['substitute'] = $substitute;
            }

            $history[] = clinical_history_entry($user, 'nurse-requested-change', $note);
            $updated = update_row('clinical_requests', $requestId, [
                'status' => 'awaiting_doctor',
                'nurseChange' => $change,
                'history' => $history
            ]);
            audit_event($user, 'clinical-request-change-proposed', 'clinical-request', $requestId, ['patientId' => $item['patientId'] ?? 0, 'requestId' => $requestId]);
            if (!empty($item['doctorId'])) create_user_notification((int)$item['doctorId'], 'clinical-change-needs-doctor', 'Doctor approval needed', 'Nursing proposed a change to a clinical request.', ['requestId' => $requestId, 'patientId' => (int)($item['patientId'] ?? 0)]);
            respond(200, ['message' => 'Sent to the doctor for approval', 'request' => $updated]);
        }

        respond(400, ['error' => 'Decision must be approve or change']);
    }

    if ($method === 'POST' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'doctor-decision') {
        if ($role !== 'doctor') {
            respond(403, ['error' => 'Only the requesting doctor can decide on a change']);
        }

        $requestId = (int)$segments[1];
        $item = find_by_id('clinical_requests', $requestId);
        if (!$item) {
            respond(404, ['error' => 'Request not found']);
        }
        if (!in_array((int)($item['doctorId'] ?? 0), get_doctor_alias_ids((int)$user['id']), true)) {
            respond(403, ['error' => 'This request belongs to another doctor']);
        }
        if (($item['status'] ?? '') !== 'awaiting_doctor') {
            respond(409, ['error' => 'This request is not waiting for your approval']);
        }

        $decision = trim((string)($body['decision'] ?? ''));
        $history = $item['history'] ?? [];

        if ($decision === 'approve') {
            if (($item['type'] ?? '') === 'family-medicine-request') {
                $medicine = clinical_clean_medicine($body['medicine'] ?? null);
                if (!$medicine) {
                    respond(400, ['error' => 'Enter the medicine, dose and frequency before sending this request to the nurse']);
                }

                $history[] = clinical_history_entry($user, 'doctor-approved-family-request');
                $updated = update_row('clinical_requests', $requestId, [
                    'type' => 'medicine',
                    'medicine' => $medicine,
                    'status' => 'awaiting_nurse',
                    'history' => $history
                ]);
                audit_event($user, 'family-medicine-request-prescribed', 'clinical-request', $requestId, ['patientId' => $item['patientId'] ?? 0, 'requestId' => $requestId]);
                $requesterId = (int)($item['familyRequest']['requesterId'] ?? 0);
                if ($requesterId > 0) create_user_notification($requesterId, 'family-medicine-prescribed', 'Doctor reviewed medicine request', 'The doctor prescribed the requested medicine. It is now waiting for nurse approval.', ['patientId' => (int)($item['patientId'] ?? 0), 'requestId' => $requestId]);
                foreach (read_data('users') as $staffUser) {
                    if (($staffUser['role'] ?? '') === 'staff') create_user_notification((int)$staffUser['id'], 'clinical-review-needed', 'Clinical review needed', 'A doctor prescribed a medicine requested by a family member.', ['requestId' => $requestId, 'patientId' => (int)($item['patientId'] ?? 0)]);
                }
                respond(200, ['message' => 'Prescribed request sent to the nurse for second approval', 'request' => $updated]);
            }

            $updates = [
                'status' => 'approved',
                'approvedAt' => gmdate('c')
            ];
            if (!empty($item['nurseChange']['substitute'])) {
                $updates['originalMedicine'] = $item['medicine'] ?? null;
                $updates['medicine'] = $item['nurseChange']['substitute'];
            }
            if (empty($item['nurseName'])) {
                $updates['nurseId'] = (int)($item['nurseChange']['nurseId'] ?? 0);
                $updates['nurseName'] = (string)($item['nurseChange']['by'] ?? '');
            }
            $history[] = clinical_history_entry($user, 'doctor-approved-change');
            $updates['history'] = $history;
            $updated = update_row('clinical_requests', $requestId, $updates);
            audit_event($user, 'clinical-request-change-approved', 'clinical-request', $requestId, ['patientId' => $item['patientId'] ?? 0, 'requestId' => $requestId]);
            notify_patient_contacts(find_by_id('patients', (int)($item['patientId'] ?? 0)), 'clinical-request-approved', 'Clinical update approved', 'An approved medicine request or blood result is available in the family account.', ['requestId' => $requestId]);
            respond(200, ['message' => 'Change approved and released to the family account', 'request' => $updated]);
        }

        if ($decision === 'reject') {
            $history[] = clinical_history_entry($user, 'doctor-rejected-change');
            $updated = update_row('clinical_requests', $requestId, [
                'status' => 'rejected',
                'rejectedAt' => gmdate('c'),
                'history' => $history
            ]);
            audit_event($user, 'clinical-request-change-rejected', 'clinical-request', $requestId, ['patientId' => $item['patientId'] ?? 0, 'requestId' => $requestId]);
            $requesterId = (int)($item['familyRequest']['requesterId'] ?? 0);
            if ($requesterId > 0) create_user_notification($requesterId, 'family-medicine-rejected', 'Medicine request not approved', 'The doctor could not approve the medicine request. Contact the care team for follow-up.', ['patientId' => (int)($item['patientId'] ?? 0), 'requestId' => $requestId]);
            respond(200, ['message' => 'Request rejected', 'request' => $updated]);
        }

        respond(400, ['error' => 'Decision must be approve or reject']);
    }

    respond(404, ['error' => 'Route not found']);
}

function public_death_certificate($record)
{
    return [
        'id' => (int)$record['id'],
        'certificateNumber' => (string)($record['certificateNumber'] ?? ''),
        'patientName' => (string)($record['patientName'] ?? ''),
        'patientCode' => (string)($record['patientCode'] ?? ''),
        'patientAge' => $record['patientAge'] ?? null,
        'patientGender' => (string)($record['patientGender'] ?? ''),
        'patientAddress' => (string)($record['patientAddress'] ?? ''),
        'deathDate' => (string)($record['deathDate'] ?? ''),
        'deathTime' => (string)($record['deathTime'] ?? ''),
        'place' => (string)($record['place'] ?? ''),
        'cause' => (string)($record['cause'] ?? ''),
        'doctorName' => (string)($record['doctorName'] ?? ''),
        'doctorAttestedBy' => (string)($record['doctorAttestedBy'] ?? ''),
        'doctorAttestedAt' => $record['doctorAttestedAt'] ?? null,
        'approvedAt' => $record['approvedAt'] ?? null,
        'adminApprovedBy' => (string)($record['adminApprovedBy'] ?? ''),
        'reviewedBy' => (string)($record['reviewedBy'] ?? ''),
        'status' => (string)($record['status'] ?? ''),
        'officialDocument' => false
    ];
}

function handle_death_certificate_routes($method, $segments, $body)
{
    $user = require_auth(['doctor', 'admin', 'family']);
    $role = (string)$user['role'];

    if ($method === 'GET' && count($segments) === 1) {
        $records = read_data('death_certificates');
        if ($role === 'doctor') {
            $doctorIds = get_doctor_alias_ids((int)$user['id']);
            $records = array_filter($records, function ($record) use ($doctorIds) {
                return in_array((int)($record['doctorId'] ?? 0), $doctorIds, true);
            });
        } elseif ($role === 'family') {
            $patient = find_patient_for_user($user);
            $patientId = $patient ? (int)$patient['id'] : 0;
            $records = array_filter($records, function ($record) use ($patientId) {
                return $patientId > 0
                    && (int)($record['patientId'] ?? 0) === $patientId
                    && ($record['status'] ?? '') === 'approved';
            });
        }

        $records = array_values($records);
        usort($records, function ($a, $b) {
            return strcmp((string)($b['deathDate'] ?? ''), (string)($a['deathDate'] ?? ''));
        });
        if ($role === 'family') {
            $records = array_map('public_death_certificate', $records);
        }
        respond(200, $records);
    }

    if ($method === 'POST' && count($segments) === 1) {
        if ($role !== 'doctor') {
            respond(403, ['error' => 'Only the assigned doctor can submit a hospital death record']);
        }

        $patient = find_by_id('patients', (int)($body['patientId'] ?? 0));
        if (!$patient) {
            respond(404, ['error' => 'Patient not found']);
        }
        if (!in_array((int)($patient['assignedDoctor'] ?? 0), get_doctor_alias_ids((int)$user['id']), true)) {
            respond(403, ['error' => 'You can only submit a record for a patient assigned to you']);
        }
        if (($body['doctorAttested'] ?? false) !== true) {
            respond(400, ['error' => 'The attending doctor must explicitly confirm this record']);
        }

        $deathDate = trim((string)($body['deathDate'] ?? ''));
        $deathTime = trim((string)($body['deathTime'] ?? ''));
        if (!valid_iso_date($deathDate) || $deathDate > gmdate('Y-m-d')) {
            respond(400, ['error' => 'Enter a valid death date that is not in the future']);
        }
        if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $deathTime)) {
            respond(400, ['error' => 'Enter a valid 24-hour time']);
        }

        $place = clinical_text($body['place'] ?? '', 180, true);
        $cause = clinical_text($body['cause'] ?? '', 500, true);
        if ($place === null || $cause === null || strlen($cause) < 3) {
            respond(400, ['error' => 'Place and cause of death are required']);
        }

        $record = add_row('death_certificates', [
            'patientId' => (int)$patient['id'],
            'patientName' => (string)($patient['name'] ?? ''),
            'patientCode' => (string)($patient['patientCode'] ?? ''),
            'patientAge' => $patient['age'] ?? null,
            'patientGender' => (string)($patient['gender'] ?? ''),
            'patientAddress' => (string)($patient['address'] ?? ''),
            'deathDate' => $deathDate,
            'deathTime' => $deathTime,
            'place' => $place,
            'cause' => $cause,
            'doctorId' => (int)$user['id'],
            'doctorName' => (string)($user['name'] ?? ''),
            'doctorAttestedBy' => (string)($user['name'] ?? ''),
            'doctorAttestedAt' => gmdate('c'),
            'doctorAttested' => true,
            'status' => 'awaiting_admin',
            'officialDocument' => false
        ]);
        $certificateNumber = sprintf('HDC-%s-%05d', substr($deathDate, 0, 4), (int)$record['id']);
        $record = update_row('death_certificates', (int)$record['id'], ['certificateNumber' => $certificateNumber]);
        audit_event($user, 'death-record-submitted', 'death-certificate', $record['id'], ['patientId' => $patient['id']]);
        foreach (read_data('users') as $adminUser) {
            if (($adminUser['role'] ?? '') === 'admin') create_user_notification((int)$adminUser['id'], 'death-record-review', 'Death record needs review', 'A doctor submitted an attested hospital record for admin review.', ['patientId' => (int)$patient['id'], 'requestId' => (int)$record['id']]);
        }
        respond(201, ['message' => 'Hospital record submitted for admin review', 'record' => $record]);
    }

    if ($method === 'POST' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'review') {
        if ($role !== 'admin') {
            respond(403, ['error' => 'Only an admin can review this hospital record']);
        }

        $recordId = (int)$segments[1];
        $record = find_by_id('death_certificates', $recordId);
        if (!$record) {
            respond(404, ['error' => 'Hospital death record not found']);
        }
        if (($record['status'] ?? '') !== 'awaiting_admin') {
            respond(409, ['error' => 'This record is no longer waiting for review']);
        }
        if (empty($record['doctorAttested']) || empty($record['doctorAttestedAt'])) {
            respond(409, ['error' => 'The attending doctor must attest before admin approval']);
        }

        $decision = trim((string)($body['decision'] ?? ''));
        if (!in_array($decision, ['approve', 'reject'], true)) {
            respond(400, ['error' => 'Decision must be approve or reject']);
        }

        $note = clinical_text($body['note'] ?? '', 300);
        if ($note === null || ($decision === 'reject' && strlen($note) < 3)) {
            respond(400, ['error' => 'A rejection reason of 3-300 characters is required']);
        }

        $updates = [
            'status' => $decision === 'approve' ? 'approved' : 'rejected',
            'reviewedBy' => (string)($user['name'] ?? ''),
            'reviewNote' => $note,
            'reviewedAt' => gmdate('c')
        ];
        if ($decision === 'approve') {
            $updates['approvedAt'] = gmdate('c');
            $updates['adminApprovedBy'] = (string)($user['name'] ?? '');
        }
        $updated = update_row('death_certificates', $recordId, $updates);
        audit_event($user, $decision === 'approve' ? 'death-record-approved' : 'death-record-rejected', 'death-certificate', $recordId, ['patientId' => $record['patientId'] ?? 0]);
        if ($decision === 'approve') {
            notify_patient_contacts(find_by_id('patients', (int)($record['patientId'] ?? 0)), 'death-record-approved', 'Hospital record approved', 'A hospital record copy is available in the linked family account.', ['requestId' => $recordId]);
        } else {
            $doctor = find_by_id('users', (int)($record['doctorId'] ?? 0));
            if ($doctor) create_user_notification((int)$doctor['id'], 'death-record-rejected', 'Hospital record needs correction', 'Admin rejected a hospital record. Review the admin note in Death Records.', ['requestId' => $recordId]);
        }
        respond(200, ['message' => $decision === 'approve' ? 'Hospital record approved for linked family access' : 'Hospital record rejected', 'record' => $updated]);
    }

    respond(404, ['error' => 'Route not found']);
}

function normalize_medicine_name($value)
{
    return strtolower(preg_replace('/\s+/', ' ', trim((string)$value)));
}

function find_medicine_stock($name)
{
    $key = normalize_medicine_name($name);
    foreach (read_data('medicine_stock') as $item) {
        if (normalize_medicine_name($item['name'] ?? '') === $key) return $item;
    }
    return null;
}

function handle_medicine_stock_routes($method, $segments, $body)
{
    $user = require_auth(['admin', 'staff', 'doctor', 'pharmacy']);
    if ($method === 'GET' && count($segments) === 1) {
        $items = read_data('medicine_stock');
        usort($items, function ($a, $b) { return strcasecmp((string)($a['name'] ?? ''), (string)($b['name'] ?? '')); });
        respond(200, $items);
    }

    if (!in_array($user['role'], ['admin', 'staff', 'pharmacy'], true)) {
        respond(403, ['error' => 'Only pharmacy staff or admins can change medicine stock']);
    }

    if ($method === 'POST' && count($segments) === 1) {
        $name = clinical_text($body['name'] ?? '', 120, true);
        $unit = clinical_text($body['unit'] ?? '', 40, true);
        $quantity = filter_var($body['quantity'] ?? null, FILTER_VALIDATE_INT);
        $minimum = filter_var($body['minimum'] ?? 0, FILTER_VALIDATE_INT);
        if ($name === null || $unit === null || $quantity === false || $quantity < 0 || $quantity > 100000 || $minimum === false || $minimum < 0 || $minimum > 100000) {
            respond(400, ['error' => 'Enter a medicine, unit and valid stock/minimum quantities']);
        }
        if (find_medicine_stock($name)) respond(409, ['error' => 'This medicine is already in the stock list']);
        $item = add_row('medicine_stock', ['name' => $name, 'unit' => $unit, 'quantity' => $quantity, 'minimum' => $minimum, 'updatedBy' => (int)$user['id']]);
        audit_event($user, 'stock-created', 'medicine-stock', $item['id'], ['stockId' => $item['id']]);
        respond(201, ['message' => 'Medicine added to stock', 'item' => $item]);
    }

    if ($method === 'PUT' && count($segments) === 2 && is_numeric($segments[1])) {
        $item = find_by_id('medicine_stock', (int)$segments[1]);
        if (!$item) respond(404, ['error' => 'Medicine not found']);
        $quantity = filter_var($body['quantity'] ?? null, FILTER_VALIDATE_INT);
        $minimum = filter_var($body['minimum'] ?? ($item['minimum'] ?? 0), FILTER_VALIDATE_INT);
        if ($quantity === false || $quantity < 0 || $quantity > 100000 || $minimum === false || $minimum < 0 || $minimum > 100000) {
            respond(400, ['error' => 'Stock quantities must be whole numbers from 0 to 100,000']);
        }
        $updated = update_row('medicine_stock', (int)$item['id'], ['quantity' => $quantity, 'minimum' => $minimum, 'updatedBy' => (int)$user['id']]);
        audit_event($user, 'stock-adjusted', 'medicine-stock', $item['id'], ['stockId' => $item['id']]);
        respond(200, ['message' => 'Medicine stock updated', 'item' => $updated]);
    }

    respond(404, ['error' => 'Route not found']);
}

function appointment_belongs_to_user($appointment, $user)
{
    if (($user['role'] ?? '') === 'admin' || ($user['role'] ?? '') === 'staff') return true;
    if (($user['role'] ?? '') === 'doctor') {
        return in_array((int)($appointment['doctorId'] ?? 0), get_doctor_alias_ids((int)$user['id']), true);
    }
    if (($user['role'] ?? '') === 'patient') {
        return strtolower(trim((string)($appointment['patientEmail'] ?? ''))) === strtolower(trim((string)($user['email'] ?? '')));
    }
    if (($user['role'] ?? '') === 'family') {
        $patient = find_patient_for_user($user);
        return $patient && strtolower(trim((string)($appointment['patientEmail'] ?? ''))) === strtolower(trim((string)($patient['email'] ?? '')));
    }
    return false;
}

function find_patient_by_email($email)
{
    $email = strtolower(trim((string)$email));
    if ($email === '') return null;
    foreach (read_data('patients') as $patient) {
        if (strtolower(trim((string)($patient['email'] ?? ''))) === $email) return $patient;
    }
    return null;
}

function handle_notification_routes($method, $segments, $body)
{
    $user = require_auth(['admin', 'staff', 'doctor', 'patient', 'family', 'pharmacy']);

    if ($method === 'GET' && count($segments) === 1) {
        $appointments = read_data('appointments');
        $notifications = read_data('notifications');
        $timezone = new DateTimeZone('Asia/Kuala_Lumpur');
        foreach ($appointments as $appointment) {
            if (in_array($user['role'], ['admin', 'staff'], true)) continue;
            if (!appointment_belongs_to_user($appointment, $user) || in_array(($appointment['status'] ?? ''), ['Cancelled', 'Reschedule Requested'], true)) continue;
            $when = DateTimeImmutable::createFromFormat('!Y-m-d H:i', (string)($appointment['date'] ?? '') . ' ' . (string)($appointment['time'] ?? ''), $timezone);
            if (!$when) continue;
            $seconds = $when->getTimestamp() - time();
            if ($seconds < 0 || $seconds > 86400) continue;
            $exists = false;
            foreach ($notifications as $notification) {
                if ((int)($notification['userId'] ?? 0) === (int)$user['id']
                    && ($notification['type'] ?? '') === 'appointment-reminder'
                    && (int)($notification['metadata']['appointmentId'] ?? 0) === (int)$appointment['id']) {
                    $exists = true;
                    break;
                }
            }
            if (!$exists) {
                $created = create_user_notification((int)$user['id'], 'appointment-reminder', 'Upcoming appointment', 'You have an appointment within the next 24 hours.', ['appointmentId' => (int)$appointment['id']]);
                if ($created) $notifications[] = $created;
            }
        }

        $items = array_values(array_filter($notifications, function ($item) use ($user) {
            return (int)($item['userId'] ?? 0) === (int)$user['id'];
        }));
        usort($items, function ($a, $b) { return strtotime($b['createdAt'] ?? '') <=> strtotime($a['createdAt'] ?? ''); });
        respond(200, array_slice($items, 0, 100));
    }

    if ($method === 'PUT' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'read') {
        $item = find_by_id('notifications', (int)$segments[1]);
        if (!$item || (int)($item['userId'] ?? 0) !== (int)$user['id']) respond(404, ['error' => 'Notification not found']);
        $updated = update_row('notifications', (int)$item['id'], ['readAt' => gmdate('c')]);
        respond(200, ['message' => 'Notification marked as read', 'notification' => $updated]);
    }
    respond(404, ['error' => 'Route not found']);
}

function handle_audit_log_routes($method, $segments, $body)
{
    require_auth(['admin']);
    if ($method !== 'GET' || count($segments) !== 1) respond(405, ['error' => 'Method not allowed']);
    $items = read_data('audit_logs');
    usort($items, function ($a, $b) { return strtotime($b['timestamp'] ?? '') <=> strtotime($a['timestamp'] ?? ''); });
    respond(200, array_slice($items, 0, 300));
}

function user_can_access_patient($user, $patient)
{
    $role = (string)($user['role'] ?? '');
    if (in_array($role, ['admin', 'staff'], true)) return true;
    if ($role === 'doctor') return in_array((int)($patient['assignedDoctor'] ?? 0), get_doctor_alias_ids((int)$user['id']), true);
    if ($role === 'patient') return (int)($user['linkedPatientId'] ?? 0) === (int)$patient['id']
        || strtolower(trim((string)($user['email'] ?? ''))) === strtolower(trim((string)($patient['email'] ?? '')));
    if ($role === 'family') {
        $linked = find_patient_for_user($user);
        return $linked && (int)$linked['id'] === (int)$patient['id'];
    }
    return false;
}

function medical_document_summary($document)
{
    unset($document['data']);
    return $document;
}

function handle_medical_document_routes($method, $segments, $body)
{
    $user = require_auth(['admin', 'staff', 'doctor', 'family', 'patient']);
    if ($method === 'GET' && count($segments) === 1) {
        $patientId = isset($_GET['patientId']) ? (int)$_GET['patientId'] : 0;
        $records = read_data('medical_documents');
        $records = array_values(array_filter($records, function ($document) use ($user, $patientId) {
            $patient = find_by_id('patients', (int)($document['patientId'] ?? 0));
            return $patient && user_can_access_patient($user, $patient)
                && ($patientId === 0 || (int)$patient['id'] === $patientId);
        }));
        usort($records, function ($a, $b) { return strtotime($b['createdAt'] ?? '') <=> strtotime($a['createdAt'] ?? ''); });
        respond(200, array_map('medical_document_summary', $records));
    }

    if ($method === 'POST' && count($segments) === 1) {
        if (!in_array($user['role'], ['admin', 'staff', 'doctor'], true)) respond(403, ['error' => 'Only care team members can upload medical documents']);
        $patient = find_by_id('patients', (int)($body['patientId'] ?? 0));
        if (!$patient) respond(404, ['error' => 'Patient not found']);
        if (!user_can_access_patient($user, $patient)) respond(403, ['error' => 'You cannot upload documents for this patient']);

        $data = trim((string)($body['data'] ?? ''));
        if (strpos($data, 'base64,') !== false) $data = substr($data, strpos($data, 'base64,') + 7);
        $binary = base64_decode($data, true);
        if ($binary === false || strlen($binary) === 0 || strlen($binary) > 4 * 1024 * 1024) {
            respond(400, ['error' => 'File must be a non-empty PDF, JPG or PNG no larger than 4 MB']);
        }

        $mime = '';
        if (substr($binary, 0, 5) === '%PDF-') $mime = 'application/pdf';
        elseif (substr($binary, 0, 8) === "\x89PNG\r\n\x1a\n") $mime = 'image/png';
        elseif (substr($binary, 0, 3) === "\xff\xd8\xff") $mime = 'image/jpeg';
        if ($mime === '') respond(400, ['error' => 'Only PDF, JPG and PNG files are accepted']);

        $name = clinical_text(basename((string)($body['name'] ?? 'medical-record')), 120, true);
        $category = clinical_text($body['category'] ?? 'Other', 60, true);
        if ($name === null || $category === null) respond(400, ['error' => 'File name and category are required']);
        $document = add_row('medical_documents', [
            'patientId' => (int)$patient['id'],
            'patientName' => (string)($patient['name'] ?? ''),
            'patientCode' => (string)($patient['patientCode'] ?? ''),
            'name' => preg_replace('/[\x00-\x1F\\\/]+/', '-', $name),
            'category' => $category,
            'mime' => $mime,
            'size' => strlen($binary),
            'data' => base64_encode($binary),
            'uploadedBy' => (int)$user['id'],
            'uploadedByName' => (string)($user['name'] ?? '')
        ]);
        audit_event($user, 'medical-document-uploaded', 'medical-document', $document['id'], ['patientId' => $patient['id'], 'documentId' => $document['id']]);
        respond(201, ['message' => 'Medical document uploaded', 'document' => medical_document_summary($document)]);
    }

    if ($method === 'GET' && count($segments) === 3 && is_numeric($segments[1]) && $segments[2] === 'download') {
        $document = find_by_id('medical_documents', (int)$segments[1]);
        if (!$document) respond(404, ['error' => 'Medical document not found']);
        $patient = find_by_id('patients', (int)($document['patientId'] ?? 0));
        if (!$patient || !user_can_access_patient($user, $patient)) respond(403, ['error' => 'You cannot access this patient document']);

        $allowedMime = ['application/pdf', 'image/jpeg', 'image/png'];
        $mime = in_array(($document['mime'] ?? ''), $allowedMime, true) ? $document['mime'] : 'application/octet-stream';
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '_', (string)($document['name'] ?? 'medical-document'));
        audit_event($user, 'medical-document-downloaded', 'medical-document', $document['id'], ['patientId' => $patient['id'], 'documentId' => $document['id']]);
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . strlen(base64_decode((string)($document['data'] ?? ''), true) ?: ''));
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        echo base64_decode((string)$document['data'], true);
        exit;
    }
    respond(404, ['error' => 'Route not found']);
}

function handle_site_status_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 1) {
        $settings = read_data('site_settings');
        $current = $settings[0] ?? [];
        respond(200, [
            'mourningMode' => !empty($current['mourningMode']),
            'memorialName' => (string)($current['memorialName'] ?? ''),
            'updatedAt' => (string)($current['updatedAt'] ?? '')
        ]);
    }

    $admin = require_auth(['admin']);
    if ($method !== 'POST' || count($segments) !== 1) {
        respond(405, ['error' => 'Method not allowed']);
    }

    $mourningMode = !empty($body['mourningMode']);
    $memorialName = trim((string)($body['memorialName'] ?? ''));
    $notice = trim((string)($body['notice'] ?? ''));
    if (strlen($memorialName) > 160 || strlen($notice) > 500) {
        respond(400, ['error' => 'Memorial name or notice is too long']);
    }
    if ($mourningMode && $memorialName === '' && $notice === '') {
        respond(400, ['error' => 'Add a memorial name or notice before enabling mourning mode']);
    }

    $settings = read_data('site_settings');
    $values = [
        'mourningMode' => $mourningMode,
        'memorialName' => $mourningMode ? $memorialName : '',
        'notice' => $mourningMode ? $notice : '',
        'updatedBy' => (int)$admin['id'],
        'updatedAt' => gmdate('c')
    ];
    if (!empty($settings)) {
        $saved = update_row('site_settings', (int)$settings[0]['id'], $values);
    } else {
        $saved = add_row('site_settings', $values);
    }

    respond(200, [
        'message' => $mourningMode ? 'Mourning mode enabled' : 'Mourning mode disabled',
        'siteStatus' => [
            'mourningMode' => !empty($saved['mourningMode']),
            'memorialName' => (string)($saved['memorialName'] ?? ''),
            'notice' => (string)($saved['notice'] ?? ''),
            'updatedAt' => (string)($saved['updatedAt'] ?? '')
        ]
    ]);
}

function handle_bulletin_routes($method, $segments, $body)
{
    if ($method === 'GET' && count($segments) === 1) {
        $bulletins = array_values(array_filter(read_data('bulletins'), function ($item) {
            return !empty($item['published']);
        }));
        usort($bulletins, function ($a, $b) {
            return strtotime($b['publishedAt'] ?? $b['createdAt'] ?? '') <=> strtotime($a['publishedAt'] ?? $a['createdAt'] ?? '');
        });
        respond(200, $bulletins);
    }

    if ($method === 'GET' && count($segments) === 2 && $segments[1] === 'manage') {
        require_auth(['admin']);
        $bulletins = read_data('bulletins');
        usort($bulletins, function ($a, $b) {
            return strtotime($b['updatedAt'] ?? $b['createdAt'] ?? '') <=> strtotime($a['updatedAt'] ?? $a['createdAt'] ?? '');
        });
        respond(200, $bulletins);
    }

    $admin = require_auth(['admin']);
    $allowedCategories = ['General', 'Service Update', 'Event', 'Health Information'];

    if ($method === 'POST' && count($segments) === 1) {
        $title = trim((string)($body['title'] ?? ''));
        $content = trim((string)($body['content'] ?? ''));
        $category = trim((string)($body['category'] ?? 'General'));
        $published = !empty($body['published']);

        if (strlen($title) < 3 || strlen($title) > 160 || $content === '' || strlen($content) > 5000) {
            respond(400, ['error' => 'Title must be 3-160 characters and content 1-5,000 characters']);
        }
        if (!in_array($category, $allowedCategories, true)) {
            $category = 'General';
        }

        $bulletin = add_row('bulletins', [
            'title' => $title,
            'content' => $content,
            'category' => $category,
            'published' => $published,
            'publishedAt' => $published ? gmdate('c') : null,
            'createdBy' => (int)$admin['id']
        ]);
        respond(201, ['message' => 'Bulletin created', 'bulletin' => $bulletin]);
    }

    if ($method === 'PUT' && count($segments) === 2 && is_numeric($segments[1])) {
        $bulletinId = (int)$segments[1];
        $existing = find_by_id('bulletins', $bulletinId);
        if (!$existing) {
            respond(404, ['error' => 'Bulletin not found']);
        }

        $title = trim((string)($body['title'] ?? ''));
        $content = trim((string)($body['content'] ?? ''));
        $category = trim((string)($body['category'] ?? 'General'));
        $published = !empty($body['published']);
        if (strlen($title) < 3 || strlen($title) > 160 || $content === '' || strlen($content) > 5000) {
            respond(400, ['error' => 'Title must be 3-160 characters and content 1-5,000 characters']);
        }
        if (!in_array($category, $allowedCategories, true)) {
            $category = 'General';
        }

        $updated = update_row('bulletins', $bulletinId, [
            'title' => $title,
            'content' => $content,
            'category' => $category,
            'published' => $published,
            'publishedAt' => $published ? ($existing['publishedAt'] ?? gmdate('c')) : null,
            'updatedBy' => (int)$admin['id']
        ]);
        respond(200, ['message' => 'Bulletin updated', 'bulletin' => $updated]);
    }

    if ($method === 'DELETE' && count($segments) === 2 && is_numeric($segments[1])) {
        if (!delete_row('bulletins', (int)$segments[1])) {
            respond(404, ['error' => 'Bulletin not found']);
        }
        respond(200, ['message' => 'Bulletin deleted']);
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
    foreach (['users', 'patients', 'messages', 'appointments', 'organ_donors', 'leaves', 'bulletins', 'site_settings', 'clinical_requests', 'death_certificates', 'medicine_stock', 'notifications', 'audit_logs', 'medical_documents'] as $collection) {
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
