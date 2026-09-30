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

window.applySiteMourningMode = function applySiteMourningMode(siteStatus) {
    const active = Boolean(siteStatus && siteStatus.mourningMode);
    document.body.classList.toggle('mourning-mode', active);

    const existingBanner = document.getElementById('site-mourning-banner');
    if (!active) {
        existingBanner?.remove();
        return;
    }

    const banner = existingBanner || document.createElement('aside');
    banner.id = 'site-mourning-banner';
    banner.className = 'site-mourning-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.replaceChildren();

    const title = document.createElement('strong');
    title.textContent = siteStatus.memorialName
        ? `In Memoriam · ${siteStatus.memorialName}`
        : 'In Memoriam';
    banner.append(title);

    if (siteStatus.notice) {
        const notice = document.createElement('span');
        notice.textContent = siteStatus.notice;
        banner.append(notice);
    }

    if (!existingBanner) {
        document.body.prepend(banner);
    }
};

fetch(`${window.APP_RUNTIME_CONFIG.apiBase.replace(/\/+$/, '')}/site-status`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((siteStatus) => {
        if (siteStatus) window.applySiteMourningMode(siteStatus);
    })
    .catch(() => {});