import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './global.css';
import './home.css';

const preferenceKey = 'steer.website-language';
const languageLinks =
  document.querySelectorAll<HTMLAnchorElement>('a[data-language]');
for (const link of languageLinks) {
  link.href = `${link.pathname}${window.location.hash}`;
  link.addEventListener('click', () => {
    link.href = `${link.pathname}${window.location.hash}`;
    try {
      localStorage.setItem(preferenceKey, link.dataset.language!);
    } catch {
      /* Navigation also works without storage. */
    }
  });
}
// Explicit /zh/ and /en/ links always win over a browser or saved preference.
// The root contains a complete English page for crawlers and no-JS visitors.
if (location.pathname === '/' || location.pathname === '/index.html') {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(preferenceKey);
  } catch {
    /* Use the browser language. */
  }
  const language =
    saved === 'zh' || saved === 'en'
      ? saved
      : navigator.language.toLowerCase().startsWith('zh')
        ? 'zh'
        : 'en';
  location.replace(`/${language}/${location.search}${location.hash}`);
}
