import { renderToStaticMarkup } from 'react-dom/server';
import Home, { type Locale } from './Home';
import { homeZhCN } from './i18n';

export function render(locale: Locale, appUrl: string) {
  const titleKey = 'Steer — Pick up where you left off';
  const descriptionKey =
    'Steer is an open-source workspace for Codex, Trae, Claude Code, and Pi. Connect local or Git projects, run tasks on your own machines through Relay, and work from the web, Feishu, or the Task API.';
  return {
    title: locale === 'zh' ? homeZhCN[titleKey] : titleKey,
    description: locale === 'zh' ? homeZhCN[descriptionKey] : descriptionKey,
    body: renderToStaticMarkup(<Home locale={locale} appUrl={appUrl} />),
  };
}
