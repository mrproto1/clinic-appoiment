function getProjectBasePath() {
    if (typeof window === 'undefined' || window.location.protocol === 'file:') return '';

    const pathName = window.location.pathname || '/';
    const segments = pathName.split('/').filter(Boolean);
    if (!segments.length) return '';

    const rootLikeFolders = ['src', 'pages', 'js', 'css', 'images', 'assets', 'api'];
    const first = segments[0];

    if (first.includes('.') || rootLikeFolders.includes(first.toLowerCase())) {
        return '';
    }

    return `/${first}`;
}

function resolveApiBase() {
    const runtimeBase = window.APP_RUNTIME_CONFIG && typeof window.APP_RUNTIME_CONFIG.apiBase === 'string'
        ? window.APP_RUNTIME_CONFIG.apiBase.trim()
        : '';

    if (runtimeBase !== '') {
        return runtimeBase.replace(/\/+$/, '');
    }

    return `${window.location.origin}${getProjectBasePath()}/api`;
}

const API_BASE = resolveApiBase();

function formatDoctorSchedule(doctor) {
    const dept = doctor.department || 'Specialist';
    return `24-hour booking enabled (00:00-23:59) • ${dept}`;
}

function getStoredPatientEmail() {
    return localStorage.getItem('lastAppointmentEmail') || '';
}

function setStoredPatientEmail(email) {
    if (email) {
        localStorage.setItem('lastAppointmentEmail', email);
    }
}

