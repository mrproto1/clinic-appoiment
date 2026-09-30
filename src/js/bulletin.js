document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('bulletin-feed');
    if (!container) return;

    const apiBase = window.APP_RUNTIME_CONFIG?.apiBase
        || window.__APP_API_BASE__
        || `${window.location.origin}/api`;

    try {
        const response = await fetch(`${apiBase.replace(/\/+$/, '')}/bulletins`);
        if (!response.ok) throw new Error(`Unable to load bulletins (HTTP ${response.status}).`);
        const bulletins = await response.json();
        if (!Array.isArray(bulletins)) {
            throw new Error('Bulletin service is not deployed yet. Please try again later.');
        }
        container.replaceChildren();

        if (bulletins.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'bulletin-empty';
            emptyState.textContent = 'There are no published bulletins yet.';
            container.append(emptyState);
            return;
        }

        bulletins.forEach((bulletin) => {
            const article = document.createElement('article');
            article.className = 'bulletin-item';

            const meta = document.createElement('div');
            meta.className = 'bulletin-item-meta';
            const category = document.createElement('span');
            category.className = 'bulletin-category';
            category.textContent = bulletin.category || 'General';
            const date = document.createElement('time');
            date.dateTime = bulletin.publishedAt || bulletin.createdAt || '';
            date.textContent = date.dateTime
                ? new Date(date.dateTime).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
                : '';
            meta.append(category, date);

            const title = document.createElement('h3');
            title.textContent = bulletin.title || '';
            const content = document.createElement('p');
            content.className = 'bulletin-item-content';
            content.textContent = bulletin.content || '';

            article.append(meta, title, content);
            container.append(article);
        });
    } catch (error) {
        const errorState = document.createElement('p');
        errorState.className = 'bulletin-empty is-error';
        errorState.textContent = error instanceof Error ? error.message : 'Unable to load bulletins right now.';
        container.replaceChildren(errorState);
    }
});