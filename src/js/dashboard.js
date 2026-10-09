// Dashboard Module
let ws = null;
let reconnectAttempts = 0;
let realtimePollTimer = null;
let codeBluePollTimer = null;
let notificationPollTimer = null;
let currentDoctorChatPatient = null;
let liveVitalsTimer = null;
let doctorRealtimeTimer = null;
let doctorPatientCache = [];
let doctorAssignedCache = [];
let doctorDirectory = [];
let patientAssignedDoctorId = null;
let staffPatientCache = [];
let staffAppointmentCache = [];
let doctorLeaveCache = [];
let adminBulletinsCache = [];
let patientVitalsHistory = [];
let patientVitalsAlertSignature = '';
let doctorVitalsHistoryByPatient = {};
let medicineStockCache = [];
let doctorEcgStateByPatient = {};
const familyDemoVitalsByPatient = new Map();
let familyHospitalAlertSignature = '';
const MAX_RECONNECT_ATTEMPTS = 5;
const CODE_BLUE_POLL_MS = 5000;
const RATE_LIMIT_BACKOFF_MS = 60000;
let pollPausedUntil = 0;
let codeBluePollInFlight = false;
let realtimePollInFlight = false;

function canPollNow() {
    return !document.hidden && Date.now() >= pollPausedUntil;
}

function noteRateLimit(response) {
    if (response && response.status === 429) {
        pollPausedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
}
const MAX_PATIENT_HISTORY_POINTS = 18;

function resolveApiBase() {
    const runtimeBase = window.APP_RUNTIME_CONFIG && typeof window.APP_RUNTIME_CONFIG.apiBase === 'string'
        ? window.APP_RUNTIME_CONFIG.apiBase.trim()
        : '';

    if (runtimeBase !== '') {
        return runtimeBase.replace(/\/+$/, '');
    }

    const pathName = window.location.pathname || '/';
    const apiIndex = pathName.indexOf('/api/');

    if (apiIndex !== -1) {
        return `${window.location.origin}${pathName.substring(0, apiIndex)}/api`;
    }

    const segments = pathName.split('/').filter(Boolean);
    if (!segments.length) {
        return `${window.location.origin}/api`;
    }

    const first = segments[0];
    const rootLikeFolders = ['src', 'pages', 'js', 'css', 'images', 'assets', 'api'];

    if (first.includes('.') || rootLikeFolders.includes(first.toLowerCase())) {
        return `${window.location.origin}/api`;
    }

    return `${window.location.origin}/${first}/api`;
}

const DASHBOARD_API_BASE = resolveApiBase();

// Initialize WebSocket for real-time updates
function initWebSocket() {
    if (!isLoggedIn()) return;

    if (realtimePollTimer) {
        clearInterval(realtimePollTimer);
    }

    if (codeBluePollTimer) {
        clearInterval(codeBluePollTimer);
    }

    // Dedicated fast Code Blue polling for near-instant popup across all dashboards.
    pollCodeBlueAlerts();
    codeBluePollTimer = setInterval(async () => {
        if (!canPollNow() || codeBluePollInFlight) return;
        codeBluePollInFlight = true;
        try {
            await pollCodeBlueAlerts();
        } finally {
            codeBluePollInFlight = false;
        }
    }, CODE_BLUE_POLL_MS);

    // XAMPP mode fallback: poll APIs for fresh data instead of WebSocket.
    realtimePollTimer = setInterval(async () => {
        if (!canPollNow() || realtimePollInFlight) return;
        realtimePollInFlight = true;
        try {
            await refreshRoleDashboard();
        } finally {
            realtimePollInFlight = false;
        }
    }, 20000);
}

async function refreshRoleDashboard() {
    const role = currentUser.role;

    if (role === 'doctor') {
        await loadDoctorDashboard();
    } else if (role === 'staff') {
        await loadStaffDashboard();
    } else if (role === 'pharmacy') {
        await loadPharmacyDashboard();
    } else if (role === 'admin') {
        await loadAdminDashboard();
    } else if (role === 'patient') {
        await loadPatientDashboard();
    } else if (role === 'family') {
        await loadFamilyDashboard();
    }
}

function getCodeBlueSeenKey() {
    return `codeBlueSeenAt:${currentUser.id || 'guest'}`;
}

function getFamilyLinkedPatientContext() {
    if (!currentUser || currentUser.role !== 'family') {
        return null;
    }

    return {
        patientId: Number(currentUser.linkedPatientId || 0),
        patientName: String(currentUser.linkedPatientName || '').trim().toLowerCase(),
        patientEmail: String(currentUser.linkedPatientEmail || currentUser.email || '').trim().toLowerCase()
    };
}

function messageMatchesLinkedPatient(message, familyContext) {
    if (!message || !familyContext) {
        return true;
    }

    const metadata = message.metadata || {};
    const patientId = Number(metadata.patientId || 0);
    const patientName = String(metadata.patientName || '').trim().toLowerCase();
    const patientEmail = String(metadata.patientEmail || '').trim().toLowerCase();

    if (familyContext.patientId > 0 && patientId > 0 && familyContext.patientId === patientId) {
        return true;
    }

    if (familyContext.patientName && patientName && familyContext.patientName === patientName) {
        return true;
    }

    if (familyContext.patientEmail && patientEmail && familyContext.patientEmail === patientEmail) {
        return true;
    }

    return false;
}

async function pollCodeBlueAlerts() {
    if (!isLoggedIn()) return;

    try {
        const response = await apiCall('/messages/group/all');
        noteRateLimit(response);
        if (!response || !response.ok) return;

        const messages = await response.json();
        if (!Array.isArray(messages) || !messages.length) return;

        const familyContext = getFamilyLinkedPatientContext();
        const relevantMessages = familyContext
            ? messages.filter((item) => item && item.type === 'code-blue' && messageMatchesLinkedPatient(item, familyContext))
            : messages.filter((item) => item && item.type === 'code-blue');

        const latestCodeBlue = [...relevantMessages]
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0];

        if (!latestCodeBlue) return;

        const latestTs = new Date(latestCodeBlue.timestamp || 0).getTime();
        if (!latestTs) return;

        const storageKey = getCodeBlueSeenKey();
        const seenTs = Number(localStorage.getItem(storageKey) || 0);
        if (latestTs <= seenTs) return;

        const metadata = latestCodeBlue.metadata || {};
        const patientLine = metadata.patientName ? `Patient: ${metadata.patientName}` : 'Patient: General emergency';
        const roomLine = metadata.roomNumber ? `Room: ${metadata.roomNumber}` : 'Room: Not specified';
        const noteLine = metadata.note ? `Note: ${metadata.note}` : 'Note: Immediate assistance required';
        const displayMessage = `${latestCodeBlue.content}\n${patientLine} | ${roomLine} | ${noteLine}`;

        showCodeBlueOverlay(displayMessage);
        showNotification(`🚨 CODE BLUE: ${patientLine} • ${roomLine}`, 'danger');
        localStorage.setItem(storageKey, String(latestTs));
    } catch (error) {
        console.error('Error polling Code Blue alerts:', error);
    }
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'patient-updated':
            updatePatientInUI(data.patient);
            showNotification(`Patient ${data.patient.name} updated by ${data.updatedBy}`, 'info');
            break;
        case 'vitals-updated':
            updateVitalsInUI(data.patient);
            showNotification(`Vitals updated for ${data.patient.name}`, 'info');
            break;
        case 'severity-updated':
            showNotification(`🚨 Severity: ${data.patientName} is now ${data.severity}!`, 'warning');
            refreshPatientList();
            break;
        case 'code-blue':
            showNotification(`🚨 CODE BLUE: ${data.alert.message}`, 'danger');
            showCodeBlueOverlay(data.alert.message || 'Immediate assistance is required.');
            break;
        case 'message':
            handleNewMessage(data.message);
            break;
    }
}

function appendChatMessage(message, targetId) {
    const container = document.getElementById(targetId);
    if (!container) return;

    const sender = message.senderName || 'Unknown';
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageClass = message.senderId === currentUser.id ? 'chat-bubble outgoing' : 'chat-bubble incoming';

    container.insertAdjacentHTML('beforeend', `
        <div class="${messageClass}">
            <div class="chat-sender">${sender}</div>
            <div class="chat-text">${message.content}</div>
            <div class="chat-time">${time}</div>
        </div>
    `);
    container.scrollTop = container.scrollHeight;
}

function handleNewMessage(message) {
    if (!message) return;

    if (message.groupId === 'doctor') {
        appendChatMessage(message, 'doctor-chat');
    }

    if (message.groupId === 'staff') {
        appendChatMessage(message, 'doctor-staff-chat');
        appendChatMessage(message, 'staff-chat');
    }

    if (message.recipientId === currentUser.id || message.senderId === currentUser.id) {
        appendChatMessage(message, 'patient-chat');
    }
}


