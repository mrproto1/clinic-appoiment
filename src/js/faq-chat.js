document.addEventListener('DOMContentLoaded', () => {
    const widget = document.getElementById('faq-chat');
    const panel = document.getElementById('faq-chat-panel');
    const toggle = widget?.querySelector('.faq-chat-toggle');
    const closeButton = widget?.querySelector('.faq-chat-close');
    const form = document.getElementById('faq-chat-form');
    const input = document.getElementById('faq-chat-input');
    const messages = document.getElementById('faq-chat-messages');
    if (!widget || !panel || !toggle || !form || !input || !messages) return;

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

        addMessage(trimmedQuestion, 'visitor');
        input.value = '';
        input.disabled = true;
        form.querySelector('button[type="submit"]').disabled = true;
        const pendingMessage = addMessage('Thinking…', 'assistant');

        try {
            const response = await fetch(`${apiBase.replace(/\/+$/, '')}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: trimmedQuestion })
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