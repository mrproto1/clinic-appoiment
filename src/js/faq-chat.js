document.addEventListener('DOMContentLoaded', () => {
    const widget = document.getElementById('faq-chat');
    const panel = document.getElementById('faq-chat-panel');
    const toggle = widget?.querySelector('.faq-chat-toggle');
    const closeButton = widget?.querySelector('.faq-chat-close');
    const form = document.getElementById('faq-chat-form');
    const input = document.getElementById('faq-chat-input');
    const messages = document.getElementById('faq-chat-messages');
    if (!widget || !panel || !toggle || !form || !input || !messages) return;

    const familyMode = widget.dataset.familyOnly === 'true';
    const familyConsent = document.getElementById('faq-chat-family-consent');
    const shareVitals = document.getElementById('faq-chat-share-vitals');
    const consentError = document.getElementById('faq-chat-consent-error');
    if (familyMode) {
        let currentUser = {};
        try {
            currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        } catch (_) {
            currentUser = {};
        }
        if (currentUser.role !== 'family') return;
        widget.hidden = false;
    }

    const apiBase = window.APP_RUNTIME_CONFIG?.apiBase
        || window.__APP_API_BASE__
        || `${window.location.origin}/api`;

    const setOpen = (open) => {
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) input.focus();
    };

    const addMessage = (text, kind) => {
        const message = document.createElement('p');
        message.className = `faq-chat-message is-${kind}`;
        message.textContent = text;
        messages.append(message);
        messages.scrollTop = messages.scrollHeight;
        return message;
    };

    const sendQuestion = async (question) => {
        const trimmedQuestion = question.trim();
        if (!trimmedQuestion) return;

        if (familyMode && !familyConsent?.checked) {
            if (consentError) consentError.hidden = false;
            return;
        }
        if (consentError) consentError.hidden = true;

        addMessage(trimmedQuestion, 'visitor');
        input.value = '';
        input.disabled = true;
        form.querySelector('button[type="submit"]').disabled = true;
        const pendingMessage = addMessage('Thinking…', 'assistant');

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (familyMode) {
                const authToken = localStorage.getItem('authToken');
                if (!authToken) throw new Error('Please sign in to your family account again.');
                headers.Authorization = `Bearer ${authToken}`;
            }

            const response = await fetch(`${apiBase.replace(/\/+$/, '')}/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    message: trimmedQuestion,
                    familyMode,
                    familyConsent: familyMode ? Boolean(familyConsent?.checked) : false,
                    includePatientVitals: familyMode && Boolean(shareVitals?.checked)
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Assistant is unavailable right now.');
            pendingMessage.textContent = result.answer || 'I could not prepare an answer. Please try again.';
        } catch (error) {
            pendingMessage.textContent = error instanceof Error
                ? error.message
                : 'Assistant is unavailable right now. Please try again.';
        } finally {
            input.disabled = false;
            form.querySelector('button[type="submit"]').disabled = false;
            input.focus();
            messages.scrollTop = messages.scrollHeight;
        }
    };

    toggle.addEventListener('click', () => setOpen(panel.hidden));
    closeButton?.addEventListener('click', () => setOpen(false));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        sendQuestion(input.value);
    });
    widget.querySelectorAll('[data-chat-suggestion]').forEach((button) => {
        button.addEventListener('click', () => sendQuestion(button.dataset.chatSuggestion || ''));
    });
});