// Show notification
function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="close-notification">✕</button>
    `;

    notification.querySelector('.close-notification').addEventListener('click', () => {
        notification.remove();
    });

    container.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => notification.remove(), 5000);
}

async function loadUserNotifications() {
    if (!isLoggedIn() || document.hidden) return;
    try {
        const response = await apiCall('/notifications');
        if (!response || !response.ok) return;
        const items = await response.json();
        if (!Array.isArray(items)) return;

        const unread = items.filter((item) => !item.readAt).length;
        const count = document.getElementById('notification-unread-count');
        const dot = document.getElementById('notification-unread-dot');
        if (count) {
            count.textContent = String(unread);
            count.hidden = unread === 0;
        }
        if (dot) dot.hidden = unread === 0;

        const list = document.getElementById('notification-list');
        if (!list) return;
        if (!items.length) {
            list.replaceChildren(clinicalEl('p', 'muted-text', 'No notifications yet.'));
            return;
        }
        list.replaceChildren(...items.slice(0, 30).map((item) => {
            const card = clinicalEl('article', `notification-item${item.readAt ? ' is-read' : ' is-unread'}`);
            const copy = clinicalEl('div');
            copy.append(clinicalEl('strong', '', item.title || 'Notification'));
            copy.append(clinicalEl('p', '', item.message || ''));
            copy.append(clinicalEl('time', '', item.createdAt ? new Date(item.createdAt).toLocaleString() : ''));
            card.append(copy);
            if (!item.readAt) {
                const read = clinicalEl('button', 'notification-mark-read', 'Mark read');
                read.type = 'button';
                read.addEventListener('click', () => markNotificationRead(item.id));
                card.append(read);
            }
            return card;
        }));
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

async function markNotificationRead(notificationId) {
    try {
        const response = await apiCall(`/notifications/${notificationId}/read`, { method: 'PUT', body: JSON.stringify({}) });
        if (response && response.ok) await loadUserNotifications();
    } catch (error) {
        console.error('Error marking notification read:', error);
    }
}

function toggleNotifications(forceOpen) {
    const drawer = document.getElementById('notification-drawer');
    const button = document.getElementById('notification-toggle');
    if (!drawer) return;
    drawer.hidden = typeof forceOpen === 'boolean' ? !forceOpen : !drawer.hidden;
    button?.setAttribute('aria-expanded', String(!drawer.hidden));
    if (!drawer.hidden) loadUserNotifications();
}

function normalizeContactName(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

async function findLinkedFamilyContacts(patient) {
    if (!patient) return [];

    try {
        const response = await apiCall('/users');
        if (!response || !response.ok) return [];

        const users = await response.json();
        const patientEmail = String(patient.email || '').trim().toLowerCase();
        const patientName = normalizeContactName(patient.name || '');

        return (users || []).filter((user) => {
            if ((user.role || '').toLowerCase() !== 'family') return false;
            const linkedId = Number(user.linkedPatientId || user.linkedPatient || 0);
            const linkedEmail = String(user.linkedPatientEmail || '').trim().toLowerCase();
            const linkedName = normalizeContactName(user.linkedPatientName || '');
            const matchesById = Number(patient.id) > 0 && linkedId === Number(patient.id);
            const matchesByEmail = patientEmail !== '' && linkedEmail !== '' && patientEmail === linkedEmail;
            const matchesByName = patientName !== '' && linkedName !== '' && patientName === linkedName;
            return matchesById || matchesByEmail || matchesByName;
        }).filter((user) => String(user.phone || user.familyPhone || '').trim() !== '');
    } catch (error) {
        console.error('Unable to load family contacts:', error);
        return [];
    }
}

function openBirdContact(phoneNumber, messageText) {
    const cleanNumber = String(phoneNumber || '').replace(/\D/g, '');
    if (!cleanNumber) return false;

    const encodedMessage = encodeURIComponent(messageText || 'Emergency alert');
    const birdUrl = `sms:${cleanNumber}?body=${encodedMessage}`;
    window.open(birdUrl, '_blank');
    return true;
}

async function triggerFamilyCodeBlueContact(patient, roomNumber, note) {
    if (!patient) return;

    const roomText = roomNumber ? ` Room: ${roomNumber}` : ' Room: not specified';
    const noteText = note ? ` Note: ${note}` : '';
    const messageText = `CODE BLUE emergency for ${patient.name}${roomText}.${noteText} Please contact the clinical team immediately.`;

    const patientPhone = String(patient.phone || '').replace(/\D/g, '');
    if (patientPhone) {
        const opened = openBirdContact(patientPhone, messageText);
        if (opened) {
            showNotification('Family alert sent using the registered patient phone number.', 'danger');
        }
        return;
    }

    const familyContacts = await findLinkedFamilyContacts(patient);
    if (!familyContacts.length) {
        showNotification('No linked patient or family contact number was found for this emergency alert.', 'warning');
        return;
    }

    let sentCount = 0;
    familyContacts.forEach((familyContact) => {
        const opened = openBirdContact(familyContact.phone || familyContact.familyPhone, messageText);
        if (opened) sentCount += 1;
    });

    if (sentCount > 0) {
        showNotification(`Family alert sent to ${sentCount} linked contact${sentCount > 1 ? 's' : ''}.`, 'danger');
    } else {
        showNotification('No valid contact number was available for Bird/SMS contact.', 'warning');
    }
}

// Initialize dashboard
async function initializeDashboard() {
    if (!requireAuth()) return;

    const role = new URLSearchParams(window.location.search).get('role') || currentUser.role;

    if (typeof window.showRoleMenu === 'function') {
        window.showRoleMenu(role);
    }
    showDashboardRoleMenu(role);

    // Update user display
    document.getElementById('user-name').textContent = currentUser.name;
    document.getElementById('user-role').textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);

    updateDashboardHero(currentUser.name, currentUser.role);
    showRoleBasedSections(role);

    await loadDoctorDirectory();

    // Initialize WebSocket for real-time updates
    initWebSocket();
    await pollCodeBlueAlerts();
    await loadUserNotifications();
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = setInterval(loadUserNotifications, 30000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            pollCodeBlueAlerts();
            loadUserNotifications();
        }
    });

    // Load initial data
    switch (role) {
        case 'doctor':
            loadDoctorDashboard();
            break;
        case 'staff':
            loadStaffDashboard();
            break;
        case 'pharmacy':
            loadPharmacyDashboard();
            break;
        case 'admin':
            loadAdminDashboard();
            break;
        case 'patient':
            loadPatientDashboard();
            break;
        case 'family':
            loadFamilyDashboard();
            break;
    }
}

function showDashboardRoleMenu(role) {
    const menuIds = {
        doctor: ['doctor-menu', 'doctor-menu-2', 'doctor-menu-3', 'doctor-menu-4', 'doctor-menu-5', 'doctor-menu-6', 'doctor-menu-7'],
        staff: ['staff-menu', 'staff-menu-2', 'staff-menu-3'],
        pharmacy: ['pharmacy-menu'],
        admin: ['admin-menu', 'admin-menu-2', 'admin-menu-3', 'admin-menu-4', 'admin-menu-5', 'admin-menu-6', 'admin-menu-7'],
        patient: ['patient-menu', 'patient-menu-2'],
        family: ['family-menu', 'patient-menu', 'patient-menu-2']
    };

    Object.values(menuIds).flat().forEach((id) => {
        const item = document.getElementById(id);
        if (item) item.style.display = 'list-item';
    });

    Object.entries(menuIds).forEach(([menuRole, ids]) => {
        if (menuRole === role) return;
        ids.forEach((id) => {
            const item = document.getElementById(id);
            if (item) item.style.display = 'none';
        });
    });
}

async function loadDoctorDirectory() {
    try {
        const response = await apiCall('/users/role/doctor');
        if (!response || !response.ok) return;
        doctorDirectory = await response.json();
        populateDoctorSelect();
    } catch (error) {
        console.error('Error loading doctor directory:', error);
    }
}

function getDoctorById(doctorId) {
    return doctorDirectory.find((doctor) => Number(doctor.id) === Number(doctorId));
}

function getDoctorLabel(doctorId) {
    const doctor = getDoctorById(doctorId);
    if (!doctor) return 'Unassigned';
    return `${doctor.name} (${doctor.department || 'General Medicine'})`;
}

function getDoctorScheduleEntries(doctor) {
    const department = (doctor?.department || '').toLowerCase();

    if (department.includes('cardio')) {
        return [
            '09:00 - Cardiac clinic rounds and ECG review',
            '11:00 - Interventional cardiology consults',
            '14:00 - Post-procedure and hypertension follow-ups'
        ];
    }

    if (department.includes('psychiat')) {
        return [
            '09:00 - Mental health assessment clinic',
            '11:30 - Psychiatry consultation sessions',
            '14:00 - Follow-up and treatment planning reviews'
        ];
    }

    if (department.includes('neuro-oph')) {
        return [
            '09:00 - Neuro-visual pathway assessment clinic',
            '11:30 - Optic nerve and diplopia specialist session',
            '14:00 - Neuro-ophthalmology follow-up reviews'
        ];
    }

    if (department.includes('neuro')) {
        return [
            '08:00 - Neurosurgery ward review',
            '10:30 - Brain and spine operative planning',
            '14:00 - Post-op neurological monitoring rounds'
        ];
    }

    if (department.includes('surg')) {
        return [
            '08:30 - Surgical pre-op briefing',
            '11:00 - Theatre supervision and operative block',
            '15:00 - Surgical follow-up outpatient review'
        ];
    }

    return [
        '09:00 - General specialist assessment',
        '11:00 - Treatment planning and diagnostics',
        '14:30 - Follow-up and continuity of care rounds'
    ];
}

function populateDoctorSelect() {
    const doctorSelect = document.getElementById('new-patient-doctor');
    if (!doctorSelect) return;

    const previousSelection = doctorSelect.value;
    const renderList = doctorDirectory;
    doctorSelect.innerHTML = '<option value="">-- Select doctor --</option>' +
        renderList.map((doctor) => `<option value="${doctor.id}">${doctor.name} (${doctor.department || 'General Medicine'})</option>`).join('');

    if (previousSelection && renderList.some((doctor) => String(doctor.id) === String(previousSelection))) {
        doctorSelect.value = previousSelection;
    }
}

function updateDashboardHero(name, role) {
    const title = document.getElementById('dashboard-welcome');
    const detail = document.getElementById('dashboard-welcome-detail');
    if (!title || !detail) return;

    const formattedRole = role === 'doctor'
        ? 'Doctor'
        : role.charAt(0).toUpperCase() + role.slice(1);

    title.textContent = `Welcome back, ${formattedRole}`;
    detail.textContent = `Good day, ${name}. Your ${formattedRole} dashboard is ready with the latest patient updates.`;
}

// Show sections based on user role
function showRoleBasedSections(role) {
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.remove('active'));

    const roleSection = document.getElementById(`${role}-section`);
    if (roleSection) {
        roleSection.classList.add('active');
    }
}

// DOCTOR DASHBOARD
async function loadDoctorDashboard() {
    try {
        const [assignedRes, messagesRes, appointmentsRes, leavesRes] = await Promise.all([
            apiCall(`/patients/doctor/${currentUser.id}`),
            apiCall('/messages/group/doctor'),
            apiCall(`/appointments/doctor/${currentUser.id}`),
            apiCall(`/leaves/doctor/${currentUser.id}`)
        ]);

        if (!assignedRes || !assignedRes.ok) return;

        const assignedPatients = await assignedRes.json();
        const messages = messagesRes && messagesRes.ok ? await messagesRes.json() : [];
        const appointments = appointmentsRes && appointmentsRes.ok ? await appointmentsRes.json() : [];
        const leaves = leavesRes && leavesRes.ok ? await leavesRes.json() : [];
        const doctorProfile = getDoctorById(currentUser.id) || {
            name: currentUser.name,
            department: currentUser.department || 'General Medicine'
        };

        displayDoctorPatients(assignedPatients);
        displayDoctorStats(assignedPatients);
        displayDoctorMessages(messages);
        displayDoctorAppointments(appointments, doctorProfile);
        loadDoctorAppointmentReschedules(appointments);
        displayDoctorAppointmentCalendar(appointments, 'doctor-appointment-calendar');
        displayDoctorAppointmentCalendar(appointments, 'doctor-main-appointment-calendar');
        displayDoctorLeaves(leaves);
        renderDoctorOperationSchedule(doctorProfile);
        startLivePatientTelemetry(assignedPatients);
        loadDoctorClinicalRequests(assignedPatients);
        loadDoctorDeathRecords(assignedPatients);
        loadMedicineStock('doctor-medicine-stock');
        loadMedicalDocuments('doctor-medical-document-list');
    } catch (error) {
        console.error('Error loading doctor dashboard:', error);
    }
}

function displayDoctorAppointments(appointments, doctorProfile) {
    const container = document.getElementById('doctor-appointments-list');
    if (!container) return;

    if (!appointments || !appointments.length) {
        const emptyState = '<p class="muted-text">No appointments assigned yet for your doctor account.</p>';
        container.innerHTML = emptyState;
        return;
    }

    const sorted = [...appointments].sort((a, b) => (`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`));
    container.innerHTML = `
        <p class="muted-text">${doctorProfile.name} • ${doctorProfile.department || 'Specialist'}</p>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map((item) => `
                    <tr>
                        <td>${item.date}</td>
                        <td>${item.time}</td>
                        <td>${item.patientName}</td>
                        <td>${item.patientPhone}</td>
                        <td>${item.status || 'Scheduled'}</td>
                        <td><button class="btn btn-small btn-danger" onclick="deleteDoctorAppointment(${item.id})">Delete</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function displayDoctorAppointmentCalendar(appointments, targetId = 'doctor-appointment-calendar') {
    const container = document.getElementById(targetId);
    if (!container) return;

    if (!appointments || !appointments.length) {
        container.innerHTML = '<h3>Appointment calendar</h3><p class="muted-text">No booked patient appointments to show on the calendar.</p>';
        return;
    }

    const byDate = appointments.reduce((groups, appointment) => {
        const date = appointment.date || 'Unknown date';
        groups[date] = groups[date] || [];
        groups[date].push(appointment);
        return groups;
    }, {});

    container.innerHTML = `
        <h3>Appointment calendar</h3>
        <div class="doctor-calendar-grid">
            ${Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => `
                <article class="doctor-calendar-day">
                    <strong>${date}</strong>
                    ${items.sort((a, b) => (a.time || '').localeCompare(b.time || '')).map((item) => `
                        <div class="doctor-calendar-entry">
                            <span>${item.time || '-'}</span>
                            <span>${item.patientName || 'Patient'}</span>
                        </div>
                    `).join('')}
                </article>
            `).join('')}
        </div>
    `;
}

function displayDoctorLeaves(leaves) {
    const container = document.getElementById('doctor-leave-list');
    if (!container) return;
    doctorLeaveCache = Array.isArray(leaves) ? leaves : [];

    if (!leaves || !leaves.length) {
        container.innerHTML = '<p class="muted-text">No leave requests submitted yet.</p>';
        return;
    }

    container.innerHTML = [...leaves].reverse().map((leave) => `
        <div class="leave-row">
            <div>
                <strong>${leave.startDate} to ${leave.endDate}</strong>
                <span>${leave.reason}</span>
                ${leave.status === 'Approved' ? `<button class="btn btn-small leave-letter-button" onclick="printDoctorLeaveLetter(${leave.id})">Print Approval Letter</button>` : ''}
            </div>
            <span class="leave-status leave-status-${String(leave.status || 'Pending').toLowerCase()}">${leave.status || 'Pending'}</span>
        </div>
    `).join('');
}

function printDoctorLeaveLetter(leaveId) {
    const leave = doctorLeaveCache.find((item) => Number(item.id) === Number(leaveId));
    if (!leave || leave.status !== 'Approved') {
        showNotification('The approval letter is available after admin approval.', 'warning');
        return;
    }

    const printWindow = window.open('', '_blank', 'width=850,height=900');
    if (!printWindow) {
        showNotification('Please allow pop-ups to print the approval letter.', 'warning');
        return;
    }

    const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));

    printWindow.document.write(`<!DOCTYPE html>
        <html><head><title>Leave Approval Letter</title>
        <style>
            body { margin: 0; padding: 48px; color: #15353a; font-family: Georgia, serif; background: #fffdf8; }
            .letter { max-width: 720px; margin: 0 auto; padding: 56px; border: 1px solid #d9c4a8; background: #fffdf8; }
            .brand { color: #c56f43; font: 700 12px Arial, sans-serif; letter-spacing: 3px; text-transform: uppercase; }
            h1 { margin: 12px 0 42px; font-size: 34px; font-weight: 500; }
            .date { text-align: right; color: #71827f; font: 14px Arial, sans-serif; }
            p { font-size: 17px; line-height: 1.8; }
            .details { margin: 28px 0; padding: 20px 24px; border-left: 4px solid #c56f43; background: #f4eee5; font: 15px Arial, sans-serif; line-height: 2; }
            .signature { margin-top: 52px; font: 14px Arial, sans-serif; }
            .signature strong { display: block; margin-top: 8px; font-size: 17px; color: #15353a; }
            @media print { body { padding: 0; } .letter { border: 0; } }
        </style></head><body><main class="letter">
            <div class="date">Approved: ${escapeHtml(leave.reviewedAt ? new Date(leave.reviewedAt).toLocaleDateString() : new Date().toLocaleDateString())}</div>
            <div class="brand">The Protocol Cardiology</div>
            <h1>Leave Approval Letter</h1>
            <p>Dear Dr. ${escapeHtml((leave.doctorName || '').replace(/^Dr\.\s*/i, ''))},</p>
            <p>This letter confirms that your leave request has been reviewed and approved by Hospital Administration.</p>
            <div class="details">
                <strong>Doctor:</strong> ${escapeHtml(leave.doctorName)}<br>
                <strong>Leave period:</strong> ${escapeHtml(leave.startDate)} to ${escapeHtml(leave.endDate)}<br>
                <strong>Reason:</strong> ${escapeHtml(leave.reason)}<br>
                <strong>Status:</strong> Approved<br>
                <strong>Approved by:</strong> ${escapeHtml(leave.reviewedBy || 'Hospital Administration')}
            </div>
            <p>Please coordinate any patient handover with the clinical team before the approved leave period begins.</p>
            <div class="signature">Authorised by<strong>${escapeHtml(leave.reviewedBy || 'Hospital Administration')}</strong>The Protocol Hospital Management</div>
        </main><script>window.onload = function () { window.print(); };</script></body></html>`);
    printWindow.document.close();
}

async function submitDoctorLeave(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
        startDate: document.getElementById('leave-start-date').value,
        endDate: document.getElementById('leave-end-date').value,
        reason: document.getElementById('leave-reason').value.trim()
    };

    try {
        const response = await apiCall('/leaves', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to submit leave request.', 'danger');
            return;
        }
        form.reset();
        showNotification('Leave request sent to admin for approval.', 'success');
        await loadDoctorDashboard();
    } catch (error) {
        console.error('Error submitting leave request:', error);
        showNotification('Unable to submit leave request right now.', 'danger');
    }
}

async function deleteDoctorAppointment(appointmentId) {
    const confirmed = window.confirm('Delete this appointment from your doctor list?');
    if (!confirmed) return;

    try {
        const response = await apiCall(`/appointments/${appointmentId}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            showNotification('Appointment deleted successfully.', 'success');
            loadDoctorDashboard();
            return;
        }

        const errorData = response ? await response.json().catch(() => ({})) : {};
        showNotification(errorData.error || 'Unable to delete appointment.', 'danger');
    } catch (error) {
        console.error('Error deleting appointment:', error);
        showNotification('Unable to delete appointment right now.', 'danger');
    }
}

function renderDoctorOperationSchedule(doctorProfile) {
    const list = document.getElementById('doctor-operations-list');
    if (!list) return;

    const entries = getDoctorScheduleEntries(doctorProfile);
    list.innerHTML = entries.map((entry) => `<li>${entry}</li>`).join('');
}

function generateLiveVitals(patient) {
    const severity = (patient?.severity || 'Moderate').toLowerCase();
    const profiles = {
        critical: { hr: 122, rr: 24, o2: 91, temp: 38.7 },
        severe: { hr: 102, rr: 20, o2: 94, temp: 37.9 },
        moderate: { hr: 84, rr: 17, o2: 96, temp: 37.3 },
        mild: { hr: 72, rr: 15, o2: 98, temp: 36.9 }
    };

    const profile = profiles[severity] || profiles.moderate;
    const history = doctorVitalsHistoryByPatient[patient.id] || [];
    const previous = history.length ? history[history.length - 1] : null;
    const previousHr = Number(previous?.heartRate);
    const previousRr = Number(previous?.respiratoryRate);
    const previousO2 = Number(previous?.oxygenSaturation);
    const baseHr = Number.isFinite(previousHr) ? previousHr : profile.hr;
    const baseRr = Number.isFinite(previousRr) ? previousRr : profile.rr;
    const baseO2 = Number.isFinite(previousO2) ? previousO2 : profile.o2;

    const heartRate = Math.max(52, Math.min(140, baseHr + Math.round((Math.random() - 0.5) * 8)));
    const respiratoryRate = Math.max(10, Math.min(30, baseRr + Math.round((Math.random() - 0.5) * 3)));
    const oxygenSaturation = Math.max(88, Math.min(100, baseO2 + Math.round((Math.random() - 0.5) * 2)));
    const temperature = Number((profile.temp + (Math.random() - 0.5) * 0.4).toFixed(1));
    const systolic = Math.max(90, Math.min(180, 100 + Math.round(Math.random() * 40)));
    const diastolic = Math.max(55, Math.min(110, 62 + Math.round(Math.random() * 28)));

    return {
        temperature,
        bloodPressure: `${systolic}/${diastolic}`,
        heartRate,
        respiratoryRate,
        oxygenSaturation,
        lastUpdated: new Date().toISOString()
    };
}

function withResolvedVitals(patient) {
    const existing = patient?.vitals || {};
    const hasTelemetry = Number.isFinite(Number(existing.heartRate))
        && Number.isFinite(Number(existing.respiratoryRate))
        && Number.isFinite(Number(existing.oxygenSaturation));

    return {
        ...patient,
        vitals: hasTelemetry
            ? {
                ...existing,
                lastUpdated: existing.lastUpdated || new Date().toISOString()
            }
            : {
                ...existing,
                ...generateLiveVitals(patient)
            }
    };
}

function startLivePatientTelemetry(patients) {
    doctorPatientCache = patients;

    if (liveVitalsTimer) {
        clearInterval(liveVitalsTimer);
    }

    startDoctorRealtimeFeed();
}

function vitalsFeedSignature(patients) {
    return (patients || []).map((patient) => {
        const v = patient?.vitals || {};
        return [
            patient?.id || 0,
            patient?.severity || '',
            v?.temperature ?? '',
            v?.bloodPressure ?? '',
            v?.heartRate ?? '',
            v?.respiratoryRate ?? '',
            v?.oxygenSaturation ?? '',
            v?.lastUpdated ?? ''
        ].join(':');
    }).join('|');
}

async function refreshDoctorRealtimePatients() {
    if (!isLoggedIn() || currentUser.role !== 'doctor') return;

    try {
        const response = await apiCall(`/patients/doctor/${currentUser.id}`);
        if (!response || !response.ok) return;

        const latest = await response.json();
        const resolved = latest.map(withResolvedVitals);
        const nextSig = vitalsFeedSignature(resolved);
        const currentSig = vitalsFeedSignature(doctorPatientCache);

        doctorPatientCache = resolved;
        if (nextSig !== currentSig) {
            displayDoctorPatients(resolved);
            displayDoctorStats(resolved);
            return;
        }

        // Even when payload is unchanged, keep monitor view moving if values are simulated.
        displayDoctorPatients(resolved);
    } catch (error) {
        console.error('Error refreshing doctor realtime patients:', error);
    }
}

function startDoctorRealtimeFeed() {
    if (doctorRealtimeTimer) {
        clearInterval(doctorRealtimeTimer);
    }

    refreshDoctorRealtimePatients();
    doctorRealtimeTimer = setInterval(() => {
        if (canPollNow()) refreshDoctorRealtimePatients();
    }, 8000);
}

function displayDoctorPatients(patients) {
    const container = document.getElementById('doctor-patients');
    if (!container) return;

    container.innerHTML = patients.map(patient => {
        const vitals = patient.vitals || {};
        const hrChart = buildDoctorHrTrendSvg(patient.id, Number(vitals.heartRate));
        const bpmText = Number.isFinite(Number(vitals.heartRate)) ? `${Number(vitals.heartRate)} bpm` : 'No BPM';
        return `
            <div class="card">
                <div class="patient-header">
                    <div class="patient-info">
                        <h3>${patient.name}</h3>
                        <p><strong>Code:</strong> ${patient.patientCode}</p>
                        <p><strong>Diagnosis:</strong> ${patient.diagnosis}</p>
                        <p><strong>Category:</strong> ${patient.sicknessCategory || 'General Medicine'}</p>
                        <p><strong>Doctor:</strong> ${getDoctorLabel(patient.assignedDoctor)}</p>
                    </div>
                    <span class="severity-badge severity-${(patient.severity || 'Moderate').toLowerCase()}">
                        ${patient.severity || 'Moderate'}
                    </span>
                </div>
                
                <div class="vitals-grid">
                    <div class="vital-item">
                        <div class="label">Temp</div>
                        <div class="value">${vitals.temperature || '-'}°C</div>
                    </div>
                    <div class="vital-item">
                        <div class="label">BP</div>
                        <div class="value">${vitals.bloodPressure || '-'}</div>
                    </div>
                    <div class="vital-item">
                        <div class="label">HR</div>
                        <div class="value">${vitals.heartRate || '-'}</div>
                    </div>
                    <div class="vital-item">
                        <div class="label">RR</div>
                        <div class="value">${vitals.respiratoryRate || '-'}</div>
                    </div>
                    <div class="vital-item">
                        <div class="label">SpO2</div>
                        <div class="value">${vitals.oxygenSaturation || '-'}%</div>
                    </div>
                </div>
                <div class="doctor-hr-trend-wrap">
                    <div class="doctor-hr-trend-header">
                        <strong>ECG Rhythm Monitor</strong>
                        <span class="doctor-rhythm-badge ${hrChart.rhythmClass}">${hrChart.rhythmLabel}</span>
                    </div>
                    ${hrChart.svg}
                    <div class="doctor-hr-trend-meta">
                        <span class="doctor-bpm-value">${bpmText}</span>
                        <span class="muted-text">Live monitor</span>
                    </div>
                </div>
                <p class="muted-text" style="margin-top: 10px;">Live telemetry updates every 3 seconds • Last update ${new Date(vitals.lastUpdated || new Date()).toLocaleTimeString()}</p>
                
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-gray);">
                    <button class="btn btn-small btn-primary" onclick="openPatientDetail(${patient.id})">View Details</button>
                    <button class="btn btn-small btn-secondary" onclick="openDoctorChat(${patient.id})">Message Staff</button>
                    <button class="btn btn-small btn-secondary" onclick="printPatientReport(${patient.id})">Print Report</button>
                    <button class="btn btn-small btn-danger" onclick="sendFamilyHospitalAlert(${patient.id}, this)" title="Notify every linked family account to come to the hospital">Alert family</button>
                    <button class="btn btn-small btn-primary" onclick="completePatientCase(${patient.id}, this)">Case complete</button>
                    <button class="btn btn-small btn-danger" onclick="deletePatientRecord(${patient.id}, '${(patient.patientCode || '').replace(/'/g, "\\'")}')">Delete</button>
                    <button class="btn btn-small btn-danger" onclick="openCodeBluePrompt(${patient.id})">Code Blue</button>
                </div>
            </div>
        `;
    }).join('');
}

async function completePatientCase(patientId, button) {
    const confirmed = window.confirm('Complete and discharge this patient? This will permanently delete all family accounts linked to this patient. The patient record will remain, but family access cannot be recovered.');
    if (!confirmed) return;

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Completing...';
    try {
        const response = await apiCall(`/patients/${patientId}/case-complete`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        if (!response) return;

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showNotification(result.error || 'Unable to complete this patient case.', 'danger');
            return;
        }

        showNotification(`Patient discharged. ${result.familyAccountsDeleted || 0} linked family account(s) deleted.`, 'success');
        await loadDoctorDashboard();
    } catch (error) {
        console.error('Error completing patient case:', error);
        showNotification('Unable to complete this patient case right now.', 'danger');
    } finally {
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

async function sendFamilyHospitalAlert(patientId, button) {
    const confirmed = window.confirm('Send an urgent alert to every family account linked to this patient, asking them to come to the hospital now? Use only after assessing a serious deterioration.');
    if (!confirmed) return;
    const sendEmail = window.confirm('Also send an email to linked family accounts? Bird email plan limits or charges may apply. Select Cancel to send the in-app alert only.');

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Sending...';
    try {
        const response = await apiCall(`/patients/${patientId}/family-alert`, {
            method: 'POST',
            body: JSON.stringify({ sendEmail })
        });
        if (!response) return;

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showNotification(result.error || 'Unable to alert the family.', 'danger');
            return;
        }

        const inAppMessage = `Urgent in-app alert sent to ${result.recipientCount} linked family account(s).`;
        if (result.emailRequested && result.emailFailedCount > 0) {
            const failureDetails = Array.isArray(result.emailFailureReasons) && result.emailFailureReasons.length
                ? ` ${result.emailFailureReasons.join('; ')}`
                : '';
            showNotification(`${inAppMessage} Email accepted: ${result.emailAcceptedCount}; not sent: ${result.emailFailedCount}.${failureDetails}`, 'warning');
        } else if (result.emailRequested) {
            showNotification(`${inAppMessage} Bird accepted ${result.emailAcceptedCount} email(s) for delivery.`, 'success');
        } else {
            showNotification(inAppMessage, 'success');
        }
    } catch (error) {
        console.error('Error sending family hospital alert:', error);
        showNotification('Unable to send the family alert right now.', 'danger');
    } finally {
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

function buildDoctorHrTrendSvg(patientId, heartRate) {
    if (!doctorVitalsHistoryByPatient[patientId]) {
        doctorVitalsHistoryByPatient[patientId] = [];
    }

    const history = doctorVitalsHistoryByPatient[patientId];
    if (Number.isFinite(heartRate) && heartRate > 0) {
        history.push({
            ts: Date.now(),
            heartRate
        });
        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }
    }

    if (!history.length) {
        return {
            svg: '<div class="muted-text">Waiting for HR signal...</div>',
            rhythmLabel: 'No Signal',
            rhythmClass: 'rhythm-unknown'
        };
    }

    const rhythm = getDoctorRhythmStatus(history);
    const width = 360;
    const height = 92;
    const baseline = 58;
    const bpm = Number.isFinite(heartRate) ? heartRate : Number(history[history.length - 1].heartRate || 75);
    const beatSpacingBase = Math.max(28, Math.min(64, 72 - ((bpm - 60) * 0.45)));

    if (!doctorEcgStateByPatient[patientId]) {
        doctorEcgStateByPatient[patientId] = { phase: 0 };
    }

    const ecgState = doctorEcgStateByPatient[patientId];
    const scrollSpeed = rhythm.key === 'tachy' ? 9 : rhythm.key === 'brady' ? 5 : 7;
    ecgState.phase = (ecgState.phase + scrollSpeed) % beatSpacingBase;

    const points = [];
    let x = -ecgState.phase;
    while (x <= width + beatSpacingBase) {
        const jitter = rhythm.key === 'irregular' ? (Math.random() - 0.5) * 10 : 0;
        const beatSpacing = beatSpacingBase + jitter;
        const peak = rhythm.key === 'tachy' ? 20 : rhythm.key === 'brady' ? 28 : 24;

        points.push([x, baseline]);
        points.push([x + 0.12 * beatSpacing, baseline - 2]);
        points.push([x + 0.18 * beatSpacing, baseline]);
        points.push([x + 0.30 * beatSpacing, baseline]);
        points.push([x + 0.34 * beatSpacing, baseline + 5]);
        points.push([x + 0.37 * beatSpacing, baseline - peak]);
        points.push([x + 0.41 * beatSpacing, baseline + 8]);
        points.push([x + 0.48 * beatSpacing, baseline]);
        points.push([x + 0.66 * beatSpacing, baseline - 5]);
        points.push([x + 0.76 * beatSpacing, baseline]);
        points.push([x + beatSpacing, baseline]);
        x += beatSpacing;
    }

    const pathData = points
        .map((pt, index) => `${index === 0 ? 'M' : 'L'}${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`)
        .join(' ');

    const majorGrid = Array.from({ length: Math.ceil(width / 30) + 1 }, (_, i) => {
        const gx = i * 30;
        return `<line x1="${gx}" y1="0" x2="${gx}" y2="${height}" class="grid-major"></line>`;
    }).join('') + Array.from({ length: Math.ceil(height / 30) + 1 }, (_, i) => {
        const gy = i * 30;
        return `<line x1="0" y1="${gy}" x2="${width}" y2="${gy}" class="grid-major"></line>`;
    }).join('');

    const minorGrid = Array.from({ length: Math.ceil(width / 10) + 1 }, (_, i) => {
        const gx = i * 10;
        return `<line x1="${gx}" y1="0" x2="${gx}" y2="${height}" class="grid-minor"></line>`;
    }).join('') + Array.from({ length: Math.ceil(height / 10) + 1 }, (_, i) => {
        const gy = i * 10;
        return `<line x1="0" y1="${gy}" x2="${width}" y2="${gy}" class="grid-minor"></line>`;
    }).join('');

    const svg = `
        <svg class="doctor-hr-trend-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="ECG rhythm graph">
            <rect x="0" y="0" width="${width}" height="${height}" class="ecg-bg"></rect>
            ${minorGrid}
            ${majorGrid}
            <line x1="0" y1="${baseline}" x2="${width}" y2="${baseline}" class="ecg-baseline"></line>
            <path d="${pathData}" class="ecg-wave"></path>
        </svg>
    `;

    return {
        svg,
        rhythmLabel: rhythm.label,
        rhythmClass: `rhythm-${rhythm.key}`
    };
}

function getDoctorRhythmStatus(history) {
    const values = (history || []).map((item) => Number(item.heartRate)).filter((v) => Number.isFinite(v));
    if (!values.length) {
        return { key: 'unknown', label: 'No Signal' };
    }

    const latest = values[values.length - 1];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (latest > 100) {
        return { key: 'tachy', label: 'Tachycardia' };
    }

    if (latest < 60) {
        return { key: 'brady', label: 'Bradycardia' };
    }

    if (stdDev >= 8) {
        return { key: 'irregular', label: 'Irregular' };
    }

    return { key: 'normal', label: 'Normal' };
}

function displayDoctorStats(patients) {
    const critical = patients.filter(p => p.severity === 'Critical').length;
    const severe = patients.filter(p => p.severity === 'Severe').length;
    const moderate = patients.filter(p => p.severity === 'Moderate').length;

    const statsHTML = `
        <div class="stat-card danger">
            <h4>Critical Patients</h4>
            <div class="number">${critical}</div>
        </div>
        <div class="stat-card warning">
            <h4>Severe Patients</h4>
            <div class="number">${severe}</div>
        </div>
        <div class="stat-card info">
            <h4>Moderate Patients</h4>
            <div class="number">${moderate}</div>
        </div>
        <div class="stat-card success">
            <h4>Total Patients</h4>
            <div class="number">${patients.length}</div>
        </div>
    `;

    const statsContainer = document.getElementById('doctor-stats');
    if (statsContainer) statsContainer.innerHTML = statsHTML;
}

function displayDoctorMessages(messages) {
    const container = document.getElementById('doctor-chat');
    if (!container) return;
    container.innerHTML = '';

    (messages || []).forEach(message => appendChatMessage(message, 'doctor-chat'));
}

async function openPatientDetail(patientId) {
    try {
        const response = await apiCall(`/patients/${patientId}`);
        if (!response || !response.ok) return;

        const patient = await response.json();
        const detailContainer = document.getElementById('doctor-patient-detail');
        if (!detailContainer) return;

        detailContainer.innerHTML = `
            <div class="card">
                <h3>${patient.name} (${patient.patientCode})</h3>
                <p><strong>Diagnosis:</strong> ${patient.diagnosis}</p>
                <p><strong>Assigned Doctor:</strong> ${patient.assignedDoctor || 'Unassigned'}</p>
                <p><strong>Assigned Staff:</strong> ${patient.assignedStaff || 'Unassigned'}</p>
                <div class="vitals-grid">
                    <div class="vital-item"><div class="label">Temperature</div><div class="value">${patient.vitals.temperature || '-'}°C</div></div>
                    <div class="vital-item"><div class="label">BP</div><div class="value">${patient.vitals.bloodPressure || '-'}</div></div>
                    <div class="vital-item"><div class="label">HR</div><div class="value">${patient.vitals.heartRate || '-'}</div></div>
                    <div class="vital-item"><div class="label">RR</div><div class="value">${patient.vitals.respiratoryRate || '-'}</div></div>
                </div>
                <p><strong>Last Updated:</strong> ${new Date(patient.vitals.lastUpdated).toLocaleString()}</p>
                <div class="button-row">
                    <button class="btn btn-secondary" onclick="switchSection('doctor-section')">Back</button>
                    <button class="btn btn-primary" onclick="openDoctorChat(${patient.id})">Message Staff</button>
                    <button class="btn btn-secondary" onclick="printPatientReport(${patient.id})">Print Report</button>
                </div>
            </div>
        `;

        switchSection('doctor-patients-section');
    } catch (error) {
        console.error('Error loading patient detail:', error);
    }
}

async function printPatientReport(patientId) {
    try {
        const response = await apiCall(`/patients/${patientId}`);
        if (!response || !response.ok) {
            showNotification('Unable to load patient report data.', 'danger');
            return;
        }

        const patient = withResolvedVitals(await response.json());
        const vitals = patient.vitals || {};
        const now = new Date();
        const doctorLabel = `${currentUser.name || 'Doctor'} (${currentUser.department || 'General Medicine'})`;
        const hrChart = buildDoctorHrTrendSvg(patient.id, Number(vitals.heartRate));
        const hrHistory = doctorVitalsHistoryByPatient[patient.id] || [];
        const historyRows = hrHistory.slice(-10).reverse().map((item) => `
            <tr>
                <td>${new Date(item.ts).toLocaleTimeString()}</td>
                <td>${item.heartRate} bpm</td>
            </tr>
        `).join('');

        const reportWindow = window.open('', '_blank', 'width=980,height=760');
        if (!reportWindow) {
            showNotification('Popup blocked. Please allow popups to print report.', 'warning');
            return;
        }

        const reportHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <title>Patient Clinical Report</title>
                <style>
                    body { font-family: Segoe UI, Arial, sans-serif; color: #0f172a; margin: 24px; }
                    h1 { margin: 0 0 8px; font-size: 24px; }
                    .meta { color: #475569; margin-bottom: 18px; }
                    .panel { border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
                    th { background: #f1f5f9; }
                    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #e2e8f0; font-weight: 700; }
                    .rhythm-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid transparent; }
                    .rhythm-normal { background: rgba(22, 163, 74, 0.12); color: #166534; border-color: rgba(22, 163, 74, 0.24); }
                    .rhythm-tachy, .rhythm-brady, .rhythm-irregular { background: rgba(220, 38, 38, 0.12); color: #991b1b; border-color: rgba(220, 38, 38, 0.24); }
                    .rhythm-unknown { background: rgba(148, 163, 184, 0.12); color: #475569; border-color: rgba(148, 163, 184, 0.24); }
                    .chart-wrap { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; background: #fff; }
                    .chart-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
                    .doctor-hr-trend-chart { width: 100%; height: 120px; border: 1px solid #dbe5f2; border-radius: 8px; display: block; }
                    .doctor-hr-trend-chart .ecg-bg { fill: #fffefe; }
                    .doctor-hr-trend-chart .grid-minor { stroke: rgba(244, 63, 94, 0.07); stroke-width: 0.8; }
                    .doctor-hr-trend-chart .grid-major { stroke: rgba(244, 63, 94, 0.16); stroke-width: 1; }
                    .doctor-hr-trend-chart .ecg-baseline { stroke: rgba(239, 68, 68, 0.35); stroke-width: 1; }
                    .doctor-hr-trend-chart .ecg-wave { fill: none; stroke: #ef4444; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
                    .chart-meta { margin-top: 8px; display: flex; justify-content: space-between; color: #475569; }
                    .footer { margin-top: 18px; color: #64748b; font-size: 12px; }
                </style>
            </head>
            <body>
                <h1>Patient Clinical Snapshot Report</h1>
                <div class="meta">Generated ${now.toLocaleString()} by ${doctorLabel}</div>

                <div class="panel">
                    <table>
                        <tr><th>Patient Name</th><td>${patient.name || '-'}</td><th>Patient Code</th><td>${patient.patientCode || '-'}</td></tr>
                        <tr><th>Diagnosis</th><td>${patient.diagnosis || '-'}</td><th>Severity</th><td><span class="badge">${patient.severity || 'Moderate'}</span></td></tr>
                        <tr><th>Category</th><td>${patient.sicknessCategory || 'General Medicine'}</td><th>Admitted Date</th><td>${patient.admittedDate || '-'}</td></tr>
                    </table>
                </div>

                <div class="panel">
                    <h3>Latest Vitals</h3>
                    <table>
                        <tr><th>Temperature</th><td>${vitals.temperature ?? '-'} °C</td></tr>
                        <tr><th>Blood Pressure</th><td>${vitals.bloodPressure ?? '-'}</td></tr>
                        <tr><th>Heart Rate</th><td>${vitals.heartRate ?? '-'} bpm</td></tr>
                        <tr><th>Respiratory Rate</th><td>${vitals.respiratoryRate ?? '-'} /min</td></tr>
                        <tr><th>SpO2</th><td>${vitals.oxygenSaturation ?? '-'} %</td></tr>
                        <tr><th>Last Updated</th><td>${vitals.lastUpdated ? new Date(vitals.lastUpdated).toLocaleString() : '-'}</td></tr>
                    </table>
                </div>

                <div class="panel">
                    <h3>ECG Rhythm Trend</h3>
                    <div class="chart-wrap">
                        <div class="chart-head">
                            <strong>Heart Rhythm Strip</strong>
                            <span class="rhythm-badge ${hrChart.rhythmClass.replace('doctor-rhythm-badge ', '')}">${hrChart.rhythmLabel}</span>
                        </div>
                        ${hrChart.svg}
                        <div class="chart-meta">
                            <span><strong>${vitals.heartRate ?? '-'} bpm</strong></span>
                            <span>Printed ${now.toLocaleTimeString()}</span>
                        </div>
                    </div>
                    <table style="margin-top: 10px;">
                        <thead>
                            <tr><th>Sample Time</th><th>Heart Rate</th></tr>
                        </thead>
                        <tbody>
                            ${historyRows || '<tr><td colspan="2">No trend samples available yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div class="panel">
                    <h3>Doctor Notes</h3>
                    <p>${patient.notes ? String(patient.notes) : 'No notes available.'}</p>
                </div>

                <div class="footer">Hospital Management System • Clinical Report</div>
                <script>window.onload = () => { window.print(); };</script>
            </body>
            </html>
        `;

        reportWindow.document.open();
        reportWindow.document.write(reportHtml);
        reportWindow.document.close();
    } catch (error) {
        console.error('Error printing patient report:', error);
        showNotification('Unable to print patient report right now.', 'danger');
    }
}

async function openDoctorChat(patientId) {
    try {
        const response = await apiCall(`/patients/${patientId}`);
        if (!response || !response.ok) return;

        currentDoctorChatPatient = await response.json();
        const messageInput = document.getElementById('doctor-staff-message-input');
        if (messageInput) {
            messageInput.placeholder = `Message nursing staff about ${currentDoctorChatPatient.name}...`;
        }

        switchSection('doctor-staff-section');
    } catch (error) {
        console.error('Error opening doctor chat:', error);
    }
}

async function sendDoctorMessage() {
    const input = document.getElementById('doctor-message-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    try {
        const response = await apiCall('/messages/group/doctor', {
            method: 'POST',
            body: JSON.stringify({ content })
        });

        if (!response || !response.ok) {
            showNotification('Unable to send doctor message.', 'danger');
            return;
        }

        const data = await response.json();
        appendChatMessage(data.data, 'doctor-chat');
        input.value = '';
        showNotification('Message sent to doctor team.', 'success');
    } catch (error) {
        console.error('Error sending doctor message:', error);
        showNotification('Unable to send doctor message.', 'danger');
    }
}

async function sendDoctorToStaffMessage() {
    const input = document.getElementById('doctor-staff-message-input');
    if (!input) return;
    let content = input.value.trim();
    if (!content) return;

    if (currentDoctorChatPatient) {
        content = `Patient ${currentDoctorChatPatient.name} (${currentDoctorChatPatient.patientCode}): ${content}`;
    }

    try {
        const response = await apiCall('/messages/group/staff', {
            method: 'POST',
            body: JSON.stringify({ content })
        });

        if (!response || !response.ok) {
            showNotification('Unable to send nursing team message.', 'danger');
            return;
        }

        const data = await response.json();
        appendChatMessage(data.data, 'doctor-staff-chat');
        input.value = '';
        showNotification('Message sent to nursing team.', 'success');
    } catch (error) {
        console.error('Error sending doctor to staff message:', error);
        showNotification('Unable to send nursing team message.', 'danger');
    }
}

async function openPatientMessages() {
    switchSection('patient-messages-section');
    const container = document.getElementById('patient-chat');
    if (!container) return;

    if (!patientAssignedDoctorId) {
        container.innerHTML = '<p class="muted-text">No doctor is assigned to your patient record yet.</p>';
        return;
    }

    try {
        const response = await apiCall(`/messages/conversation/${patientAssignedDoctorId}`);
        if (!response || !response.ok) {
            container.innerHTML = '<p class="muted-text">Unable to load your doctor messages.</p>';
            return;
        }

        const messages = await response.json();
        container.innerHTML = '';
        if (!Array.isArray(messages) || messages.length === 0) {
            container.innerHTML = '<p class="muted-text">No messages yet. Send a message to your doctor.</p>';
            return;
        }

        messages.forEach((message) => appendChatMessage(message, 'patient-chat'));
    } catch (error) {
        console.error('Error loading patient conversation:', error);
        container.innerHTML = '<p class="muted-text">Unable to load your doctor messages.</p>';
    }
}

async function sendPatientMessage() {
    const input = document.getElementById('patient-message-input');
    if (!input) return;

    const content = input.value.trim();
    if (!content) return;

    if (!patientAssignedDoctorId) {
        showNotification('No assigned doctor found for this patient.', 'warning');
        return;
    }

    try {
        const response = await apiCall('/messages', {
            method: 'POST',
            body: JSON.stringify({
                content,
                recipientId: patientAssignedDoctorId,
                type: 'patient-doctor'
            })
        });

        if (!response || !response.ok) {
            const errorData = response ? await response.json().catch(() => ({})) : {};
            showNotification(errorData.error || 'Unable to send message to doctor.', 'danger');
            return;
        }

        const data = await response.json();
        appendChatMessage(data.data, 'patient-chat');
        input.value = '';
        showNotification('Message sent to your doctor.', 'success');
    } catch (error) {
        console.error('Error sending patient message:', error);
        showNotification('Unable to send message to doctor.', 'danger');
    }
}

function openCodeBluePrompt(patientId = null) {
    const modal = document.getElementById('code-blue-modal');
    if (!modal) return;

    modal.classList.add('show');
    modal.dataset.patientId = patientId || '';
    const patientSelect = document.getElementById('code-blue-patient');
    const roomInput = document.getElementById('code-blue-room');

    if (patientSelect) {
        if (!staffPatientCache.length) {
            apiCall('/patients')
                .then((response) => (response && response.ok ? response.json() : []))
                .then((patients) => {
                    if (Array.isArray(patients)) {
                        staffPatientCache = patients;
                        populateCodeBluePatientOptions(staffPatientCache);
                        patientSelect.value = patientId ? String(patientId) : '';
                    }
                })
                .catch((error) => {
                    console.error('Unable to load patient list for Code Blue:', error);
                });
        } else {
            populateCodeBluePatientOptions(staffPatientCache);
            patientSelect.value = patientId ? String(patientId) : '';
        }
    }

    if (roomInput) {
        roomInput.value = '';
    }

    document.getElementById('code-blue-note').value = patientId ? `Urgent assistance for patient ID ${patientId}` : '';
}

async function submitCodeBlue() {
    const modal = document.getElementById('code-blue-modal');
    if (!modal) return;
    const patientSelect = document.getElementById('code-blue-patient');
    const selectedPatientId = patientSelect && patientSelect.value ? parseInt(patientSelect.value) : null;
    const patientId = selectedPatientId || (modal.dataset.patientId ? parseInt(modal.dataset.patientId) : null);
    const roomNumber = document.getElementById('code-blue-room').value.trim();
    const note = document.getElementById('code-blue-note').value.trim();
    const selectedPatient = (staffPatientCache || []).find((patient) => Number(patient.id) === Number(patientId));

    try {
        const response = await apiCall('/patients/code-blue', {
            method: 'POST',
            body: JSON.stringify({
                patientId: patientId || null,
                roomNumber: roomNumber || null,
                note,
                patientName: selectedPatient ? selectedPatient.name : null
            })
        });

        if (response && response.ok) {
            const patientLabel = selectedPatient ? selectedPatient.name : 'General emergency';
            const roomLabel = roomNumber || 'Room not specified';
            const message = `CODE BLUE • Patient: ${patientLabel} • Room: ${roomLabel}${note ? ` • Note: ${note}` : ''}`;
            if (selectedPatient) {
                await triggerFamilyCodeBlueContact(selectedPatient, roomNumber, note);
            }
            showNotification('Code Blue alert sent to all clinical teams.', 'danger');
            showCodeBlueOverlay(message);
            closeModal('code-blue-modal');
        }
    } catch (error) {
        console.error('Error sending Code Blue:', error);
        showNotification('Failed to send Code Blue alert.', 'danger');
    }
}

async function loadPharmacyDashboard() {
    await loadMedicineStock('medicine-stock-list', true);
}

// STAFF DASHBOARD
async function loadStaffDashboard() {
    try {
        if (!doctorDirectory.length) {
            await loadDoctorDirectory();
        }

        const [patientsRes, messagesRes, appointmentsRes] = await Promise.all([
            apiCall('/patients'),
            apiCall('/messages/group/staff'),
            apiCall('/appointments')
        ]);

        const patients = patientsRes && patientsRes.ok ? await patientsRes.json() : staffPatientCache;
        staffPatientCache = Array.isArray(patients) ? patients : [];
        populateCodeBluePatientOptions(staffPatientCache);
        const messages = messagesRes && messagesRes.ok ? await messagesRes.json() : [];
        const appointments = appointmentsRes && appointmentsRes.ok ? await appointmentsRes.json() : [];
        staffAppointmentCache = Array.isArray(appointments) ? appointments : [];

        displayStaffPatients(staffPatientCache);
        displayStaffStats(staffPatientCache, staffAppointmentCache);
        displayStaffMessages(messages);
        displayStaffAppointments(staffAppointmentCache);
        loadStaffClinicalRequests();
        loadStaffAppointmentReschedules(staffAppointmentCache);
        loadMedicineStock('medicine-stock-list', true);
        populateMedicalDocumentPatients(staffPatientCache, 'medical-document-patient');
        loadMedicalDocuments('staff-medical-document-list');

        if ((!patientsRes || !patientsRes.ok) && appointmentsRes && appointmentsRes.ok) {
            showNotification('Patients API unavailable, showing appointments only.', 'warning');
        }
    } catch (error) {
        console.error('Error loading staff dashboard:', error);
    }
}

function populateCodeBluePatientOptions(patients = []) {
    const select = document.getElementById('code-blue-patient');
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML = '<option value="">-- General Emergency (No Specific Patient) --</option>' +
        patients.map((patient) => `<option value="${patient.id}">${patient.patientCode} - ${patient.name}</option>`).join('');

    if (previousValue && patients.some((patient) => String(patient.id) === String(previousValue))) {
        select.value = previousValue;
    }
}

function displayStaffMessages(messages) {
    const container = document.getElementById('staff-chat');
    if (!container) return;

    container.innerHTML = '';
    (messages || []).forEach(message => appendChatMessage(message, 'staff-chat'));
}

function displayStaffAppointments(appointments) {
    const container = document.getElementById('staff-appointments');
    if (!container) return;

    const sorted = [...(appointments || [])].sort((a, b) => (`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`));

    if (!sorted.length) {
        container.innerHTML = '<p class="muted-text">No appointment requests yet.</p>';
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Phone</th>
                    <th>Doctor</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map((appointment) => `
                    <tr>
                        <td>${appointment.date || '-'}</td>
                        <td>${appointment.time || '-'}</td>
                        <td>${appointment.patientName || '-'}</td>
                        <td>${appointment.patientPhone || '-'}</td>
                        <td>${appointment.doctorName || getDoctorLabel(appointment.doctorId)}</td>
                        <td><span class="severity-badge severity-moderate">${appointment.status || 'Scheduled'}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function sendStaffTeamMessage() {
    const input = document.getElementById('staff-message-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    try {
        const response = await apiCall('/messages/group/staff', {
            method: 'POST',
            body: JSON.stringify({ content })
        });

        if (!response || !response.ok) return;

        const data = await response.json();
        appendChatMessage(data.data, 'staff-chat');
        input.value = '';
    } catch (error) {
        console.error('Error sending staff team message:', error);
    }
}

function displayStaffPatients(patients) {
    const container = document.getElementById('staff-patients');
    if (!container) return;

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Patient Code</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Diagnosis</th>
                    <th>Doctor In Charge</th>
                    <th>Severity</th>
                    <th>Temperature</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${patients.map(p => `
                    <tr>
                        <td>${p.patientCode}</td>
                        <td>${p.name}</td>
                        <td>${p.sicknessCategory || '-'}</td>
                        <td>${p.diagnosis}</td>
                        <td>${getDoctorLabel(p.assignedDoctor)}</td>
                        <td><span class="severity-badge severity-${p.severity.toLowerCase()}">${p.severity}</span></td>
                        <td>${p.vitals.temperature || '-'}°C</td>
                        <td>
                            <button class="btn btn-small btn-primary" onclick="updateVitalsModal(${p.id})">Update Vitals</button>
                            <button class="btn btn-small btn-danger" onclick="deletePatientRecord(${p.id}, '${(p.patientCode || '').replace(/'/g, "\\'")}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

function displayStaffStats(patients, appointments = []) {
    const byDepartment = patients.reduce((acc, p) => {
        acc[p.department || 'General'] = (acc[p.department || 'General'] || 0) + 1;
        return acc;
    }, {});

    const statsContainer = document.getElementById('staff-stats');
    if (statsContainer) {
        const appointmentStats = `
            <div class="stat-card info">
                <h4>Total Appointments</h4>
                <div class="number">${appointments.length}</div>
            </div>
            <div class="stat-card warning">
                <h4>Scheduled</h4>
                <div class="number">${appointments.filter((item) => item.status === 'Scheduled').length}</div>
            </div>
        `;
        statsContainer.innerHTML = appointmentStats + Object.entries(byDepartment).map(([dept, count]) => `
            <div class="stat-card">
                <h4>${dept}</h4>
                <div class="number">${count}</div>
            </div>
        `).join('');
    }
}

// ADMIN DASHBOARD
async function loadAdminDashboard() {
    try {
        const [patientsRes, usersRes, appointmentsRes, leavesRes, bulletinsRes, siteStatusRes] = await Promise.all([
            apiCall('/patients'),
            apiCall('/users'),
            apiCall('/appointments'),
            apiCall('/leaves'),
            apiCall('/bulletins/manage'),
            apiCall('/site-status')
        ]);

        if (!patientsRes || !patientsRes.ok || !usersRes || !usersRes.ok) return;

        const patients = await patientsRes.json();
        const users = await usersRes.json();
        const appointments = appointmentsRes && appointmentsRes.ok ? await appointmentsRes.json() : [];
        const leaves = leavesRes && leavesRes.ok ? await leavesRes.json() : [];
        const bulletins = bulletinsRes && bulletinsRes.ok ? await bulletinsRes.json() : null;
        const siteStatus = siteStatusRes && siteStatusRes.ok ? await siteStatusRes.json() : null;

        displayAdminStats(patients, users, appointments, leaves);
        displayAdminPriorityWatchlist(patients);
        displayAdminUsers(users);
        displayAdminDoctors(users);
        displayAdminPatients(patients);
        displayAdminOverviewPatients(patients);
        displayAdminOverviewAppointments(appointments, users);
        displayAdminLeaves(leaves);
        displayAdminBulletins(bulletins);
        if (siteStatus) displayMourningSettings(siteStatus);
        loadAdminDeathRecords();
        loadAdminAuditLogs();
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
    }
}

function displayAdminStats(patients, users, appointments = [], leaves = []) {
    const statsHTML = `
        <div class="stat-card info">
            <h4>Total Patients</h4>
            <div class="number">${patients.length}</div>
        </div>
        <div class="stat-card info">
            <h4>Total Users</h4>
            <div class="number">${users.length}</div>
        </div>
        <div class="stat-card">
            <h4>Doctors</h4>
            <div class="number">${users.filter(u => u.role === 'doctor').length}</div>
        </div>
        <div class="stat-card">
            <h4>Staff</h4>
            <div class="number">${users.filter(u => u.role === 'staff').length}</div>
        </div>
        <div class="stat-card success">
            <h4>Appointments</h4>
            <div class="number">${appointments.length}</div>
        </div>
        <div class="stat-card warning">
            <h4>Pending Leave</h4>
            <div class="number">${leaves.filter((leave) => leave.status === 'Pending').length}</div>
        </div>
    `;

    const statsContainer = document.getElementById('admin-stats');
    if (statsContainer) statsContainer.innerHTML = statsHTML;
}

function displayAdminPriorityWatchlist(patients) {
    const container = document.getElementById('admin-priority-watchlist');
    const count = document.getElementById('admin-priority-count');
    if (!container || !count) return;

    const priorityPatients = patients
        .filter((patient) => ['critical', 'severe'].includes(String(patient.severity || '').toLowerCase()))
        .sort((a, b) => {
            const severityOrder = { critical: 0, severe: 1 };
            const severityDifference = severityOrder[String(a.severity).toLowerCase()] - severityOrder[String(b.severity).toLowerCase()];
            return severityDifference || String(a.name || '').localeCompare(String(b.name || ''));
        });

    count.textContent = String(priorityPatients.length);
    if (!priorityPatients.length) {
        container.innerHTML = '<p class="priority-watch-empty">No severe or critical patients are currently listed.</p>';
        return;
    }

    const list = document.createElement('div');
    list.className = 'priority-watchlist';
    priorityPatients.slice(0, 5).forEach((patient) => {
        const item = document.createElement('div');
        const severity = String(patient.severity || 'Severe');
        item.className = `priority-watch-item${severity.toLowerCase() === 'critical' ? ' is-critical' : ''}`;

        const mark = document.createElement('span');
        mark.className = 'priority-watch-mark';
        mark.setAttribute('aria-hidden', 'true');

        const copy = document.createElement('div');
        copy.className = 'priority-watch-copy';
        const name = document.createElement('strong');
        name.textContent = patient.name || 'Unnamed patient';
        const detail = document.createElement('span');
        detail.textContent = [patient.patientCode, patient.sicknessCategory || patient.department].filter(Boolean).join(' · ') || 'Patient record';
        copy.append(name, detail);

        const severityLabel = document.createElement('span');
        severityLabel.className = 'priority-watch-severity';
        severityLabel.textContent = severity;
        item.append(mark, copy, severityLabel);
        list.appendChild(item);
    });
    container.replaceChildren(list);
}

function displayAdminLeaves(leaves) {
    const container = document.getElementById('admin-leave-requests');
    const summary = document.getElementById('admin-leave-summary');
    const pending = leaves.filter((leave) => leave.status === 'Pending');

    if (summary) {
        summary.innerHTML = pending.length
            ? `<strong>${pending.length}</strong> leave request${pending.length === 1 ? '' : 's'} waiting for approval.`
            : '<span class="muted-text">No leave requests are waiting for approval.</span>';
    }
    if (!container) return;
    if (!leaves.length) {
        container.innerHTML = '<p class="muted-text">No doctor leave requests yet.</p>';
        return;
    }

    container.innerHTML = [...leaves].reverse().map((leave) => `
        <div class="leave-row admin-leave-row">
            <div>
                <strong>${leave.doctorName || 'Doctor'}: ${leave.startDate} to ${leave.endDate}</strong>
                <span>${leave.reason}</span>
                <small>${leave.status || 'Pending'}${leave.reviewedBy ? ` by ${leave.reviewedBy}` : ''}</small>
            </div>
            ${leave.status === 'Pending' ? `
                <div class="leave-actions">
                    <button class="btn btn-small btn-success" onclick="reviewDoctorLeave(${leave.id}, 'Approved')">Approve</button>
                    <button class="btn btn-small btn-danger" onclick="reviewDoctorLeave(${leave.id}, 'Rejected')">Reject</button>
                </div>
            ` : `<span class="leave-status leave-status-${String(leave.status).toLowerCase()}">${leave.status}</span>`}
        </div>
    `).join('');
}

function displayAdminOverviewPatients(patients) {
    const container = document.getElementById('admin-overview-patients');
    if (!container) return;
    if (!patients.length) {
        container.innerHTML = '<p class="muted-text">No patient records found.</p>';
        return;
    }

    container.innerHTML = `
        <div class="admin-overview-table-wrap">
            <table class="admin-patient-overview-table">
                <thead><tr><th>Patient</th><th>Age / Gender / Blood</th><th>Contact</th><th>Address</th><th>Category</th><th>Diagnosis</th><th>Severity</th><th>Assigned Doctor</th></tr></thead>
                <tbody>${patients.map((patient) => `
                    <tr>
                        <td><strong>${patient.name || '-'}</strong><br><small>${patient.patientCode || 'No code'}</small></td>
                        <td>${patient.age || '-'} / ${patient.gender || '-'} / ${patient.bloodType || '-'}</td>
                        <td>${patient.email || '-'}<br>${patient.phone || '-'}</td>
                        <td>${patient.address || '-'}</td>
                        <td>${patient.sicknessCategory || patient.department || '-'}</td>
                        <td>${patient.diagnosis || '-'}</td>
                        <td>${patient.severity || '-'}</td>
                        <td>${getDoctorLabel(patient.assignedDoctor)}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        </div>
    `;
}

function displayAdminOverviewAppointments(appointments, users) {
    const container = document.getElementById('admin-overview-appointments');
    if (!container) return;
    if (!appointments.length) {
        container.innerHTML = '<p class="muted-text">No booked appointments found.</p>';
        return;
    }

    const doctorNameById = users.reduce((map, user) => {
        if (user.role === 'doctor') map[user.id] = user.name;
        return map;
    }, {});

    const sorted = [...appointments].sort((a, b) => (`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`));
    container.innerHTML = `
        <div class="admin-overview-table-wrap">
            <table>
                <thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Patient Contact</th><th>Doctor</th><th>Status</th></tr></thead>
                <tbody>${sorted.map((appointment) => `
                    <tr>
                        <td>${appointment.date || '-'}</td>
                        <td>${appointment.time || '-'}</td>
                        <td>${appointment.patientName || '-'}</td>
                        <td>${appointment.patientEmail || '-'}<br>${appointment.patientPhone || '-'}</td>
                        <td>${appointment.doctorName || doctorNameById[appointment.doctorId] || 'Doctor'}</td>
                        <td>${appointment.status || 'Scheduled'}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        </div>
    `;
}

async function reviewDoctorLeave(leaveId, status) {
    try {
        const response = await apiCall(`/leaves/${leaveId}`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to update leave request.', 'danger');
            return;
        }
        showNotification(`Leave request ${status.toLowerCase()}.`, 'success');
        await loadAdminDashboard();
    } catch (error) {
        console.error('Error reviewing leave request:', error);
        showNotification('Unable to review leave request right now.', 'danger');
    }
}

function displayAdminUsers(users) {
    const container = document.getElementById('admin-users');
    if (!container) return;

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Department</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(u => `
                    <tr data-user-id="${Number(u.id)}" tabindex="-1">
                        <td>${u.name}</td>
                        <td>${u.username}</td>
                        <td>${u.role}</td>
                        <td>${u.email}</td>
                        <td>${u.department || '-'}</td>
                        <td>${u.role === 'family' ? `<button class="btn btn-small btn-danger" onclick="deleteFamilyAccount(${Number(u.id)})">Delete family account</button>` : '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

function displayAdminDoctors(users) {
    const container = document.getElementById('admin-doctors');
    if (!container) return;

    const doctors = users
        .filter((user) => user.role === 'doctor')
        .sort((a, b) => String(a.department || '').localeCompare(String(b.department || '')) || String(a.name || '').localeCompare(String(b.name || '')) || Number(a.id) - Number(b.id));

    container.replaceChildren();
    if (!doctors.length) {
        const empty = document.createElement('p');
        empty.className = 'priority-watch-empty';
        empty.textContent = 'No doctor profiles are registered yet.';
        container.appendChild(empty);
        return;
    }

    doctors.forEach((doctor) => {
        const card = document.createElement('article');
        card.className = 'admin-doctor-card';
        card.dataset.userId = String(Number(doctor.id) || '');

        const identity = document.createElement('div');
        identity.className = 'admin-doctor-identity';
        const avatar = document.createElement('span');
        avatar.className = 'admin-doctor-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = String(doctor.name || 'Doctor')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join('') || 'DR';

        const name = document.createElement('h2');
        name.className = 'admin-doctor-name';
        name.textContent = doctor.name || 'Doctor';
        identity.append(avatar, name);

        const department = document.createElement('p');
        department.className = 'admin-doctor-department';
        department.textContent = doctor.department || 'Department not listed';

        const email = document.createElement('p');
        email.className = 'admin-doctor-email';
        email.textContent = doctor.email || 'Email not listed';

        const account = document.createElement('p');
        account.className = 'admin-doctor-account';
        account.textContent = `@${doctor.username || 'username unavailable'} · Account #${Number(doctor.id) || 'unknown'}`;

        const openAccount = document.createElement('button');
        openAccount.type = 'button';
        openAccount.className = 'admin-doctor-open';
        openAccount.textContent = 'Open account';
        openAccount.addEventListener('click', () => openDoctorUserAccount(doctor.id));

        card.append(identity, department, email, account, openAccount);
        container.appendChild(card);
    });
}

function openDoctorUserAccount(userId) {
    const accountId = Number(userId);
    if (!Number.isInteger(accountId) || accountId <= 0 || typeof switchSection !== 'function') return;

    switchSection('admin-users-section');
    requestAnimationFrame(() => {
        const row = document.querySelector(`#admin-users tr[data-user-id="${accountId}"]`);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.focus({ preventScroll: true });
        row.classList.add('is-account-match');
        window.setTimeout(() => row.classList.remove('is-account-match'), 1800);
    });
}

function displayAdminBulletins(bulletins) {
    adminBulletinsCache = Array.isArray(bulletins) ? bulletins : [];
    const container = document.getElementById('admin-bulletin-list');
    if (!container) return;
    container.replaceChildren();

    if (!Array.isArray(bulletins)) {
        const unavailable = document.createElement('p');
        unavailable.className = 'bulletin-empty is-error';
        unavailable.textContent = 'Bulletin service is not deployed or could not be reached yet.';
        container.append(unavailable);
        return;
    }

    if (!adminBulletinsCache.length) {
        const empty = document.createElement('p');
        empty.className = 'muted-text';
        empty.textContent = 'No bulletins yet. Create a draft or publish the first announcement.';
        container.append(empty);
        return;
    }

    adminBulletinsCache.forEach((bulletin) => {
        const article = document.createElement('article');
        article.className = 'admin-bulletin-item';
        const heading = document.createElement('div');
        heading.className = 'admin-bulletin-heading';
        const title = document.createElement('h4');
        title.textContent = bulletin.title || 'Untitled bulletin';
        const state = document.createElement('span');
        state.className = bulletin.published ? 'bulletin-state is-published' : 'bulletin-state';
        state.textContent = bulletin.published ? 'Published' : 'Draft';
        heading.append(title, state);

        const meta = document.createElement('p');
        meta.className = 'muted-text';
        meta.textContent = `${bulletin.category || 'General'} · ${bulletin.updatedAt || bulletin.createdAt ? new Date(bulletin.updatedAt || bulletin.createdAt).toLocaleString() : ''}`;
        const summary = document.createElement('p');
        summary.className = 'admin-bulletin-content';
        summary.textContent = bulletin.content || '';

        const actions = document.createElement('div');
        actions.className = 'bulletin-admin-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn-small btn-secondary';
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => editAdminBulletin(Number(bulletin.id)));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-small btn-danger';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => deleteAdminBulletin(Number(bulletin.id)));
        actions.append(edit, remove);
        article.append(heading, meta, summary, actions);
        container.append(article);
    });
}

function resetAdminBulletinForm() {
    const form = document.getElementById('admin-bulletin-form');
    if (!form) return;
    form.reset();
    document.getElementById('admin-bulletin-id').value = '';
    document.getElementById('admin-bulletin-save').textContent = 'Save bulletin';
    document.getElementById('admin-bulletin-cancel').hidden = true;
    document.getElementById('admin-bulletin-status').textContent = '';
}

function editAdminBulletin(bulletinId) {
    const bulletin = adminBulletinsCache.find((item) => Number(item.id) === bulletinId);
    if (!bulletin) return;
    document.getElementById('admin-bulletin-id').value = String(bulletin.id);
    document.getElementById('admin-bulletin-title').value = bulletin.title || '';
    document.getElementById('admin-bulletin-category').value = bulletin.category || 'General';
    document.getElementById('admin-bulletin-content').value = bulletin.content || '';
    document.getElementById('admin-bulletin-published').checked = Boolean(bulletin.published);
    document.getElementById('admin-bulletin-save').textContent = 'Update bulletin';
    document.getElementById('admin-bulletin-cancel').hidden = false;
    document.getElementById('admin-bulletin-status').textContent = `Editing: ${bulletin.title}`;
    switchSection('admin-bulletins-section');
    document.getElementById('admin-bulletin-title').focus();
}

async function deleteAdminBulletin(bulletinId) {
    if (!window.confirm('Delete this bulletin permanently?')) return;
    try {
        const response = await apiCall(`/bulletins/${bulletinId}`, { method: 'DELETE' });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok || !result.message) {
            showNotification(result.error || 'Unable to delete bulletin.', 'danger');
            return;
        }
        showNotification('Bulletin deleted.', 'success');
        await loadAdminDashboard();
    } catch (error) {
        console.error('Error deleting bulletin:', error);
        showNotification('Unable to delete bulletin right now.', 'danger');
    }
}

function setupAdminBulletinForm() {
    const form = document.getElementById('admin-bulletin-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const bulletinId = document.getElementById('admin-bulletin-id').value;
        const status = document.getElementById('admin-bulletin-status');
        const payload = {
            title: document.getElementById('admin-bulletin-title').value.trim(),
            category: document.getElementById('admin-bulletin-category').value,
            content: document.getElementById('admin-bulletin-content').value.trim(),
            published: document.getElementById('admin-bulletin-published').checked
        };
        const saveButton = document.getElementById('admin-bulletin-save');
        saveButton.disabled = true;
        status.textContent = 'Saving bulletin...';

        try {
            const response = await apiCall(bulletinId ? `/bulletins/${bulletinId}` : '/bulletins', {
                method: bulletinId ? 'PUT' : 'POST',
                body: JSON.stringify(payload)
            });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok || !result.bulletin) {
                status.textContent = result.error || 'Unable to save bulletin.';
                return;
            }

            resetAdminBulletinForm();
            showNotification(payload.published ? 'Bulletin published.' : 'Bulletin draft saved.', 'success');
            await loadAdminDashboard();
        } catch (error) {
            console.error('Error saving bulletin:', error);
            status.textContent = 'Unable to save bulletin right now.';
        } finally {
            saveButton.disabled = false;
        }
    });

    document.getElementById('admin-bulletin-cancel').addEventListener('click', resetAdminBulletinForm);
}

function displayMourningSettings(siteStatus) {
    const enabled = document.getElementById('admin-mourning-enabled');
    const memorialName = document.getElementById('admin-mourning-name');
    const notice = document.getElementById('admin-mourning-notice');
    if (!enabled || !memorialName || !notice) return;
    enabled.checked = Boolean(siteStatus.mourningMode);
    memorialName.value = siteStatus.memorialName || '';
    notice.value = siteStatus.notice || '';
}

// MEDICINE REQUESTS AND BLOOD RESULTS
const CLINICAL_STATUS_LABELS = {
    awaiting_nurse: 'Waiting for nurse',
    awaiting_doctor: 'Waiting for doctor',
    approved: 'Approved',
    rejected: 'Rejected'
};
const BLOOD_STANDARD_PANEL = [
    { test: 'Haemoglobin', unit: 'g/dL' },
    { test: 'White cell count', unit: '×10⁹/L' },
    { test: 'Platelets', unit: '×10⁹/L' },
    { test: 'Glucose', unit: 'mmol/L' },
    { test: 'Creatinine', unit: 'µmol/L' }
];
let clinicalAwaitingDoctorCount = 0;

function clinicalEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function clinicalInput(type, label, maxLength, value) {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = label;
    input.maxLength = maxLength;
    input.setAttribute('aria-label', label);
    if (value) input.value = value;
    return input;
}

function formatClinicalMedicine(medicine) {
    if (!medicine) return '';
    return [medicine.name, medicine.dose, medicine.frequency, medicine.duration].filter(Boolean).join(' · ');
}

function formatClinicalDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '';
}

function setClinicalBadge(id, count) {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = String(count);
    badge.hidden = count === 0;
}

function buildClinicalDetails(item) {
    const wrap = clinicalEl('div', 'clinical-details');

    if (item.type === 'family-medicine-request') {
        wrap.append(clinicalEl('p', 'clinical-medicine-line', item.familyRequest?.medicineName || 'Medicine requested'));
        if (item.familyRequest?.note) wrap.append(clinicalEl('p', 'muted-text', item.familyRequest.note));
        return wrap;
    }

    if (item.type === 'medicine') {
        wrap.append(clinicalEl('p', 'clinical-medicine-line', formatClinicalMedicine(item.medicine)));
        if (item.medicine?.instructions) wrap.append(clinicalEl('p', 'muted-text', item.medicine.instructions));
        if (item.originalMedicine) {
            const reason = item.changeReason || item.nurseChange?.note;
            wrap.append(clinicalEl('p', 'clinical-change-note', `Replaced ${formatClinicalMedicine(item.originalMedicine)}${reason ? `: ${reason}` : ''}`));
        }
        return wrap;
    }

    const table = clinicalEl('table', 'clinical-result-table');
    const thead = clinicalEl('thead');
    const headRow = clinicalEl('tr');
    ['Test', 'Result', 'Reference', 'Flag'].forEach((label) => headRow.append(clinicalEl('th', '', label)));
    thead.append(headRow);
    table.append(thead);

    const body = clinicalEl('tbody');
    (item.results || []).forEach((row) => {
        const tr = clinicalEl('tr');
        tr.append(
            clinicalEl('td', '', row.test),
            clinicalEl('td', '', [row.value, row.unit].filter(Boolean).join(' ')),
            clinicalEl('td', '', row.range || '-')
        );
        const flagCell = clinicalEl('td');
        flagCell.append(clinicalEl('span', `clinical-flag is-${row.flag || 'normal'}`, row.flag || 'normal'));
        tr.append(flagCell);
        body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    if (item.note) wrap.append(clinicalEl('p', 'muted-text', item.note));
    return wrap;
}

function buildClinicalCard(item, options = {}) {
    const card = clinicalEl('article', 'clinical-card');
    const head = clinicalEl('div', 'clinical-card-head');
    const titleWrap = clinicalEl('div');
    titleWrap.append(clinicalEl('h4', '', ['medicine', 'family-medicine-request'].includes(item.type) ? 'Medicine request' : 'Blood result'));

    const metaParts = [];
    if (options.showPatient) metaParts.push(item.patientName || 'Patient');
    if (item.type === 'blood-result' && item.collectedDate) metaParts.push(`Collected ${item.collectedDate}`);
    if (options.showDoctor) metaParts.push(item.doctorName || 'Doctor');
    titleWrap.append(clinicalEl('p', 'muted-text', metaParts.join(' · ')));
    head.append(titleWrap);

    if (item.status) {
        head.append(clinicalEl('span', `clinical-status is-${item.status}`, CLINICAL_STATUS_LABELS[item.status] || item.status));
    }
    card.append(head, buildClinicalDetails(item));

    if (item.status === 'awaiting_doctor' && item.nurseChange) {
        const change = clinicalEl('div', 'clinical-change-note');
        change.append(clinicalEl('strong', '', `${item.nurseChange.by || 'Nurse'} proposed a change`));
        change.append(clinicalEl('p', '', item.nurseChange.note || ''));
        if (item.nurseChange.substitute) {
            change.append(clinicalEl('p', '', `Replacement: ${formatClinicalMedicine(item.nurseChange.substitute)}`));
        }
        card.append(change);
    }

    if (options.family) {
        const approvers = [item.doctorName, item.nurseName].filter(Boolean).join(' and ');
        const approvedAt = formatClinicalDate(item.approvedAt);
        card.append(clinicalEl('p', 'muted-text', `Approved by ${approvers || 'the care team'}${approvedAt ? ` on ${approvedAt}` : ''}`));
    }

    if (options.actions) card.append(options.actions);
    return card;
}

function populateClinicalPatientSelects(patients) {
    document.querySelectorAll('.clinical-patient-select').forEach((select) => {
        const previous = select.value;
        select.replaceChildren(new Option('-- Select patient --', ''));
        patients.forEach((patient) => {
            select.append(new Option(`${patient.patientCode || 'N/A'} - ${patient.name}`, String(patient.id)));
        });
        if (previous && patients.some((patient) => String(patient.id) === previous)) select.value = previous;
    });
}

async function fetchClinicalRequests() {
    try {
        const response = await apiCall('/clinical-requests');
        if (!response || !response.ok) return null;
        const items = await response.json();
        return Array.isArray(items) ? items : null;
    } catch (error) {
        console.error('Error loading clinical requests:', error);
        return null;
    }
}

function clinicalApiUnavailableMessage() {
    return 'Clinical requests are not available yet. Deploy the latest API from GitHub main to Railway, then reload this page.';
}

async function loadDoctorClinicalRequests(patients) {
    if (Array.isArray(patients)) populateClinicalPatientSelects(patients);

    const items = await fetchClinicalRequests();
    if (!items) {
        const attention = document.getElementById('doctor-clinical-attention');
        const attentionList = document.getElementById('doctor-clinical-attention-list');
        const list = document.getElementById('doctor-clinical-list');
        if (attention && attentionList) {
            attention.hidden = false;
            attentionList.replaceChildren(clinicalEl('p', 'muted-text', clinicalApiUnavailableMessage()));
        }
        if (list) list.replaceChildren(clinicalEl('p', 'muted-text', clinicalApiUnavailableMessage()));
        return;
    }

    const pending = items.filter((item) => item.status === 'awaiting_doctor');
    const attention = document.getElementById('doctor-clinical-attention');
    const attentionList = document.getElementById('doctor-clinical-attention-list');
    if (attention && attentionList) {
        attentionList.replaceChildren(...pending.map((item) => buildClinicalCard(item, {
            showPatient: true,
            actions: buildDoctorDecisionActions(item)
        })));
        attention.hidden = pending.length === 0;
    }
    setClinicalBadge('doctor-clinical-badge', pending.length);
    if (pending.length > clinicalAwaitingDoctorCount) {
        showNotification('A family request or nurse-proposed change needs your approval.', 'warning');
    }
    clinicalAwaitingDoctorCount = pending.length;

    const list = document.getElementById('doctor-clinical-list');
    if (!list) return;
    if (!items.length) {
        list.replaceChildren(clinicalEl('p', 'muted-text', 'No medicine requests or blood results yet.'));
        return;
    }
    list.replaceChildren(...items.map((item) => buildClinicalCard(item, { showPatient: true })));
}

function buildDoctorDecisionActions(item) {
    if (item.type === 'family-medicine-request') {
        return buildFamilyMedicineDecisionForm(item);
    }

    const actions = clinicalEl('div', 'clinical-actions');
    const approve = clinicalEl('button', 'btn btn-small btn-success', 'Approve change');
    const reject = clinicalEl('button', 'btn btn-small btn-danger', 'Reject');
    [approve, reject].forEach((button) => { button.type = 'button'; });
    approve.addEventListener('click', () => decideClinicalRequest(item.id, 'approve', approve));
    reject.addEventListener('click', () => decideClinicalRequest(item.id, 'reject', reject));
    actions.append(approve, reject);
    return actions;
}

function buildFamilyMedicineDecisionForm(item) {
    const form = clinicalEl('form', 'clinical-change-form doctor-medicine-approval-form');
    const fields = {};
    [
        ['name', 'Medicine to prescribe', 120, item.familyRequest?.medicineName || ''],
        ['dose', 'Dose', 60, ''],
        ['frequency', 'Frequency', 80, ''],
        ['duration', 'Duration', 60, ''],
        ['quantity', 'Stock units', 5, '1', 'number'],
        ['instructions', 'Instructions', 300, '']
    ].forEach(([key, label, maxLength, value, type]) => {
        const input = clinicalInput(type || 'text', label, maxLength, value);
        if (type === 'number') {
            input.min = '1';
            input.max = '10000';
            input.step = '1';
        }
        input.required = ['name', 'dose', 'frequency'].includes(key);
        fields[key] = input;
        form.append(input);
    });

    const actions = clinicalEl('div', 'clinical-actions');
    const approve = clinicalEl('button', 'btn btn-small btn-success', 'Approve & send to nurse');
    approve.type = 'submit';
    const reject = clinicalEl('button', 'btn btn-small btn-danger', 'Reject request');
    reject.type = 'button';
    reject.addEventListener('click', () => decideClinicalRequest(item.id, 'reject', reject));
    actions.append(approve, reject);
    form.append(actions);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        decideClinicalRequest(item.id, 'approve', approve, {
            medicine: Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, key === 'quantity' ? Number(input.value) : input.value.trim()]))
        });
    });
    return form;
}

async function decideClinicalRequest(requestId, decision, button, extra = {}) {
    button.disabled = true;
    try {
        const response = await apiCall(`/clinical-requests/${requestId}/doctor-decision`, {
            method: 'POST',
            body: JSON.stringify({ decision, ...extra })
        });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to save your decision.', 'danger');
            return;
        }
        showNotification(result.message || 'Decision saved.', 'success');
        await loadDoctorClinicalRequests();
    } catch (error) {
        console.error('Error saving clinical decision:', error);
        showNotification('Unable to save your decision right now.', 'danger');
    } finally {
        button.disabled = false;
    }
}

async function loadStaffClinicalRequests(force = false) {
    const items = await fetchClinicalRequests();
    if (!items) {
        const unavailable = clinicalEl('p', 'clinical-api-unavailable', clinicalApiUnavailableMessage());
        document.getElementById('staff-clinical-queue')?.replaceChildren(unavailable.cloneNode(true));
        document.getElementById('staff-clinical-recent')?.replaceChildren(unavailable.cloneNode(true));
        setClinicalBadge('staff-clinical-badge', 0);
        return;
    }

    const queue = items.filter((item) => item.status === 'awaiting_nurse');
    setClinicalBadge('staff-clinical-badge', queue.length);

    const queueEl = document.getElementById('staff-clinical-queue');
    if (queueEl && (force || !queueEl.querySelector('.clinical-change-form:not([hidden])'))) {
        queueEl.replaceChildren(...(queue.length
            ? queue.map((item) => buildClinicalCard(item, {
                showPatient: true,
                showDoctor: true,
                actions: buildNurseActions(item)
            }))
            : [clinicalEl('p', 'muted-text', 'Nothing is waiting for review.')]));
    }

    const recentEl = document.getElementById('staff-clinical-recent');
    if (recentEl) {
        const recent = items.filter((item) => item.status !== 'awaiting_nurse').slice(0, 15);
        recentEl.replaceChildren(...(recent.length
            ? recent.map((item) => buildClinicalCard(item, { showPatient: true, showDoctor: true }))
            : [clinicalEl('p', 'muted-text', 'No reviewed items yet.')]));
    }
}

function buildNurseActions(item) {
    const wrap = document.createDocumentFragment();
    const actions = clinicalEl('div', 'clinical-actions');
    const approve = clinicalEl('button', 'btn btn-small btn-success', 'Approve');
    const change = clinicalEl('button', 'btn btn-small btn-secondary', item.type === 'medicine' ? 'Out of stock / change' : 'Needs correction');
    [approve, change].forEach((button) => { button.type = 'button'; });

    const form = buildNurseChangeForm(item);
    form.hidden = true;
    approve.addEventListener('click', () => reviewClinicalRequest(item.id, { decision: 'approve' }, approve));
    change.addEventListener('click', () => { form.hidden = !form.hidden; });
    actions.append(approve, change);
    wrap.append(actions, form);
    return wrap;
}

function buildNurseChangeForm(item) {
    const form = clinicalEl('form', 'clinical-change-form');
    const fields = {};
    const addField = (key, label, maxLength, required, type = 'text') => {
        const input = clinicalInput(type, label, maxLength);
        input.required = required;
        if (type === 'number') {
            input.min = '1';
            input.max = '10000';
            input.step = '1';
            input.value = '1';
        }
        fields[key] = input;
        form.append(input);
    };

    if (item.type === 'medicine') {
        addField('name', 'Replacement medicine', 120, true);
        addField('dose', 'Dose', 60, true);
        addField('frequency', 'Frequency', 80, true);
        addField('duration', 'Duration', 60, false);
        addField('quantity', 'Stock units', 5, true, 'number');
    }
    addField('note', item.type === 'medicine' ? 'Reason, e.g. out of stock' : 'What needs correcting', 300, true);

    const submit = clinicalEl('button', 'btn btn-small btn-primary', `Send to ${item.doctorName || 'doctor'} for approval`);
    submit.type = 'submit';
    form.append(submit);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const payload = { decision: 'change', note: fields.note.value.trim() };
        if (item.type === 'medicine') {
            payload.substitute = {
                name: fields.name.value.trim(),
                dose: fields.dose.value.trim(),
                frequency: fields.frequency.value.trim(),
                duration: fields.duration.value.trim(),
                quantity: Number(fields.quantity.value)
            };
        }
        reviewClinicalRequest(item.id, payload, submit);
    });
    return form;
}

async function reviewClinicalRequest(requestId, payload, button) {
    button.disabled = true;
    try {
        const response = await apiCall(`/clinical-requests/${requestId}/nurse-review`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to save your review.', 'danger');
            return;
        }
        showNotification(result.message || 'Review saved.', 'success');
        await loadStaffClinicalRequests(true);
    } catch (error) {
        console.error('Error saving nurse review:', error);
        showNotification('Unable to save your review right now.', 'danger');
    } finally {
        button.disabled = false;
    }
}

function buildAppointmentActionCard(appointment) {
    const card = clinicalEl('article', 'family-appointment-card');
    const heading = clinicalEl('div', 'family-appointment-heading');
    const details = clinicalEl('div');
    details.append(clinicalEl('strong', '', appointment.doctorName || getDoctorLabel(appointment.doctorId)));
    details.append(clinicalEl('p', 'muted-text', `${appointment.date || ''} · ${appointment.time || ''} · ${appointment.doctorDepartment || ''}`));
    heading.append(details, clinicalEl('span', `clinical-status is-${String(appointment.status || 'Scheduled').toLowerCase().replace(/\s+/g, '-')}`, appointment.status || 'Scheduled'));
    card.append(heading);

    if (appointment.status === 'Reschedule Requested' && appointment.rescheduleRequest) {
        card.append(clinicalEl('p', 'appointment-reschedule-note', `Requested: ${appointment.rescheduleRequest.date} · ${appointment.rescheduleRequest.time}${appointment.rescheduleRequest.note ? ` — ${appointment.rescheduleRequest.note}` : ''}`));
    } else if (['Scheduled', 'Confirmed'].includes(appointment.status || 'Scheduled')) {
        const actions = clinicalEl('div', 'clinical-actions');
        if (appointment.status !== 'Confirmed') {
            const confirm = clinicalEl('button', 'btn btn-small btn-success', 'Confirm appointment');
            confirm.type = 'button';
            confirm.addEventListener('click', () => submitAppointmentAction(appointment.id, { action: 'confirm' }, confirm));
            actions.append(confirm);
        }
        const request = clinicalEl('button', 'btn btn-small btn-secondary', 'Request reschedule');
        request.type = 'button';
        actions.append(request);

        const form = clinicalEl('form', 'appointment-reschedule-form');
        form.hidden = true;
        const date = document.createElement('input'); date.type = 'date'; date.required = true; date.min = new Date().toISOString().slice(0, 10); date.setAttribute('aria-label', 'Requested appointment date');
        const time = document.createElement('input'); time.type = 'time'; time.required = true; time.setAttribute('aria-label', 'Requested appointment time');
        const note = clinicalInput('text', 'Reason (optional)', 240);
        const send = clinicalEl('button', 'btn btn-small btn-primary', 'Send request'); send.type = 'submit';
        form.append(date, time, note, send);
        request.addEventListener('click', () => { form.hidden = !form.hidden; });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            submitAppointmentAction(appointment.id, { action: 'request-reschedule', date: date.value, time: time.value, note: note.value.trim() }, send);
        });
        card.append(actions, form);
    }
    return card;
}

async function loadFamilyAppointments() {
    const container = document.getElementById('family-appointment-list');
    if (!container) return;
    if (container.contains(document.activeElement)) return;
    try {
        const response = await apiCall('/appointments/me');
        if (!response || !response.ok) {
            container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Appointment actions are unavailable. Please reload or contact the care team.'));
            return;
        }
        const appointments = await response.json();
        container.replaceChildren(...(appointments.length
            ? appointments.map(buildAppointmentActionCard)
            : [clinicalEl('p', 'muted-text', 'No appointments are linked to this family account.')]));
    } catch (error) {
        container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Unable to load appointments.'));
    }
}

async function loadPatientAppointments() {
    const container = document.getElementById('patient-appointment-list');
    if (!container) return;
    if (container.contains(document.activeElement)) return;
    try {
        const response = await apiCall('/appointments/me');
        if (!response || !response.ok) {
            container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Appointment actions are unavailable. Please reload or contact the care team.'));
            return;
        }
        const appointments = await response.json();
        container.replaceChildren(...(appointments.length
            ? appointments.map(buildAppointmentActionCard)
            : [clinicalEl('p', 'muted-text', 'No appointments are linked to this patient account.')]));
    } catch (error) {
        container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Unable to load appointments.'));
    }
}

async function submitAppointmentAction(appointmentId, payload, button) {
    button.disabled = true;
    try {
        const response = await apiCall(`/appointments/${appointmentId}`, { method: 'PUT', body: JSON.stringify(payload) });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to update appointment.', 'danger');
            return;
        }
        showNotification(result.message || 'Appointment updated.', 'success');
        button.blur();
        await Promise.all([loadFamilyAppointments(), loadPatientAppointments(), loadUserNotifications()]);
    } catch (error) {
        showNotification('Unable to update appointment right now.', 'danger');
    } finally {
        button.disabled = false;
    }
}

function renderAppointmentRescheduleQueue(containerId, appointments) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const pending = appointments.filter((item) => item.status === 'Reschedule Requested' && item.rescheduleRequest?.status === 'Pending');
    if (!pending.length) {
        container.replaceChildren(clinicalEl('p', 'muted-text', 'No reschedule requests waiting for review.'));
        return;
    }

    container.replaceChildren(...pending.map((appointment) => {
        const card = clinicalEl('article', 'family-appointment-card');
        card.append(clinicalEl('strong', '', `${appointment.patientName || 'Patient'} · ${appointment.doctorName || 'Doctor'}`));
        card.append(clinicalEl('p', 'muted-text', `Current: ${appointment.date} · ${appointment.time}`));
        card.append(clinicalEl('p', 'appointment-reschedule-note', `Requested: ${appointment.rescheduleRequest.date} · ${appointment.rescheduleRequest.time}${appointment.rescheduleRequest.note ? ` — ${appointment.rescheduleRequest.note}` : ''}`));
        const actions = clinicalEl('div', 'clinical-actions');
        const approve = clinicalEl('button', 'btn btn-small btn-success', 'Approve new time');
        const reject = clinicalEl('button', 'btn btn-small btn-danger', 'Keep original time');
        approve.type = reject.type = 'button';
        approve.addEventListener('click', () => reviewAppointmentReschedule(appointment.id, 'approve-reschedule', approve, containerId));
        reject.addEventListener('click', () => reviewAppointmentReschedule(appointment.id, 'reject-reschedule', reject, containerId));
        actions.append(approve, reject);
        card.append(actions);
        return card;
    }));
}

function loadStaffAppointmentReschedules(appointments = staffAppointmentCache) {
    renderAppointmentRescheduleQueue('staff-appointment-reschedules', appointments || []);
}

function loadDoctorAppointmentReschedules(appointments = []) {
    renderAppointmentRescheduleQueue('doctor-appointment-reschedules', appointments || []);
}

async function reviewAppointmentReschedule(id, action, button, targetId) {
    button.disabled = true;
    try {
        const response = await apiCall(`/appointments/${id}`, { method: 'PUT', body: JSON.stringify({ action }) });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to review reschedule request.', 'danger');
            return;
        }
        showNotification(result.message || 'Reschedule request updated.', 'success');
        if (targetId === 'doctor-appointment-reschedules') await loadDoctorDashboard();
        else await loadStaffDashboard();
    } catch (error) {
        showNotification('Unable to review reschedule request.', 'danger');
    } finally {
        button.disabled = false;
    }
}

async function loadAdminAuditLogs() {
    const container = document.getElementById('admin-audit-list');
    if (!container) return;
    try {
        const response = await apiCall('/audit-logs');
        if (!response || !response.ok) {
            container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Audit log unavailable. Deploy the latest API to Railway.'));
            return;
        }
        const logs = await response.json();
        container.replaceChildren(...(logs.length ? logs.slice(0, 12).map((entry) => {
            const row = clinicalEl('article', 'audit-log-item');
            row.append(clinicalEl('strong', '', entry.action || 'Activity'));
            row.append(clinicalEl('span', '', `${entry.actorName || 'System'} · ${entry.resource || ''} #${entry.resourceId || ''}`));
            row.append(clinicalEl('time', '', entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''));
            return row;
        }) : [clinicalEl('p', 'muted-text', 'No audit events recorded yet.')]));
    } catch (error) {
        container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Unable to load audit activity.'));
    }
}

async function loadFamilyClinicalRecords() {
    const list = document.getElementById('family-clinical-list');
    if (!list) return;

    const items = await fetchClinicalRequests();
    if (!items) {
        list.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', clinicalApiUnavailableMessage()));
        renderFamilyBloodTrends([]);
        return;
    }
    list.replaceChildren(...(items.length
        ? items.map((item) => buildClinicalCard(item, { family: true }))
        : [clinicalEl('p', 'muted-text', 'Nothing has been approved yet.')]));
    renderFamilyBloodTrends(items);
}

function renderFamilyBloodTrends(items = []) {
    const container = document.getElementById('family-blood-trends');
    if (!container) return;

    const groups = new Map();
    (items || []).filter((item) => item.type === 'blood-result').forEach((item) => {
        (item.results || []).forEach((result) => {
            const value = Number(result.value);
            if (!Number.isFinite(value)) return;
            const key = `${String(result.test || '').trim().toLowerCase()}|${String(result.unit || '').trim().toLowerCase()}`;
            if (!groups.has(key)) groups.set(key, { name: result.test, unit: result.unit || '', points: [] });
            groups.get(key).points.push({ value, date: item.collectedDate || '' });
        });
    });

    const trends = [...groups.values()].filter((group) => group.points.length > 1);
    if (!trends.length) {
        container.replaceChildren(clinicalEl('p', 'muted-text', 'Blood trends appear after at least two approved numeric results for the same test.'));
        return;
    }

    container.replaceChildren(clinicalEl('h4', '', 'Blood result trends'));
    const grid = clinicalEl('div', 'blood-trend-grid');
    trends.forEach((trend) => {
        trend.points.sort((a, b) => a.date.localeCompare(b.date));
        const card = clinicalEl('article', 'blood-trend-card');
        card.append(clinicalEl('strong', '', `${trend.name}${trend.unit ? ` (${trend.unit})` : ''}`));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 360 112');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `${trend.name} results over time`);

        const values = trend.points.map((point) => point.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = Math.max(max - min, Math.abs(max) * 0.08, 1);
        const plotted = trend.points.map((point, index) => ({
            ...point,
            x: trend.points.length === 1 ? 180 : 18 + index * (324 / (trend.points.length - 1)),
            y: 82 - ((point.value - min) / span) * 58
        }));
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', plotted.map((point) => `${point.x},${point.y}`).join(' '));
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', '#347c7b');
        polyline.setAttribute('stroke-width', '3');
        svg.append(polyline);
        plotted.forEach((point) => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(point.x));
            circle.setAttribute('cy', String(point.y));
            circle.setAttribute('r', '4');
            circle.setAttribute('fill', '#347c7b');
            circle.setAttribute('aria-label', `${point.date}: ${point.value} ${trend.unit}`);
            svg.append(circle);
        });
        const firstDate = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        firstDate.setAttribute('x', '18'); firstDate.setAttribute('y', '104'); firstDate.setAttribute('class', 'blood-trend-axis-label');
        firstDate.textContent = trend.points[0].date;
        const lastDate = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lastDate.setAttribute('x', '342'); lastDate.setAttribute('y', '104'); lastDate.setAttribute('text-anchor', 'end'); lastDate.setAttribute('class', 'blood-trend-axis-label');
        lastDate.textContent = trend.points[trend.points.length - 1].date;
        svg.append(firstDate, lastDate);
        card.append(svg);
        const latest = trend.points[trend.points.length - 1];
        card.append(clinicalEl('p', 'muted-text', `Latest: ${latest.value} ${trend.unit} · ${latest.date}`));
        grid.append(card);
    });
    container.append(grid, clinicalEl('p', 'muted-text blood-trend-note', 'Trend view only; a clinician should interpret results with their reference ranges and clinical context.'));
}

function setupFamilyMedicineRequestForm() {
    const form = document.getElementById('family-medicine-request-form');
    const status = document.getElementById('family-medicine-request-status');
    if (!form || !status) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = 'Sending to the assigned doctor...';

        try {
            const response = await apiCall('/clinical-requests', {
                method: 'POST',
                body: JSON.stringify({
                    type: 'family-medicine-request',
                    medicineName: document.getElementById('family-medicine-request-name').value.trim(),
                    note: document.getElementById('family-medicine-request-note').value.trim()
                })
            });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok || !result.requestId) {
                status.textContent = result.error || clinicalApiUnavailableMessage();
                return;
            }

            form.reset();
            status.textContent = result.message || 'Request sent to the assigned doctor.';
            await loadFamilyClinicalRecords();
        } catch (error) {
            console.error('Error submitting family medicine request:', error);
            status.textContent = clinicalApiUnavailableMessage();
        } finally {
            button.disabled = false;
        }
    });
}

function addBloodRow(values = {}) {
    const container = document.getElementById('clinical-blood-rows');
    if (!container || container.children.length >= 30) return;

    const row = clinicalEl('div', 'clinical-blood-row');
    const fields = {
        test: clinicalInput('text', 'Test', 80, values.test),
        value: clinicalInput('text', 'Result', 40),
        unit: clinicalInput('text', 'Unit', 30, values.unit),
        range: clinicalInput('text', 'Reference range', 40)
    };
    Object.entries(fields).forEach(([key, input]) => {
        input.dataset.field = key;
        row.append(input);
    });

    const flag = document.createElement('select');
    flag.dataset.field = 'flag';
    flag.setAttribute('aria-label', 'Flag');
    ['normal', 'high', 'low', 'critical'].forEach((name) => flag.append(new Option(name.charAt(0).toUpperCase() + name.slice(1), name)));

    const remove = clinicalEl('button', 'btn btn-small btn-secondary', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => row.remove());
    row.append(flag, remove);
    container.append(row);
}

function resetBloodForm() {
    const container = document.getElementById('clinical-blood-rows');
    if (container) container.replaceChildren();
    addBloodRow();
    const date = new Date();
    const dateInput = document.getElementById('clinical-blood-date');
    if (dateInput) {
        dateInput.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
}

async function submitClinicalRequest(payload, status, button) {
    status.textContent = 'Sending...';
    button.disabled = true;
    try {
        const response = await apiCall('/clinical-requests', { method: 'POST', body: JSON.stringify(payload) });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok || !result.request?.id) {
            status.textContent = result.error || (response?.ok ? clinicalApiUnavailableMessage() : 'Unable to send the request.');
            return false;
        }
        status.textContent = result.message || 'Sent for nurse review.';
        await loadDoctorClinicalRequests();
        return true;
    } catch (error) {
        console.error('Error submitting clinical request:', error);
        status.textContent = 'Unable to send the request right now.';
        return false;
    } finally {
        button.disabled = false;
    }
}

const DEATH_RECORD_STATUS_LABELS = {
    awaiting_admin: 'Waiting for admin review',
    approved: 'Approved',
    rejected: 'Rejected'
};
let familyDeathRecordsCache = [];

async function fetchDeathRecords() {
    try {
        const response = await apiCall('/death-certificates');
        if (!response || !response.ok) return null;
        const records = await response.json();
        return Array.isArray(records) ? records : null;
    } catch (error) {
        console.error('Error loading hospital death records:', error);
        return null;
    }
}

function makeDeathRecordCard(record, options = {}) {
    const card = clinicalEl('article', 'death-record-card');
    const heading = clinicalEl('div', 'death-record-card-heading');
    const title = clinicalEl('div');
    title.append(clinicalEl('h4', '', record.patientName || 'Patient'));
    title.append(clinicalEl('p', 'muted-text', `${record.patientCode || 'No patient code'} · ${record.certificateNumber || 'Internal reference pending'}`));
    heading.append(title);
    heading.append(clinicalEl('span', `clinical-status is-${record.status || 'awaiting_admin'}`, DEATH_RECORD_STATUS_LABELS[record.status] || record.status || 'Pending'));
    card.append(heading);

    const details = clinicalEl('dl', 'death-record-details');
    [
        ['Date and time', [record.deathDate, record.deathTime].filter(Boolean).join(' · ')],
        ['Place', record.place],
        ['Cause recorded', record.cause],
        ['Attending doctor', record.doctorName],
        ['Doctor confirmed', record.doctorAttestedBy ? `${record.doctorAttestedBy}${record.doctorAttestedAt ? ` · ${formatClinicalDate(record.doctorAttestedAt)}` : ''}` : 'Pending'],
        ...(record.status === 'approved' ? [['Admin approved', record.adminApprovedBy || record.reviewedBy || 'Admin']] : []),
        ...(record.reviewNote ? [['Admin review note', record.reviewNote]] : [])
    ].forEach(([label, value]) => {
        details.append(clinicalEl('dt', '', label), clinicalEl('dd', '', value || '—'));
    });
    card.append(details);
    card.append(clinicalEl('p', 'death-record-watermark-label', 'HOSPITAL RECORD COPY · NOT A GOVERNMENT CERTIFICATE'));

    if (options.review && record.status === 'awaiting_admin') {
        const actions = clinicalEl('div', 'clinical-actions');
        const approve = clinicalEl('button', 'btn btn-small btn-success', 'Approve record');
        const reject = clinicalEl('button', 'btn btn-small btn-danger', 'Reject');
        approve.type = 'button';
        reject.type = 'button';
        approve.addEventListener('click', () => reviewDeathRecord(record.id, 'approve', approve));
        reject.addEventListener('click', () => reviewDeathRecord(record.id, 'reject', reject));
        actions.append(approve, reject);
        card.append(actions);
    }

    if (options.print && record.status === 'approved') {
        const print = clinicalEl('button', 'btn btn-small btn-secondary', 'Print hospital copy');
        print.type = 'button';
        print.addEventListener('click', () => printHospitalDeathRecord(record.id));
        card.append(print);
    }
    return card;
}

function showDeathApiUnavailable(container) {
    if (container) container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Death record service is unavailable. Deploy the latest API from GitHub main to Railway, then reload.'));
}

async function loadDoctorDeathRecords(patients) {
    const patientSelect = document.getElementById('doctor-death-patient');
    const list = document.getElementById('doctor-death-list');
    if (patientSelect && Array.isArray(patients)) {
        const previous = patientSelect.value;
        patientSelect.replaceChildren(new Option('-- Select assigned patient --', ''));
        patients.filter((patient) => patient.status !== 'discharged').forEach((patient) => {
            patientSelect.append(new Option(`${patient.patientCode || 'N/A'} - ${patient.name}`, String(patient.id)));
        });
        if (previous && patients.some((patient) => String(patient.id) === previous)) patientSelect.value = previous;
    }

    const records = await fetchDeathRecords();
    if (!records) {
        showDeathApiUnavailable(list);
        return;
    }
    list?.replaceChildren(...(records.length
        ? records.map((record) => makeDeathRecordCard(record))
        : [clinicalEl('p', 'muted-text', 'No death records submitted by this doctor.')]));
}

async function loadAdminDeathRecords() {
    const pendingList = document.getElementById('admin-death-pending');
    const recentList = document.getElementById('admin-death-recent');
    const records = await fetchDeathRecords();
    if (!records) {
        showDeathApiUnavailable(pendingList);
        showDeathApiUnavailable(recentList);
        return;
    }

    const pending = records.filter((record) => record.status === 'awaiting_admin');
    const recent = records.filter((record) => record.status !== 'awaiting_admin').slice(0, 20);
    pendingList?.replaceChildren(...(pending.length
        ? pending.map((record) => makeDeathRecordCard(record, { review: true }))
        : [clinicalEl('p', 'muted-text', 'No death records are waiting for review.')]));
    recentList?.replaceChildren(...(recent.length
        ? recent.map((record) => makeDeathRecordCard(record))
        : [clinicalEl('p', 'muted-text', 'No reviewed records yet.')]));
}

async function loadFamilyDeathRecords() {
    const list = document.getElementById('family-death-list');
    const records = await fetchDeathRecords();
    if (!records) {
        showDeathApiUnavailable(list);
        return;
    }
    familyDeathRecordsCache = records;
    list?.replaceChildren(...(records.length
        ? records.map((record) => makeDeathRecordCard(record, { print: true }))
        : [clinicalEl('p', 'muted-text', 'No approved hospital death records are available for this family account.')]));
}

async function reviewDeathRecord(recordId, decision, button) {
    let note = '';
    if (decision === 'reject') {
        note = window.prompt('Reason for rejecting this hospital record (required):') || '';
        if (note.trim().length < 3) {
            showNotification('Enter a rejection reason of at least 3 characters.', 'warning');
            return;
        }
    }

    button.disabled = true;
    try {
        const response = await apiCall(`/death-certificates/${recordId}/review`, {
            method: 'POST',
            body: JSON.stringify({ decision, note })
        });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to save the death record review.', 'danger');
            return;
        }
        showNotification(result.message || 'Review saved.', 'success');
        await loadAdminDeathRecords();
    } catch (error) {
        console.error('Error reviewing death record:', error);
        showNotification('Unable to save the death record review.', 'danger');
    } finally {
        button.disabled = false;
    }
}

function escapeDeathCertificateText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function printHospitalDeathRecord(recordId) {
    const record = familyDeathRecordsCache.find((item) => Number(item.id) === Number(recordId));
    if (!record || record.status !== 'approved' || record.officialDocument !== false) return;

    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) {
        showNotification('Allow pop-ups to print this hospital copy.', 'warning');
        return;
    }

    const text = escapeDeathCertificateText;
    const doctorDate = record.doctorAttestedAt ? new Date(record.doctorAttestedAt).toLocaleString() : '—';
    const adminDate = record.approvedAt ? new Date(record.approvedAt).toLocaleString() : '—';
    const issueDate = new Date(record.approvedAt || Date.now()).toLocaleDateString();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Hospital Death Record Copy</title><style>
        @page{size:A4 landscape;margin:0}
        *{box-sizing:border-box}
        body{margin:0;background:#e7e9e9;color:#192c40;font:12px Georgia,'Times New Roman',serif}
        .sheet{position:relative;display:grid;grid-template-columns:48mm minmax(0,1fr);width:297mm;min-height:210mm;margin:0 auto;background:#fbfaf6;overflow:hidden}
        .rail{position:relative;display:flex;flex-direction:column;justify-content:space-between;padding:13mm 8mm 10mm;color:#f8f5ec;background:#132e49;border-right:2px solid #c69a4b}
        .brand{text-align:center}.brand-mark{margin:0 auto 8px;font-size:42px;line-height:1}.brand-name{font-size:16px;line-height:1.15;letter-spacing:.04em}.brand-sub{margin-top:8px;color:#d5c18e;font:7px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase}
        .rail-foot{color:#d9e0e3;font:8px/1.6 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase}
        .content{position:relative;z-index:0;padding:8mm 10mm 7mm}
        .topline{display:grid;grid-template-columns:1fr 42mm;align-items:start;gap:8mm}
        h1{margin:0;text-align:center;font-size:24px;letter-spacing:.045em;text-transform:uppercase}
        .subtitle{margin:4px 0 8px;text-align:center;font:9px Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase}
        .ref{padding:3px 0;color:#132e49;text-align:right;font:8px/1.5 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}
        .ref strong{display:block;color:#a53731;font:17px Georgia,serif;letter-spacing:.06em}
        .warning{margin:5mm 0 4mm;padding:7px 10px;color:#8e302d;background:#fff3eb;border:1px solid #d5a278;text-align:center;font:bold 9px Arial,sans-serif;letter-spacing:.1em}
        .section{margin-top:3mm;border:1px solid #d8d7ce}
        .section-title{padding:5px 8px;color:#fff;background:#193952;border-bottom:2px solid #c69a4b;font:bold 9px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase}
        .section-body{padding:7px 9px}
        .fields{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px 12px}
        .field{min-width:0;min-height:27px;border-bottom:1px solid #aeb6b7}
        .field.wide{grid-column:1/-1}.field-label{display:block;margin-bottom:2px;color:#526474;font:7px Arial,sans-serif;letter-spacing:.07em;text-transform:uppercase}.field-value{display:block;min-height:13px;color:#1d2d3c;font-size:11px;overflow-wrap:anywhere}
        .death-grid{display:grid;grid-template-columns:1fr 1fr 1.35fr;gap:14px;padding:8px 10px}
        .cause-layout{display:grid;grid-template-columns:27mm 1fr;min-height:33mm}
        .cause-label{padding:8px;color:#21384b;background:#f0eee7;border-right:1px solid #d8d7ce;font:bold 9px Arial,sans-serif}.cause-label span{display:block;margin-top:3px;color:#61717a;font:italic 8px Georgia,serif}
        .cause-value{padding:8px 10px;color:#1d2d3c;font-size:12px;line-height:1.5}
        .attestations{display:grid;grid-template-columns:1fr 1fr;gap:0}.attestation{padding:8px 10px;min-height:33mm}.attestation+ .attestation{border-left:1px solid #d8d7ce}.attestation-title{margin:0 0 10px;color:#20394e;font:bold 8px Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase}.attestation-name{font-size:12px;font-weight:bold}.attestation-meta{margin-top:5px;color:#536672;font:8px/1.45 Arial,sans-serif}
        .bottom{display:flex;justify-content:space-between;gap:10px;align-items:end;margin-top:4mm;padding-top:5px;border-top:2px solid #c69a4b;color:#6a7377;font:7px Arial,sans-serif}.bottom strong{color:#8e302d;font-size:8px;letter-spacing:.05em}
        .watermark{position:absolute;z-index:-1;top:47%;left:56%;transform:translate(-50%,-50%) rotate(-18deg);color:rgba(153,48,43,.075);font:bold 38px Arial,sans-serif;letter-spacing:.12em;white-space:nowrap;pointer-events:none}
        @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{margin:0;box-shadow:none}}
    </style></head><body><main class="sheet">
        <aside class="rail"><div class="brand"><div class="brand-mark" aria-hidden="true">♡</div><div class="brand-name">THE PROTOCOL<br>HOSPITAL</div><div class="brand-sub">Advanced care · Human touch</div></div><div class="rail-foot">Precision in every decision.<br>Compassion in every moment.</div></aside>
        <section class="content">
            <div class="topline"><div><h1>Medical Record of Death</h1><p class="subtitle">The Protocol Hospital · Internal clinical record</p></div><div class="ref">Hospital record ref<strong>${text(record.certificateNumber)}</strong></div></div>
            <div class="warning">HOSPITAL RECORD COPY · NOT A GOVERNMENT-ISSUED DEATH CERTIFICATE</div>
            <section class="section"><div class="section-title">A. Particulars of deceased</div><div class="section-body fields">
                <div class="field"><span class="field-label">Full name</span><span class="field-value">${text(record.patientName)}</span></div>
                <div class="field"><span class="field-label">Hospital no.</span><span class="field-value">${text(record.patientCode)}</span></div>
                <div class="field"><span class="field-label">Age</span><span class="field-value">${text(record.patientAge ?? '—')}</span></div>
                <div class="field"><span class="field-label">Gender</span><span class="field-value">${text(record.patientGender || '—')}</span></div>
                <div class="field wide"><span class="field-label">Address on patient record</span><span class="field-value">${text(record.patientAddress || '—')}</span></div>
            </div></section>
            <section class="section"><div class="section-title">B. Details of death</div><div class="death-grid">
                <div class="field"><span class="field-label">Date of death</span><span class="field-value">${text(record.deathDate)}</span></div>
                <div class="field"><span class="field-label">Time of death</span><span class="field-value">${text(record.deathTime)}</span></div>
                <div class="field"><span class="field-label">Place of death</span><span class="field-value">${text(record.place)}</span></div>
            </div></section>
            <section class="section"><div class="section-title">C. Cause recorded by attending medical practitioner</div><div class="cause-layout"><div class="cause-label">Part I<span>Cause recorded by the attending doctor</span></div><div class="cause-value">${text(record.cause)}</div></div></section>
            <section class="section"><div class="section-title">D. Dual clinical and administrative confirmation</div><div class="attestations">
                <div class="attestation"><p class="attestation-title">Attending doctor · clinical attestation</p><div class="attestation-name">${text(record.doctorAttestedBy || record.doctorName)}</div><div class="attestation-meta">Doctor in charge<br>Confirmed: ${text(doctorDate)}</div></div>
                <div class="attestation"><p class="attestation-title">Hospital administration · second approval</p><div class="attestation-name">${text(record.adminApprovedBy || record.reviewedBy)}</div><div class="attestation-meta">Approved: ${text(adminDate)}</div></div>
            </div></section>
            <div class="bottom"><span>Issued ${text(issueDate)} · Internal hospital reference only</span><strong>NOT VALID FOR CIVIL REGISTRATION</strong></div>
            <div class="watermark" aria-hidden="true">HOSPITAL COPY</div>
        </section>
    </main><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
}

function setupDeathCertificateForm() {
    const form = document.getElementById('doctor-death-form');
    const status = document.getElementById('doctor-death-status');
    if (!form || !status) return;

    const dateInput = document.getElementById('doctor-death-date');
    const today = new Date();
    dateInput.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = 'Submitting for admin review...';
        try {
            const response = await apiCall('/death-certificates', {
                method: 'POST',
                body: JSON.stringify({
                    patientId: Number(document.getElementById('doctor-death-patient').value),
                    deathDate: dateInput.value,
                    deathTime: document.getElementById('doctor-death-time').value,
                    place: document.getElementById('doctor-death-place').value.trim(),
                    cause: document.getElementById('doctor-death-cause').value.trim(),
                    doctorAttested: document.getElementById('doctor-death-attestation').checked
                })
            });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok || !result.record?.id) {
                status.textContent = result.error || 'Death record service unavailable. Deploy the latest API to Railway.';
                return;
            }
            const patientId = document.getElementById('doctor-death-patient').value;
            form.reset();
            document.getElementById('doctor-death-patient').value = patientId;
            status.textContent = `Submitted for review. Internal reference: ${result.record.certificateNumber}.`;
            await loadDoctorDeathRecords();
        } catch (error) {
            console.error('Error submitting death record:', error);
            status.textContent = 'Death record service unavailable. Deploy the latest API to Railway.';
        } finally {
            button.disabled = false;
        }
    });
}

function renderMedicineStock(targetId, items, editable) {
    const container = document.getElementById(targetId);
    if (!container) return;
    if (!items.length) {
        container.replaceChildren(clinicalEl('p', 'muted-text', 'No medicines in the stock list yet. Pharmacy staff can add them below.'));
        return;
    }

    container.replaceChildren(...items.map((item) => {
        const row = clinicalEl('article', `medicine-stock-item${Number(item.quantity) <= Number(item.minimum) ? ' is-low' : ''}`);
        const details = clinicalEl('div', 'medicine-stock-details');
        details.append(clinicalEl('strong', '', item.name || 'Medicine'));
        details.append(clinicalEl('span', '', `${item.quantity} ${item.unit || 'units'} · Low stock at ${item.minimum ?? 0}`));
        if (Number(item.quantity) <= Number(item.minimum)) details.append(clinicalEl('small', 'medicine-stock-warning', 'Low stock'));
        row.append(details);

        if (editable) {
            const controls = clinicalEl('div', 'medicine-stock-controls');
            const quantity = document.createElement('input');
            quantity.type = 'number'; quantity.min = '0'; quantity.max = '100000'; quantity.step = '1';
            quantity.value = String(item.quantity ?? 0); quantity.setAttribute('aria-label', `${item.name} stock quantity`);
            const minimum = document.createElement('input');
            minimum.type = 'number'; minimum.min = '0'; minimum.max = '100000'; minimum.step = '1';
            minimum.value = String(item.minimum ?? 0); minimum.setAttribute('aria-label', `${item.name} low-stock threshold`);
            const save = clinicalEl('button', 'btn btn-small btn-secondary', 'Update');
            save.type = 'button';
            save.addEventListener('click', () => updateMedicineStock(item.id, quantity.value, minimum.value, save));
            controls.append(quantity, minimum, save);
            row.append(controls);
        }
        return row;
    }));
}

async function loadMedicineStock(targetId, editable = false) {
    const container = document.getElementById(targetId);
    if (!container) return;
    if (editable && container.contains(document.activeElement)) return;
    try {
        const response = await apiCall('/medicine-stock');
        if (!response || !response.ok) {
            container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Medicine stock service is not available. Deploy the latest API to Railway.'));
            return;
        }
        medicineStockCache = await response.json();
        renderMedicineStock(targetId, Array.isArray(medicineStockCache) ? medicineStockCache : [], editable);
    } catch (error) {
        console.error('Error loading pharmacy stock:', error);
        container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Unable to load pharmacy stock.'));
    }
}

async function updateMedicineStock(id, quantity, minimum, button) {
    button.disabled = true;
    try {
        const response = await apiCall(`/medicine-stock/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity: Number(quantity), minimum: Number(minimum) })
        });
        const result = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
            showNotification(result.error || 'Unable to update stock.', 'danger');
            return;
        }
        showNotification('Medicine stock updated.', 'success');
        button.blur();
        await loadMedicineStock('medicine-stock-list', true);
        await loadMedicineStock('doctor-medicine-stock', false);
    } catch (error) {
        showNotification('Unable to update stock right now.', 'danger');
    } finally {
        button.disabled = false;
    }
}

function setupMedicineStockForm() {
    const form = document.getElementById('medicine-stock-form');
    const status = document.getElementById('medicine-stock-status');
    if (!form || !status) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const response = await apiCall('/medicine-stock', {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('medicine-stock-name').value.trim(),
                    unit: document.getElementById('medicine-stock-unit').value.trim(),
                    quantity: Number(document.getElementById('medicine-stock-quantity').value),
                    minimum: Number(document.getElementById('medicine-stock-minimum').value)
                })
            });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok) {
                status.textContent = result.error || 'Unable to add medicine to stock.';
                return;
            }
            form.reset();
            status.textContent = 'Medicine added to stock.';
            await loadMedicineStock('medicine-stock-list', true);
            await loadMedicineStock('doctor-medicine-stock', false);
        } catch (error) {
            status.textContent = 'Unable to update pharmacy stock right now.';
        } finally {
            button.disabled = false;
        }
    });
}

function populateMedicalDocumentPatients(patients, selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const previous = select.value;
    select.replaceChildren(new Option('-- Select patient --', ''));
    patients.filter((patient) => patient.status !== 'discharged').forEach((patient) => {
        select.append(new Option(`${patient.patientCode || 'N/A'} - ${patient.name}`, String(patient.id)));
    });
    if (previous && patients.some((patient) => String(patient.id) === previous)) select.value = previous;
}

async function loadMedicalDocuments(targetId, patientId = 0) {
    const container = document.getElementById(targetId);
    if (!container) return;
    try {
        const query = patientId > 0 ? `?patientId=${encodeURIComponent(patientId)}` : '';
        const response = await apiCall(`/medical-documents${query}`);
        if (!response || !response.ok) {
            container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Medical document storage is unavailable. Deploy the latest API to Railway.'));
            return;
        }
        const documents = await response.json();
        if (!Array.isArray(documents) || !documents.length) {
            container.replaceChildren(clinicalEl('p', 'muted-text', 'No medical documents attached.'));
            return;
        }
        container.replaceChildren(...documents.map((document) => {
            const item = clinicalEl('article', 'medical-document-item');
            const summary = clinicalEl('div');
            summary.append(clinicalEl('strong', '', document.name || 'Medical document'));
            summary.append(clinicalEl('span', 'muted-text', `${document.category || 'Other'} · ${(Number(document.size || 0) / 1024).toFixed(0)} KB · ${document.uploadedByName || 'Care team'}`));
            const download = clinicalEl('button', 'btn btn-small btn-secondary', 'Download');
            download.type = 'button';
            download.addEventListener('click', () => downloadMedicalDocument(document.id, document.name));
            item.append(summary, download);
            return item;
        }));
    } catch (error) {
        console.error('Error loading medical documents:', error);
        container.replaceChildren(clinicalEl('p', 'clinical-api-unavailable', 'Unable to load medical documents.'));
    }
}

async function downloadMedicalDocument(documentId, filename) {
    try {
        const response = await apiCall(`/medical-documents/${documentId}/download`);
        if (!response || !response.ok) {
            showNotification('You cannot access this patient document.', 'danger');
            return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || 'medical-document';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error downloading medical document:', error);
        showNotification('Unable to download this document.', 'danger');
    }
}

function setupMedicalDocumentForm() {
    const form = document.getElementById('medical-document-form');
    const status = document.getElementById('medical-document-status');
    if (!form || !status) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const file = document.getElementById('medical-document-file').files[0];
        const patientId = Number(document.getElementById('medical-document-patient').value);
        if (!file || !patientId) return;
        if (file.size > 4 * 1024 * 1024) {
            status.textContent = 'Choose a file no larger than 4 MB.';
            return;
        }

        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = 'Uploading private record...';
        try {
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Unable to read file'));
                reader.readAsDataURL(file);
            });
            const response = await apiCall('/medical-documents', {
                method: 'POST',
                body: JSON.stringify({
                    patientId,
                    name: file.name,
                    category: document.getElementById('medical-document-category').value,
                    data
                })
            });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok) {
                status.textContent = result.error || 'Unable to upload this document.';
                return;
            }
            form.reset();
            status.textContent = 'Private document uploaded.';
            await loadMedicalDocuments('staff-medical-document-list');
        } catch (error) {
            console.error('Error uploading medical document:', error);
            status.textContent = 'Unable to upload this document right now.';
        } finally {
            button.disabled = false;
        }
    });
}

function setupClinicalForms() {
    const medicineForm = document.getElementById('clinical-medicine-form');
    const bloodForm = document.getElementById('clinical-blood-form');
    const value = (id) => document.getElementById(id).value.trim();

    if (medicineForm) {
        medicineForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const sent = await submitClinicalRequest({
                type: 'medicine',
                patientId: Number(value('clinical-medicine-patient')),
                medicine: {
                    name: value('clinical-medicine-name'),
                    dose: value('clinical-medicine-dose'),
                    frequency: value('clinical-medicine-frequency'),
                    duration: value('clinical-medicine-duration'),
                    quantity: Number(value('clinical-medicine-quantity')),
                    instructions: value('clinical-medicine-instructions')
                }
            }, document.getElementById('clinical-medicine-status'), medicineForm.querySelector('button[type="submit"]'));
            if (sent) medicineForm.reset();
        });
    }

    if (bloodForm) {
        resetBloodForm();
        document.getElementById('clinical-add-row').addEventListener('click', () => addBloodRow());
        document.getElementById('clinical-add-panel').addEventListener('click', () => {
            BLOOD_STANDARD_PANEL.forEach((entry) => addBloodRow(entry));
        });

        bloodForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const results = [...document.querySelectorAll('#clinical-blood-rows .clinical-blood-row')]
                .map((row) => {
                    const read = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
                    return { test: read('test'), value: read('value'), unit: read('unit'), range: read('range'), flag: read('flag') };
                })
                .filter((row) => row.value !== '');
            if (!results.length) {
                status.textContent = 'Enter at least one result. Rows without a result are skipped.';
                return;
            }

            const sent = await submitClinicalRequest({
                type: 'blood-result',
                patientId: Number(value('clinical-blood-patient')),
                collectedDate: value('clinical-blood-date'),
                results,
                note: value('clinical-blood-note')
            }, status, bloodForm.querySelector('button[type="submit"]'));
            if (sent) {
                bloodForm.reset();
                resetBloodForm();
            }
        });
    }
}

function setupAdminDoctorForm() {
    const form = document.getElementById('admin-doctor-form');
    const status = document.getElementById('admin-doctor-status');
    if (!form || !status) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        const value = (id) => document.getElementById(id).value.trim();
        const payload = {
            role: 'doctor',
            name: value('admin-doctor-name-input'),
            username: value('admin-doctor-username'),
            email: value('admin-doctor-email-input'),
            department: value('admin-doctor-department-input'),
            password: document.getElementById('admin-doctor-password').value
        };

        status.textContent = 'Creating account...';
        submit.disabled = true;
        try {
            const response = await apiCall('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok) {
                status.textContent = result.error || 'Unable to create doctor account.';
                return;
            }
            form.reset();
            status.textContent = `Account created for ${result.user?.name || payload.name}.`;
            showNotification('Doctor account created.', 'success');
            await loadAdminDashboard();
        } catch (error) {
            console.error('Error creating doctor account:', error);
            status.textContent = 'Unable to create doctor account right now.';
        } finally {
            submit.disabled = false;
        }
    });
}

function setupAdminPharmacyForm() {
    const form = document.getElementById('admin-pharmacy-form');
    const status = document.getElementById('admin-pharmacy-status');
    if (!form || !status) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const payload = {
            role: 'pharmacy',
            name: document.getElementById('admin-pharmacy-name').value.trim(),
            username: document.getElementById('admin-pharmacy-username').value.trim(),
            email: document.getElementById('admin-pharmacy-email').value.trim(),
            password: document.getElementById('admin-pharmacy-password').value
        };
        button.disabled = true;
        status.textContent = 'Creating pharmacy account...';
        try {
            const response = await apiCall('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok) {
                status.textContent = result.error || 'Unable to create pharmacy account.';
                return;
            }
            form.reset();
            status.textContent = `Pharmacy account created for ${result.user?.name || payload.name}.`;
            showNotification('Pharmacy account created.', 'success');
            await loadAdminDashboard();
        } catch (error) {
            console.error('Error creating pharmacy account:', error);
            status.textContent = 'Unable to create pharmacy account right now.';
        } finally {
            button.disabled = false;
        }
    });
}

function setupAdminMourningForm() {
    const form = document.getElementById('admin-mourning-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const mourningMode = document.getElementById('admin-mourning-enabled').checked;
        if (mourningMode && !window.confirm('Enable monochrome mourning mode and publish this memorial notice across the website?')) return;

        const status = document.getElementById('admin-mourning-status');
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = 'Saving site display...';
        try {
            const response = await apiCall('/site-status', {
                method: 'POST',
                body: JSON.stringify({
                    mourningMode,
                    memorialName: document.getElementById('admin-mourning-name').value.trim(),
                    notice: document.getElementById('admin-mourning-notice').value.trim()
                })
            });
            const result = response ? await response.json().catch(() => ({})) : {};
            if (!response || !response.ok || !result.siteStatus) {
                status.textContent = result.error || 'Unable to save site display.';
                return;
            }
            window.applySiteMourningMode?.(result.siteStatus);
            status.textContent = result.message || 'Site display updated.';
            showNotification(result.message || 'Site display updated.', 'success');
        } catch (error) {
            console.error('Error saving mourning mode:', error);
            status.textContent = 'Unable to save site display right now.';
        } finally {
            button.disabled = false;
        }
    });
}

function displayAdminPatients(patients) {
    const container = document.getElementById('admin-patients');
    if (!container) return;

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Patient Code</th>
                    <th>Name</th>
                    <th>Diagnosis</th>
                    <th>Severity</th>
                    <th>Admitted Date</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${patients.map(p => `
                    <tr>
                        <td>${p.patientCode}</td>
                        <td>${p.name}</td>
                        <td>${p.diagnosis}</td>
                        <td><span class="severity-badge severity-${p.severity.toLowerCase()}">${p.severity}</span></td>
                        <td>${new Date(p.admittedDate).toLocaleDateString()}</td>
                        <td>${p.status === 'discharged' ? `Discharged ${p.dischargedAt ? new Date(p.dischargedAt).toLocaleDateString() : ''}` : 'Active'}</td>
                        <td>
                            <button class="btn btn-small btn-danger" onclick="deletePatientRecord(${p.id}, '${(p.patientCode || '').replace(/'/g, "\\'")}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

async function deleteFamilyAccount(userId) {
    const confirmed = window.confirm('Permanently delete this family account? This cannot be undone.');
    if (!confirmed) return;

    try {
        const response = await apiCall(`/users/${userId}`, { method: 'DELETE' });
        if (!response) return;
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showNotification(result.error || 'Unable to delete family account.', 'danger');
            return;
        }

        showNotification('Family account deleted.', 'success');
        await loadAdminDashboard();
    } catch (error) {
        console.error('Error deleting family account:', error);
        showNotification('Unable to delete family account right now.', 'danger');
    }
}

async function deletePatientRecord(patientId, patientCode) {
    const label = patientCode || `ID ${patientId}`;
    const confirmed = window.confirm(`Delete patient ${label}? This action cannot be undone.`);
    if (!confirmed) return;

    try {
        const response = await apiCall(`/patients/${patientId}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            showNotification(`Patient ${label} deleted successfully.`, 'success');
            refreshPatientList();
            return;
        }

        const errorData = response ? await response.json().catch(() => ({})) : {};
        showNotification(errorData.error || 'Unable to delete patient.', 'danger');
    } catch (error) {
        console.error('Error deleting patient:', error);
        showNotification('Unable to delete patient right now.', 'danger');
    }
}

// PATIENT DASHBOARD
async function loadPatientDashboard() {
    const container = document.getElementById('patient-content');
    if (!container) return;

    try {
        const response = await apiCall('/patients/me');
        if (!response || !response.ok) {
            container.innerHTML = `
                <div class="card">
                    <h3>Your Medical Information</h3>
                    <p class="muted-text">Patient profile not linked yet. Please ask staff to update your patient record email.</p>
                </div>
            `;
            return;
        }

        const patient = await response.json();
        patientAssignedDoctorId = Number(patient.assignedDoctor) || null;
        renderPatientHealthPanel(patient);
        loadPatientAppointments();
    } catch (error) {
        console.error('Error loading patient dashboard:', error);
        container.innerHTML = `
            <div class="card">
                <h3>Your Medical Information</h3>
                <p class="muted-text">Unable to load your live vitals right now.</p>
            </div>
        `;
    }
}

async function loadFamilyDashboard() {
    const container = document.getElementById('family-content');
    if (!container) return;

    try {
        const [response, messagesResponse] = await Promise.all([
            apiCall('/patients/me'),
            apiCall('/messages')
        ]);
        if (!response || !response.ok) {
            container.innerHTML = `
                <div class="card">
                    <h3>Family Patient Information</h3>
                    <p class="muted-text">This family profile is not linked to a patient record yet. Please ensure the patient email is registered correctly.</p>
                </div>
            `;
            return;
        }

        const patient = await response.json();
        const messages = messagesResponse && messagesResponse.ok ? await messagesResponse.json() : [];
        renderFamilyHospitalAlerts((Array.isArray(messages) ? messages : []).filter((message) =>
            message.type === 'family-hospital-alert'
            && Number(message.metadata?.patientId) === Number(patient.id)
        ));
        patientAssignedDoctorId = Number(patient.assignedDoctor) || null;
        renderPatientHealthPanel(patient, 'family-content');
        loadFamilyClinicalRecords();
        loadFamilyDeathRecords();
        loadFamilyAppointments();
        loadMedicalDocuments('family-medical-document-list', Number(patient.id));
    } catch (error) {
        console.error('Error loading family dashboard:', error);
        container.innerHTML = `
            <div class="card">
                <h3>Family Patient Information</h3>
                <p class="muted-text">Unable to load the patient information right now.</p>
            </div>
        `;
    }
}

function renderFamilyHospitalAlerts(alerts) {
    const container = document.getElementById('family-urgent-alerts');
    if (!container) return;

    const latestAlerts = alerts
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
        .slice(0, 5);
    const signature = latestAlerts.map((alert) => `${alert.id}:${alert.read ? 1 : 0}`).join('|');
    if (signature === familyHospitalAlertSignature) return;
    familyHospitalAlertSignature = signature;
    container.replaceChildren();

    latestAlerts.forEach((alert) => {
        const item = document.createElement('article');
        item.className = 'family-hospital-alert';
        item.setAttribute('role', 'alert');

        const title = document.createElement('h2');
        title.textContent = alert.title || 'Urgent: please come to the hospital';
        const content = document.createElement('p');
        content.textContent = alert.content || 'The doctor has requested that family come to the hospital now.';
        const timestamp = document.createElement('time');
        timestamp.dateTime = alert.timestamp || '';
        timestamp.textContent = alert.timestamp ? new Date(alert.timestamp).toLocaleString() : '';

        item.append(title, content, timestamp);
        container.append(item);
    });
}

function buildPatientHeartRateHistory(patient) {
    const severity = (patient?.severity || 'Moderate').toLowerCase();
    const baselineMap = {
        critical: 108,
        severe: 96,
        moderate: 82,
        mild: 72
    };

    const baseline = Number(patient?.vitals?.heartRate) || baselineMap[severity] || 82;
    const pattern = [
        baseline - 10,
        baseline - 6,
        baseline - 2,
        baseline + 4,
        baseline + 2,
        baseline,
        baseline - 3,
        baseline + 5,
        baseline + 1,
        baseline
    ];

    return pattern.map((value, index) => ({
        ts: Date.now() - (pattern.length - index) * 1800,
        heartRate: Math.max(50, Math.min(120, Math.round(value))),
        respiratoryRate: Number(patient?.vitals?.respiratoryRate) || 16 + (index % 3),
        oxygenSaturation: Number(patient?.vitals?.oxygenSaturation) || 97,
        bloodPressure: patient?.vitals?.bloodPressure || '120/80'
    }));
}

function getFamilyDisplayVitals(patient) {
    const recordedVitals = patient?.vitals || {};
    const hasRecordedHeartRate = Number.isFinite(Number(recordedVitals.heartRate)) && Number(recordedVitals.heartRate) > 0;
    const hasRecordedBloodPressure = /^\s*\d{2,3}\s*\/\s*\d{2,3}\s*$/.test(String(recordedVitals.bloodPressure || ''));

    if (hasRecordedHeartRate || hasRecordedBloodPressure) {
        return { vitals: recordedVitals, simulated: false };
    }

    const severity = String(patient?.severity || 'Moderate');
    const severityKey = severity.toLowerCase();
    const profileKey = `${patient?.id || 'unlinked'}:${severityKey}`;
    if (!familyDemoVitalsByPatient.has(profileKey)) {
        const profiles = {
            critical: { hr: [118, 138], systolic: [145, 175], diastolic: [90, 112] },
            severe: { hr: [98, 118], systolic: [130, 158], diastolic: [82, 102] },
            moderate: { hr: [78, 99], systolic: [118, 143], diastolic: [72, 92] },
            mild: { hr: [62, 88], systolic: [108, 132], diastolic: [65, 85] }
        };
        const profile = profiles[severityKey] || profiles.moderate;
        const randomInRange = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));
        familyDemoVitalsByPatient.set(profileKey, {
            heartRate: randomInRange(profile.hr),
            bloodPressure: `${randomInRange(profile.systolic)}/${randomInRange(profile.diastolic)}`,
            lastUpdated: new Date().toISOString()
        });
    }

    return { vitals: { ...recordedVitals, ...familyDemoVitalsByPatient.get(profileKey) }, simulated: true };
}

function renderPatientHealthPanel(patient, targetId = 'patient-content') {
    const container = document.getElementById(targetId);
    if (!container) return;

    const isFamilyView = targetId === 'family-content';
    const familyVitals = isFamilyView ? getFamilyDisplayVitals(patient) : null;
    const vitals = familyVitals ? familyVitals.vitals : (patient?.vitals || {});
    const isSimulated = Boolean(familyVitals?.simulated);
    const severity = patient?.severity || 'Moderate';
    const doctorName = getDoctorLabel(patient?.assignedDoctor);
    const updatedAt = vitals.lastUpdated ? new Date(vitals.lastUpdated) : new Date();
    if (!isFamilyView) {
        patientVitalsHistory = buildPatientHeartRateHistory(patient);
    }

    const heartRatePanel = isFamilyView
        ? buildFamilyEcgGuide(vitals.heartRate, severity, isSimulated)
        : `
            <div class="patient-hr-chart-wrap">
                <div class="chart-header-row">
                    <h4>Heart Rate Trend</h4>
                    <span class="muted-text">Updated ${updatedAt.toLocaleTimeString()}</span>
                </div>
                <canvas id="patient-hr-chart" width="860" height="220" aria-label="Heart rate trend chart"></canvas>
                <div class="chart-legend-inline">
                    <span><i class="legend-dot hr"></i>Heart Rate</span>
                    <span><i class="legend-dot safe"></i>Normal Band (60-100 bpm)</span>
                    <span><i class="legend-dot danger"></i>Critical Thresholds (&lt;50 / &gt;120)</span>
                </div>
            </div>
        `;

    container.innerHTML = `
        <div class="card patient-monitor-card">
            <div class="patient-monitor-head">
                <div>
                    <h3>${patient.name} (${patient.patientCode || 'N/A'})</h3>
                    <p><strong>Diagnosis:</strong> ${patient.diagnosis || '-'}</p>
                    <p><strong>Doctor In Charge:</strong> ${doctorName}</p>
                </div>
                <span class="severity-badge severity-${severity.toLowerCase()}">${severity}</span>
            </div>

            <div id="patient-vitals-alerts" class="patient-alert-stack"></div>

            ${isFamilyView && isSimulated ? '<p class="family-vitals-source">Simulated demo values based on severity. These are not patient readings.</p>' : ''}

            <div class="vitals-grid">
                <div class="vital-item"><div class="label">Heart Rate</div><div class="value">${vitals.heartRate ?? '-'} bpm</div></div>
                <div class="vital-item"><div class="label">Respiratory</div><div class="value">${vitals.respiratoryRate ?? '-'} /min</div></div>
                <div class="vital-item"><div class="label">SpO2</div><div class="value">${vitals.oxygenSaturation ?? '-'}%</div></div>
                <div class="vital-item"><div class="label">Blood Pressure</div><div class="value">${vitals.bloodPressure ?? '-'}</div></div>
                <div class="vital-item"><div class="label">Temperature</div><div class="value">${vitals.temperature ?? '-'}°C</div></div>
            </div>

            ${heartRatePanel}
        </div>
    `;

    if (!isFamilyView && vitals.heartRate) {
        patientVitalsHistory = [{
            ts: Date.now(),
            heartRate: Number(vitals.heartRate),
            respiratoryRate: Number(vitals.respiratoryRate) || 16,
            oxygenSaturation: Number(vitals.oxygenSaturation) || 97,
            bloodPressure: String(vitals.bloodPressure || '120/80')
        }, ...patientVitalsHistory.slice(0, MAX_PATIENT_HISTORY_POINTS - 1)];
    }

    if (!isFamilyView) renderPatientHrChart();
    if (!isFamilyView || !isSimulated) renderPatientVitalAlerts(vitals);
}

function buildFamilyEcgGuide(heartRate, severity, isSimulated) {
    const bpm = Number(heartRate);
    const hasHeartRate = Number.isFinite(bpm) && bpm > 0;
    const points = [];
    if (hasHeartRate) {
        const spacing = Math.max(28, Math.min(90, 82 - (bpm - 60) * 0.5));
        for (let position = 0; position < 520; position += spacing) {
            points.push(
                [position, 26],
                [position + spacing * 0.13, 26],
                [position + spacing * 0.18, 23],
                [position + spacing * 0.23, 26],
                [position + spacing * 0.34, 26],
                [position + spacing * 0.39, 32],
                [position + spacing * 0.43, 7],
                [position + spacing * 0.48, 35],
                [position + spacing * 0.55, 26],
                [position + spacing * 0.73, 21],
                [position + spacing * 0.83, 26],
                [position + spacing, 26]
            );
        }
    }
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1]}`).join(' ');
    const readingLabel = hasHeartRate ? `${Math.round(bpm)} bpm` : 'No heart-rate reading';
    const sourceLabel = isSimulated ? `${severity} demo profile` : 'Recorded reading';
    const trace = hasHeartRate
        ? `<svg class="family-ecg-trace" viewBox="0 0 520 52" preserveAspectRatio="none" role="img" aria-label="One illustrative heart-rate trace"><path d="${path}"></path></svg>`
        : '<p class="family-ecg-no-signal">No heart-rate reading is recorded yet.</p>';

    return `
        <section class="family-ecg-panel" aria-label="Heart rate pattern guide">
            <div class="family-ecg-heading">
                <div>
                    <h4>Heart-rate pattern</h4>
                    <p><strong>${readingLabel}</strong> · ${sourceLabel}</p>
                </div>
            </div>
            <div class="family-ecg-row is-current">
                ${trace}
            </div>
            <p class="family-ecg-note">Illustrative trace only, not an ECG recording or diagnosis. ${isSimulated ? 'Demo values change by severity and are not real patient measurements.' : ''}</p>
        </section>
    `;
}

function pushPatientVitalsHistory(vitals) {
    const hr = Number(vitals?.heartRate);
    if (!Number.isFinite(hr)) return;

    const sample = {
        ts: Date.now(),
        heartRate: hr,
        respiratoryRate: Number(vitals?.respiratoryRate),
        oxygenSaturation: Number(vitals?.oxygenSaturation),
        bloodPressure: String(vitals?.bloodPressure || '')
    };

    patientVitalsHistory.push(sample);
    if (patientVitalsHistory.length > MAX_PATIENT_HISTORY_POINTS) {
        patientVitalsHistory = patientVitalsHistory.slice(-MAX_PATIENT_HISTORY_POINTS);
    }
}

function renderPatientHrChart() {
    const canvas = document.getElementById('patient-hr-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 860;
    const cssHeight = 220;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const width = cssWidth;
    const height = cssHeight;
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 16, right: 16, bottom: 28, left: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const minY = 40;
    const maxY = 140;
    const toY = (v) => pad.top + (maxY - v) / (maxY - minY) * plotH;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const normalTop = toY(100);
    const normalBottom = toY(60);
    ctx.fillStyle = 'rgba(22, 163, 74, 0.10)';
    ctx.fillRect(pad.left, normalTop, plotW, normalBottom - normalTop);

    ctx.strokeStyle = 'rgba(220, 38, 38, 0.45)';
    ctx.setLineDash([6, 6]);
    [50, 120].forEach((line) => {
        const y = toY(line);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    [40, 60, 80, 100, 120, 140].forEach((line) => {
        const y = toY(line);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
    });

    ctx.fillStyle = '#475569';
    ctx.font = '12px Segoe UI, sans-serif';
    [40, 60, 80, 100, 120, 140].forEach((line) => {
        const y = toY(line);
        ctx.fillText(String(line), 4, y + 4);
    });

    if (!patientVitalsHistory.length) {
        ctx.fillStyle = '#64748b';
        ctx.fillText('Waiting for heart rate updates...', pad.left + 10, pad.top + 24);
        return;
    }

    const points = patientVitalsHistory.map((item, index, arr) => {
        const x = arr.length === 1 ? pad.left + plotW / 2 : pad.left + (index / (arr.length - 1)) * plotW;
        const y = toY(Math.max(minY, Math.min(maxY, item.heartRate)));
        return { x, y, raw: item };
    });

    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    points.forEach((p) => {
        const critical = p.raw.heartRate < 50 || p.raw.heartRate > 120;
        ctx.fillStyle = critical ? '#dc2626' : '#0f766e';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

function parseBloodPressure(value) {
    const match = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(String(value || ''));
    if (!match) return null;

    return {
        systolic: Number(match[1]),
        diastolic: Number(match[2])
    };
}

function getVitalsAlerts(vitals) {
    const alerts = [];
    const hr = Number(vitals?.heartRate);
    const rr = Number(vitals?.respiratoryRate);
    const spo2 = Number(vitals?.oxygenSaturation);
    const bp = parseBloodPressure(vitals?.bloodPressure);

    if (Number.isFinite(hr) && (hr < 50 || hr > 120)) {
        alerts.push({
            level: 'danger',
            title: 'Heart Rate Alert',
            detail: `Heart rate ${hr} bpm is outside safe range (50-120).`
        });
    }

    if (Number.isFinite(rr) && (rr < 10 || rr > 24)) {
        alerts.push({
            level: 'warning',
            title: 'Respiratory Alert',
            detail: `Respiratory rate ${rr}/min is outside normal range (10-24).`
        });
    }

    if (Number.isFinite(spo2) && spo2 < 94) {
        alerts.push({
            level: spo2 < 90 ? 'danger' : 'warning',
            title: 'Oxygen Alert',
            detail: `SpO2 at ${spo2}% is low${spo2 < 90 ? ' and needs immediate review' : ''}.`
        });
    }

    if (bp && (bp.systolic >= 180 || bp.diastolic >= 120 || bp.systolic < 90)) {
        alerts.push({
            level: 'danger',
            title: 'Blood Pressure Alert',
            detail: `BP ${bp.systolic}/${bp.diastolic} mmHg indicates critical systolic/diastolic status.`
        });
    }

    return alerts;
}

function renderPatientVitalAlerts(vitals) {
    const container = document.getElementById('patient-vitals-alerts');
    if (!container) return;

    const alerts = getVitalsAlerts(vitals);
    if (!alerts.length) {
        container.innerHTML = '<div class="patient-alert-ok">Vitals are currently in a stable range.</div>';
        patientVitalsAlertSignature = '';
        return;
    }

    container.innerHTML = alerts.map((alert) => `
        <div class="patient-alert ${alert.level}">
            <strong>${alert.title}</strong>
            <span>${alert.detail}</span>
        </div>
    `).join('');

    const signature = alerts.map((item) => `${item.title}:${item.detail}`).join('|');
    if (signature !== patientVitalsAlertSignature) {
        showNotification(`Patient monitor alert: ${alerts[0].detail}`, alerts[0].level === 'danger' ? 'danger' : 'warning');
        patientVitalsAlertSignature = signature;
    }
}

// UTILITY FUNCTIONS
function refreshPatientList() {
    const role = currentUser.role;
    if (role === 'doctor') loadDoctorDashboard();
    else if (role === 'staff') loadStaffDashboard();
    else if (role === 'admin') loadAdminDashboard();
}

function updatePatientInUI(patient) {
    refreshPatientList();
}

function updateVitalsInUI(patient) {
    const vitalsContainer = document.querySelector(`[data-vitals-id="${patient.id}"]`);
    if (vitalsContainer) {
        vitalsContainer.innerHTML = `
            <div class="vital-item">
                <div class="label">Temperature</div>
                <div class="value">${patient.vitals.temperature || '-'}°C</div>
            </div>
            <div class="vital-item">
                <div class="label">BP</div>
                <div class="value">${patient.vitals.bloodPressure || '-'}</div>
            </div>
            <div class="vital-item">
                <div class="label">HR</div>
                <div class="value">${patient.vitals.heartRate || '-'}</div>
            </div>
            <div class="vital-item">
                <div class="label">RR</div>
                <div class="value">${patient.vitals.respiratoryRate || '-'}</div>
            </div>
        `;
    }
}

function setupStaffPatientForm() {
    const form = document.getElementById('staff-new-patient-form');
    const status = document.getElementById('new-patient-status');
    const categorySelect = document.getElementById('new-patient-category');
    if (!form) return;

    if (categorySelect) {
        categorySelect.addEventListener('change', populateDoctorSelect);
    }

    populateDoctorSelect();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedDoctorId = document.getElementById('new-patient-doctor').value;
        const selectedDoctor = getDoctorById(selectedDoctorId);

        const payload = {
            name: document.getElementById('new-patient-name').value.trim(),
            patientCode: document.getElementById('new-patient-code').value.trim(),
            age: document.getElementById('new-patient-age').value ? parseInt(document.getElementById('new-patient-age').value) : null,
            gender: document.getElementById('new-patient-gender').value.trim() || 'Unknown',
            bloodType: document.getElementById('new-patient-blood-type').value.trim() || 'Unknown',
            phone: document.getElementById('new-patient-phone').value.trim(),
            email: document.getElementById('new-patient-email').value.trim(),
            address: document.getElementById('new-patient-address').value.trim(),
            diagnosis: document.getElementById('new-patient-diagnosis').value.trim(),
            sicknessCategory: document.getElementById('new-patient-category').value,
            severity: document.getElementById('new-patient-severity').value,
            assignedDoctor: selectedDoctorId ? parseInt(selectedDoctorId) : null,
            requiredDoctorDepartment: selectedDoctor ? selectedDoctor.department : null,
            assignedStaff: currentUser.id || null
        };

        if (!payload.name || !payload.patientCode || !payload.diagnosis || !payload.assignedDoctor) {
            if (status) {
                status.textContent = 'Please complete name, patient code, diagnosis, and doctor in charge.';
            }
            return;
        }

        try {
            const response = await apiCall('/patients', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (response && response.ok) {
                form.reset();
                if (status) {
                    status.textContent = 'Patient created successfully.';
                }
                showNotification('New patient created successfully.', 'success');
                refreshPatientList();
            } else {
                const errorData = response
                    ? await response.json().catch(() => ({}))
                    : { error: 'Your login session expired. Please log in again.' };
                if (status) {
                    status.textContent = errorData.error || `Unable to create patient (HTTP ${response.status}).`;
                }
            }
        } catch (error) {
            console.error('Error creating patient:', error);
            if (status) {
                status.textContent = 'Unable to create patient right now.';
            }
        }
    });
}

function setupDashboardTools() {
    const searchInput = document.getElementById('dashboard-view-search');
    const sectionLabel = document.getElementById('dashboard-section-name');
    const dateLabel = document.getElementById('dashboard-date');
    if (!searchInput) return;

    if (dateLabel) {
        dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        }).format(new Date());
    }

    let activeSectionId = '';
    const searchableItems = 'tbody tr, .priority-watch-item, .admin-leave-row, .admin-bulletin-item, .admin-doctor-card, .clinical-card, .stat-card, .patient-card, .appointment-card, .doctor-card';

    const refreshDashboardTools = () => {
        const activeSection = document.querySelector('.content-section.active');
        if (!activeSection) return;

        if (sectionLabel) {
            const heading = activeSection.querySelector('.header h1');
            sectionLabel.textContent = heading ? heading.textContent.trim() : 'Overview';
        }

        if (activeSection.id !== activeSectionId) {
            activeSectionId = activeSection.id;
            searchInput.value = '';
        }

        const query = searchInput.value.trim().toLocaleLowerCase();
        activeSection.querySelectorAll(searchableItems).forEach((item) => {
            item.hidden = query !== '' && !item.textContent.toLocaleLowerCase().includes(query);
        });
    };

    searchInput.addEventListener('input', refreshDashboardTools);
    document.addEventListener('keydown', (event) => {
        const target = event.target;
        const isEditing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
        if (event.key === '/' && !isEditing && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            searchInput.focus();
        } else if (event.key === 'Escape' && document.activeElement === searchInput) {
            searchInput.value = '';
            searchInput.blur();
            refreshDashboardTools();
        }
    });

    const observer = new MutationObserver(refreshDashboardTools);
    document.querySelectorAll('.content-section').forEach((section) => {
        observer.observe(section, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    });
    refreshDashboardTools();
}

function openRoleAlerts() {
    if (!currentUser || typeof switchSection !== 'function') return;

    const roleTarget = {
        admin: 'admin-section',
        doctor: 'doctor-messages-section',
        staff: 'staff-patients-section',
        pharmacy: 'pharmacy-section',
        patient: 'patient-messages-section',
        family: 'family-section'
    };
    const target = roleTarget[currentUser.role];
    if (target) switchSection(target);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupDashboardTools();
    setupStaffPatientForm();
    setupAdminBulletinForm();
    setupAdminMourningForm();
    setupAdminDoctorForm();
    setupAdminPharmacyForm();
    setupClinicalForms();
    setupMedicineStockForm();
    setupMedicalDocumentForm();
    setupFamilyMedicineRequestForm();
    setupDeathCertificateForm();
    const doctorLeaveForm = document.getElementById('doctor-leave-form');
    if (doctorLeaveForm) {
        doctorLeaveForm.addEventListener('submit', submitDoctorLeave);
    }
    if (document.getElementById('loginForm') === null && isLoggedIn()) {
        initializeDashboard();
    }
});
