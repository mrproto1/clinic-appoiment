// This file contains the main JavaScript logic for the website, handling user interactions and initializing the application.

document.addEventListener('DOMContentLoaded', () => {
    initManagementModal();
    initOrganDonorTribute();

    console.log('Clinic Appointment System is ready.');

    initScrollReveal();
});

function getLocalApiBase() {
    const pathName = window.location.pathname || '/';
    const srcIndex = pathName.indexOf('/src/');
    const projectBase = srcIndex >= 0 ? pathName.substring(0, srcIndex) : '';
    return `${window.location.origin}${projectBase}/api`;
}

async function initOrganDonorTribute() {
    const form = document.getElementById('organ-donor-form');
    const list = document.getElementById('organ-donor-list');
    const count = document.getElementById('organ-donor-count');
    if (!form || !list || !count) return;
    const certificate = document.getElementById('donor-certificate');
    const certificatePreview = document.getElementById('certificate-preview');
    const printCertificateButton = document.getElementById('print-donor-certificate');
    let latestDonor = null;

    const renderDonors = (donors) => {
        count.textContent = `${donors.length} donor${donors.length === 1 ? '' : 's'}`;
        if (!donors.length) {
            list.innerHTML = '<p class="muted-text">No tributes yet. Be the first to leave a legacy.</p>';
            return;
        }

        list.innerHTML = donors.map((donor) => `
            <article class="organ-donor-card">
                <div class="donor-aura" aria-hidden="true"></div>
                <div class="donor-mark" aria-hidden="true">+</div>
                <div>
                    <h4 class="donor-name">${escapeTributeText(donor.name)}</h4>
                    <p class="donor-type">${escapeTributeText(donor.organType || 'Any organ')}</p>
                    ${donor.tribute ? `<p class="donor-quote">“${escapeTributeText(donor.tribute)}”</p>` : ''}
                </div>
            </article>
        `).join('');
    };

    const loadDonors = async () => {
        try {
            const response = await fetch(`${getLocalApiBase()}/organ-donors`);
            if (!response.ok) throw new Error('Unable to load donor tributes');
            renderDonors(await response.json());
        } catch (error) {
            list.innerHTML = '<p class="muted-text">Donor tributes are unavailable. Please ensure Apache and MySQL are running.</p>';
        }
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const status = document.getElementById('organ-donor-status');
        const submitButton = form.querySelector('button[type="submit"]');
        const payload = {
            name: document.getElementById('donor-name').value.trim(),
            organType: document.getElementById('donor-organ').value,
            tribute: document.getElementById('donor-tribute').value.trim()
        };

        submitButton.disabled = true;
        status.textContent = 'Saving your tribute...';
        try {
            const response = await fetch(`${getLocalApiBase()}/organ-donors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Unable to save tribute');

            latestDonor = result.donor;
            form.reset();
            status.textContent = 'Your tribute has been added. Thank you.';
            if (certificate && certificatePreview) {
                const certificateNumber = `OD-${String(latestDonor.id).padStart(5, '0')}`;
                certificatePreview.innerHTML = `${escapeTributeText(latestDonor.name)}<br><span>${escapeTributeText(latestDonor.organType || 'Any organ')} · Certificate ${certificateNumber}</span>`;
                certificate.hidden = false;
            }
            await loadDonors();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });

    await loadDonors();

    if (printCertificateButton) {
        printCertificateButton.addEventListener('click', () => {
            if (latestDonor) printDonorCertificate(latestDonor);
        });
    }
}

function printDonorCertificate(donor) {
    const certificateNumber = `OD-${String(donor.id).padStart(5, '0')}`;
    const signatureBase = getLocalApiBase().replace(/\/api$/, '/src/images');
    const muhammadSignature = `${signatureBase}/signature-muhammad-irfan.png`;
    const aizulSignature = `${signatureBase}/signature-aizul-eirfan.png`;
    const issuedDate = new Date(donor.createdAt || Date.now()).toLocaleDateString([], {
        day: 'numeric', month: 'long', year: 'numeric'
    });
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
        <!doctype html>
        <html><head><title>Organ Donor Certificate ${certificateNumber}</title>
        <style>
            @page { size: A4 landscape; margin: 0; }
            * { box-sizing: border-box; }
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e8eee9; font-family: Arial, sans-serif; color: #15353a; }
            .certificate { width: 92vw; max-width: 1050px; padding: 70px; position: relative; overflow: hidden; background: #fffdf8; border: 12px solid #15353a; outline: 2px solid #c56f43; outline-offset: -24px; text-align: center; }
            .eyebrow { color: #c56f43; letter-spacing: .2em; font-size: 12px; font-weight: bold; text-transform: uppercase; }
            h1 { margin: 18px 0 8px; font-family: Georgia, serif; font-size: 48px; font-weight: normal; }
            h2 { margin: 12px 0 20px; color: #c56f43; font-family: Georgia, serif; font-size: 38px; font-style: italic; font-weight: normal; }
            .line { width: 180px; height: 2px; margin: 0 auto 24px; background: #c56f43; }
            .message { margin: 0 auto 35px; max-width: 650px; color: #607573; font-size: 16px; line-height: 1.6; }
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 70px; margin-top: 34px; }
            .signature-block { text-align: center; }
            .signature-image { display: block; width: 230px; height: 72px; object-fit: contain; margin: 0 auto -4px; }
            .signature-line { border-top: 1px solid #15353a; margin: 0 auto 9px; width: 250px; }
            .signature-name { margin: 0; font-weight: bold; font-size: 14px; }
            .signature-role { margin: 4px 0 0; color: #c56f43; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
            .meta { display: flex; justify-content: space-between; color: #607573; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
            .mark { position: absolute; top: 25px; right: 40px; color: #c56f43; font-size: 42px; }
            @media print { body { background: #fff; } .certificate { width: 100vw; max-width: none; } }
        </style></head><body>
            <article class="certificate">
                <div class="mark">+</div>
                <div class="eyebrow">The Protocol Hospital · Life Legacy</div>
                <h1>Organ Donor Tribute Certificate</h1>
                <div class="line"></div>
                <h2>${escapeTributeText(donor.name)}</h2>
                <p class="message">With gratitude, we honour this intention to give hope and help create another tomorrow. Donation intention: <strong>${escapeTributeText(donor.organType || 'Any organ')}</strong>.</p>
                <div class="signatures">
                    <div class="signature-block">
                        <img class="signature-image" src="${muhammadSignature}" alt="Signature of Dr. Muhammad Irfan">
                        <div class="signature-line"></div>
                        <p class="signature-name">Dr. Muhammad Irfan</p>
                        <p class="signature-role">Head of The Protocol</p>
                    </div>
                    <div class="signature-block">
                        <img class="signature-image" src="${aizulSignature}" alt="Signature of Dr. Aizul Eirfan">
                        <div class="signature-line"></div>
                        <p class="signature-name">Dr. Aizul Eirfan</p>
                        <p class="signature-role">Surgery Performer</p>
                    </div>
                </div>
                <div class="meta"><span>Certificate ${certificateNumber}</span><span>Issued ${issuedDate}</span></div>
            </article>
            <script>window.onload = () => window.print();<\/script>
        </body></html>
    `);
    printWindow.document.close();
}

function escapeTributeText(value) {
    return String(value || '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character]));
}

function initManagementModal() {
    const modal = document.getElementById('management-modal');
    if (!modal) return;

    const openButtons = document.querySelectorAll('[data-open-management]');
    const closeButtons = document.querySelectorAll('[data-close-management]');

    const openModal = () => {
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'auto';
    };

    const closeModal = () => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    };

    openButtons.forEach((button) => button.addEventListener('click', openModal));
    closeButtons.forEach((button) => button.addEventListener('click', closeModal));

    // Delegated fallback keeps modal controls working even if nodes are re-rendered.
    document.addEventListener('click', (event) => {
        const openTrigger = event.target.closest('[data-open-management]');
        if (openTrigger) {
            openModal();
            return;
        }

        const closeTrigger = event.target.closest('[data-close-management]');
        if (closeTrigger) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('open')) {
            closeModal();
        }
    });
}

function initScrollReveal() {
    const revealItems = document.querySelectorAll('.reveal-on-scroll');
    if (!revealItems.length) {
        return;
    }

    if (!('IntersectionObserver' in window)) {
        revealItems.forEach((item) => item.classList.add('is-visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.2,
        rootMargin: '0px 0px -40px 0px'
    });

    revealItems.forEach((item) => observer.observe(item));
}