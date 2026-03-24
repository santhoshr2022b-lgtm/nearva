// Nearva Map Initialization and Language Persistence
// Extracted from map.html for better performance and caching

let currentLang = localStorage.getItem('nearva_lang') || 'en';

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    updatePageLanguage();
    updateLangButtons();
});

function toggleLanguage() {
    currentLang = currentLang === 'en' ? 'ta' : 'en';
    localStorage.setItem('nearva_lang', currentLang);
    updatePageLanguage();
    updateLangButtons();

    // Trigger map re-load if necessary (e.g. to refresh popups with new lang)
    if (typeof loadWorkers === 'function') loadWorkers();
}

function updateLangButtons() {
    const display = currentLang === 'en' ? 'EN | தமிழ்' : 'தமிழ் | EN';
    const btn = document.getElementById('lang-display');
    if (btn) btn.textContent = display;
}

function updatePageLanguage() {
    const elements = document.querySelectorAll('[data-en]');
    const placeholders = document.querySelectorAll('[data-en-placeholder]');

    // Set HTML lang attribute
    document.documentElement.setAttribute('lang', currentLang);

    // Toggle Tamil mode class
    if (currentLang === 'ta') {
        document.body.classList.add('tamil-mode');
    } else {
        document.body.classList.remove('tamil-mode');
    }

    elements.forEach(el => {
        if (currentLang === 'ta' && el.dataset.ta) {
            el.innerHTML = el.dataset.ta;
        } else if (el.dataset.en) {
            el.innerHTML = el.dataset.en;
        }
    });

    placeholders.forEach(el => {
        if (currentLang === 'ta' && el.dataset.taPlaceholder) {
            el.placeholder = el.dataset.taPlaceholder;
        } else if (el.dataset.enPlaceholder) {
            el.placeholder = el.dataset.enPlaceholder;
        }
    });
}
