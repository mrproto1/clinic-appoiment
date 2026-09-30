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
    const existingDialog = document.getElementById('site-mourning-dialog');
    if (!active) {
        existingBanner?.remove();
        existingDialog?.close();
        existingDialog?.remove();
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

    const revision = siteStatus.updatedAt || `${siteStatus.memorialName || ''}:${siteStatus.notice || ''}`;
    const popupKey = `mourningNoticeSeen:${revision}`;
    try {
        if (sessionStorage.getItem(popupKey)) return;
        sessionStorage.setItem(popupKey, '1');
    } catch (_) {
        return;
    }

    const dialog = document.createElement('dialog');
    dialog.id = 'site-mourning-dialog';
    dialog.className = 'site-mourning-dialog';
    dialog.setAttribute('aria-labelledby', 'site-mourning-dialog-title');
    const frame = document.createElement('div');
    frame.className = 'site-mourning-dialog-frame';
    const kicker = document.createElement('p');
    kicker.className = 'site-mourning-dialog-kicker';
    kicker.textContent = 'A moment of remembrance';
    const heading = document.createElement('h2');
    heading.id = 'site-mourning-dialog-title';
    heading.textContent = siteStatus.memorialName || 'In Memoriam';
    frame.append(kicker, heading);
    if (siteStatus.notice) {
        const notice = document.createElement('p');
        notice.className = 'site-mourning-dialog-notice';
        notice.textContent = siteStatus.notice;
        frame.append(notice);
    }
    const close = document.createElement('button');
    close.className = 'site-mourning-dialog-close';
    close.type = 'button';
    close.textContent = 'Continue';
    close.addEventListener('click', () => dialog.close());
    frame.append(close);
    dialog.append(frame);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
};

fetch(`${window.APP_RUNTIME_CONFIG.apiBase.replace(/\/+$/, '')}/site-status`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((siteStatus) => {
        if (siteStatus) window.applySiteMourningMode(siteStatus);
    })
    .catch(() => {});