async function loadAvailability(doctorId, dateInput, slotContainer, dateLabel, timeInput) {
    if (!doctorId || !dateInput.value) {
        slotContainer.innerHTML = '<p class="muted-text">Choose a doctor and date to view available slots.</p>';
        dateLabel.textContent = 'Choose a date';
        return;
    }

    slotContainer.innerHTML = '<p class="muted-text">Loading available slots...</p>';
    dateLabel.textContent = new Date(`${dateInput.value}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    const response = await fetchJson(`/appointments/availability?doctorId=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(dateInput.value)}`);
    if (!response.ok || !response.data || !Array.isArray(response.data.slots)) {
        slotContainer.innerHTML = '<p class="muted-text">Availability is unavailable right now.</p>';
        return;
    }

    slotContainer.innerHTML = response.data.slots.map((slot) => `
        <button type="button" class="availability-slot ${slot.available ? '' : 'is-booked'}" ${slot.available ? '' : 'disabled'} data-time="${slot.time}">
            <span>${slot.time}</span>
            <small>${slot.available ? 'Available' : 'Booked'}</small>
        </button>
    `).join('');

    slotContainer.querySelectorAll('.availability-slot:not(.is-booked)').forEach((slot) => {
        slot.addEventListener('click', () => {
            slotContainer.querySelectorAll('.availability-slot').forEach((item) => item.classList.remove('is-selected'));
            slot.classList.add('is-selected');
            timeInput.value = slot.dataset.time;
        });
    });
}

async function fetchJson(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });

        const text = await response.text();
        let payload = null;

        if (text) {
            try {
                payload = JSON.parse(text);
            } catch (_) {
                payload = { error: text };
            }
        }

        return { ok: response.ok, status: response.status, data: payload };
    } catch (error) {
        return { ok: false, status: 0, data: { error: error instanceof Error ? error.message : 'Network error' } };
    }
}

function renderAppointments(appointments, doctorsById) {
    const container = document.getElementById('appointments-container');
    if (!container) return;

    if (!appointments.length) {
        container.innerHTML = '<div class="appointment-card">No appointments yet. Book one to assign it to the selected doctor list.</div>';
        return;
    }

    const grouped = appointments.reduce((acc, item) => {
        const key = String(item.doctorId || 'unknown');
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    const html = Object.keys(grouped).map((doctorId) => {
        const doctor = doctorsById.get(Number(doctorId));
        const doctorName = doctor ? doctor.name : (grouped[doctorId][0].doctorName || 'Unknown Doctor');
        const specialty = doctor ? (doctor.department || 'Specialist') : (grouped[doctorId][0].doctorDepartment || 'Specialist');

        const rows = grouped[doctorId]
            .sort((a, b) => (`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`))
            .map((item) => `
                <li>${item.date} ${item.time} • ${item.patientName} (${item.patientPhone})</li>
            `).join('');

        return `
            <article class="appointment-card">
                <h3>${doctorName}</h3>
                <p class="muted-text">${specialty}</p>
                <ul>${rows}</ul>
            </article>
        `;
    }).join('');

    container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('new-appointment-form');
    const doctorSelect = document.getElementById('doctor-select');
    const doctorSchedulePreview = document.getElementById('doctor-schedule-preview');
    const dateInput = document.getElementById('appointment-date');
    const timeInput = document.getElementById('appointment-time');
    const availabilitySlots = document.getElementById('availability-slots');
    const availabilityDateLabel = document.getElementById('availability-date-label');
    const status = document.getElementById('appointment-form-status');
    const emailInput = document.getElementById('patient-email');

    if (!form || !doctorSelect || !dateInput || !status || !emailInput) return;

    dateInput.min = new Date().toISOString().split('T')[0];
    emailInput.value = getStoredPatientEmail();

    const doctorsResponse = await fetchJson('/users/role/doctor');
    if (!doctorsResponse.ok || !Array.isArray(doctorsResponse.data) || doctorsResponse.data.length === 0) {
        status.textContent = 'Unable to load doctors from server. Please verify Apache and MySQL are running.';
        return;
    }

    const doctors = doctorsResponse.data;
    const doctorsById = new Map(doctors.map((doctor) => [Number(doctor.id), doctor]));

    doctorSelect.innerHTML = '<option value="">-- Choose a doctor --</option>' + doctors.map((doctor) => {
        const label = `${doctor.name} (${doctor.department || 'Specialist'})`;
        return `<option value="${doctor.id}">${label}</option>`;
    }).join('');

    doctorSelect.addEventListener('change', () => {
        const doctor = doctorsById.get(Number(doctorSelect.value));
        doctorSchedulePreview.value = doctor
            ? formatDoctorSchedule(doctor)
            : 'Select a doctor to view specialty schedule';
        loadAvailability(doctorSelect.value, dateInput, availabilitySlots, availabilityDateLabel, timeInput);
    });

    dateInput.addEventListener('change', () => {
        loadAvailability(doctorSelect.value, dateInput, availabilitySlots, availabilityDateLabel, timeInput);
    });

    async function refreshAppointments() {
        const encodedEmail = encodeURIComponent(emailInput.value.trim());
        const endpoint = encodedEmail ? `/appointments?patientEmail=${encodedEmail}` : '/appointments';
        const appointmentsResponse = await fetchJson(endpoint);
        const appointments = appointmentsResponse.ok && Array.isArray(appointmentsResponse.data)
            ? appointmentsResponse.data
            : [];
        renderAppointments(appointments, doctorsById);
    }

    await refreshAppointments();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const selectedDoctor = doctorsById.get(Number(doctorSelect.value));
        if (!selectedDoctor) {
            status.textContent = 'Please select a valid doctor.';
            return;
        }

        const payload = {
            patientName: document.getElementById('patient-name').value.trim(),
            patientEmail: emailInput.value.trim(),
            patientPhone: document.getElementById('patient-phone').value.trim(),
            date: dateInput.value,
            time: document.getElementById('appointment-time').value,
            doctorId: Number(doctorSelect.value)
        };

        if (!payload.patientName || !payload.patientEmail || !payload.patientPhone || !payload.date || !payload.time || !payload.doctorId) {
            status.textContent = 'Please complete all appointment fields.';
            return;
        }

        const result = await fetchJson('/appointments', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!result.ok) {
            status.textContent = (result.data && result.data.error) ? result.data.error : 'Unable to book appointment right now.';
            return;
        }

        setStoredPatientEmail(payload.patientEmail);
        status.textContent = `Appointment booked with ${selectedDoctor.name}. It is now in the doctor's appointment list.`;
        form.reset();
        emailInput.value = payload.patientEmail;
        doctorSchedulePreview.value = 'Select a doctor to view specialty schedule';
        await refreshAppointments();
    });
});