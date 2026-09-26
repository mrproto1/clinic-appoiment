// Authentication Module
function getAppBasePath() {
    if (typeof window === 'undefined') return '/';

    const pathName = window.location.pathname || '/';
    const lastSlashIndex = pathName.lastIndexOf('/');
    if (lastSlashIndex <= 0) return '/';

    return pathName.substring(0, lastSlashIndex + 1);
}

function getProjectBasePath() {
    if (typeof window === 'undefined') return '';

    if (window.location.protocol === 'file:') return '';

    const pathName = window.location.pathname || '/';
    const srcMarker = '/src/';
    const srcIndex = pathName.indexOf(srcMarker);

    if (srcIndex !== -1) {
        return pathName.substring(0, srcIndex);
    }

    const apiIndex = pathName.indexOf('/api/');
    if (apiIndex !== -1) {
        return pathName.substring(0, apiIndex);
    }

    const segments = pathName.split('/').filter(Boolean);
    if (segments.length === 0) return '';

    const first = segments[0];
    const rootLikeFolders = ['src', 'pages', 'js', 'css', 'images', 'assets', 'api'];

    if (first.includes('.') || rootLikeFolders.includes(first.toLowerCase())) {
        return '';
    }

    return `/${first}`;
}

function getAppBaseUrl() {
    if (typeof window === 'undefined') return '';

    if (window.location.protocol === 'file:') {
        return '';
    }

    return window.location.origin;
}

function resolveApiBase() {
    const runtimeBase = window.APP_RUNTIME_CONFIG && typeof window.APP_RUNTIME_CONFIG.apiBase === 'string'
        ? window.APP_RUNTIME_CONFIG.apiBase.trim()
        : '';

    if (runtimeBase !== '') {
        return runtimeBase.replace(/\/+$/, '');
    }

    return `${getAppBaseUrl()}${getProjectBasePath().replace(/\/+$/, '')}/api`;
}

const APP_BASE_URL = getAppBaseUrl();
const PROJECT_BASE_PATH = getProjectBasePath().replace(/\/+$/, '');
const API_BASE = resolveApiBase();
const AUTH_API = `${API_BASE}/auth`;
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

// Check if user is logged in
function isLoggedIn() {
    return !!authToken && !!currentUser.id;
}

// Redirect to login if not authenticated
function requireAuth() {
    if (!isLoggedIn()) {
        window.location.href = `${getAppBasePath()}index.html`;
        return false;
    }
    return true;
}

async function registerAccount(payload) {
    const response = await fetch(`${AUTH_API}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
    }

    return data;
}

// Login function
async function login(username, password) {
    try {
        const response = await fetch(`${AUTH_API}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const raw = await response.text();
            let errorMessage = 'Login failed';

            try {
                const error = JSON.parse(raw);
                errorMessage = error.error || errorMessage;
            } catch (_) {
                errorMessage = raw && raw.trim().length > 0
                    ? raw.substring(0, 180)
                    : errorMessage;
            }

            throw new Error(errorMessage);
        }

        const responseText = await response.text();
        let data;

        try {
            data = JSON.parse(responseText);
        } catch (_) {
            throw new Error('Server returned non-JSON response. Please check API path and Apache rewrite settings.');
        }

        authToken = data.token;
        currentUser = data.user;

        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        showLoginSuccess(currentUser.name, currentUser.role);
        setTimeout(() => redirectToDashboard(currentUser.role), 1100);
        return true;
    } catch (error) {
        console.error('Login error:', error);
        const message = error instanceof Error && error.message
            ? error.message
            : 'Unable to connect to the server.';
        throw new Error(message === 'Failed to fetch'
            ? 'Unable to connect to the server. Please make sure the app is running.'
            : message);
    }
}

// Redirect to role-specific dashboard
function redirectToDashboard(role) {
    const dashboardMap = {
        'doctor': 'dashboard.html?role=doctor',
        'staff': 'dashboard.html?role=staff',
        'admin': 'dashboard.html?role=admin',
        'patient': 'dashboard.html?role=patient',
        'family': 'dashboard.html?role=family'
    };

    const targetPath = dashboardMap[role] || 'index.html';
    const normalizedTargetPath = targetPath.replace(/^\/+/, '');
    const destination = `${getAppBasePath()}${normalizedTargetPath}`;

    window.location.href = window.location.protocol === 'file:'
        ? `./${normalizedTargetPath}`
        : destination;
}

function showLoginSuccess(name, role) {
    const overlay = document.getElementById('login-success-overlay');
    if (!overlay) return;

    const title = overlay.querySelector('.success-title');
    const subtitle = overlay.querySelector('.success-subtitle');
    const formattedRole = role.charAt(0).toUpperCase() + role.slice(1);

    title.textContent = `Welcome ${formattedRole}`;
    subtitle.textContent = `${name}, preparing your ${formattedRole} dashboard...`;
    overlay.classList.add('visible');
}

// Logout function
function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    authToken = null;
    currentUser = {};
    const loginDestination = `${getAppBasePath()}index.html`;
    window.location.href = window.location.protocol === 'file:'
        ? './index.html'
        : loginDestination;
}

// Make authenticated API call
async function apiCall(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        ...options.headers
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            logout();
            return null;
        }

        return response;
    } catch (error) {
        throw error;
    }
}

// Login form handler
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('errorMessage');

        try {
            errorDiv.classList.remove('show');
            await login(username, password);
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.add('show');
        }
    });
}

if (document.getElementById('familySignupForm')) {
    document.getElementById('familySignupForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const signupName = document.getElementById('signup-name').value.trim();
        const signupEmail = document.getElementById('signup-email').value.trim();
        const signupPassword = document.getElementById('signup-password').value;
        const patientEmail = document.getElementById('linked-patient-email').value.trim();
        const relationship = document.getElementById('relationship').value.trim();
        const signupMessage = document.getElementById('signupMessage');
        const errorDiv = document.getElementById('errorMessage');

        try {
            if (signupMessage) signupMessage.textContent = '';
            if (errorDiv) errorDiv.classList.remove('show');

            const registration = await registerAccount({
                username: signupEmail,
                name: signupName,
                email: signupEmail,
                password: signupPassword,
                role: 'family',
                patientEmail,
                relationship
            });

            if (signupMessage) {
                signupMessage.textContent = 'Family account created successfully. Logging in...';
                signupMessage.style.color = '#1d7a5c';
            }

            await login(signupEmail, signupPassword);
            if (registration && registration.user) {
                return;
            }
        } catch (error) {
            if (signupMessage) {
                signupMessage.textContent = error.message;
                signupMessage.style.color = '#b42318';
            }
            if (errorDiv) {
                errorDiv.textContent = error.message;
                errorDiv.classList.add('show');
            }
        }
    });
}
