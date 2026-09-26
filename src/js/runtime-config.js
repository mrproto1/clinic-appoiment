window.APP_RUNTIME_CONFIG = window.APP_RUNTIME_CONFIG || (function buildRuntimeConfig() {
    if (typeof window === 'undefined') {
        return { apiBase: '' };
    }

    const override = (window.__APP_API_BASE__ || window.APP_API_BASE_URL || '').toString().trim();
    if (override) {
        return { apiBase: override.replace(/\/+$/, '') };
    }

    const pathName = window.location.pathname || '/';
    let projectBasePath = '';

    const srcIndex = pathName.indexOf('/src/');
    if (srcIndex !== -1) {
        projectBasePath = pathName.substring(0, srcIndex);
    }

    const apiBase = `${window.location.origin}${projectBasePath}/api`.replace(/\/+$/, '/api');

    return {
        apiBase
    };
})();