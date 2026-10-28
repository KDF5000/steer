import { renderToStaticMarkup } from 'react-dom/server';
import Home, { type Locale } from './Home';
import { homeZhCN } from './i18n';

export function render(locale: Locale, appUrl: string) {
  const titleKey =
    'Steer — Different machines. Different agents. One workspace.';
  const descriptionKey =
    'Steer brings agents and runtimes across your machines into one open-source workspace. Use Codex, Trae, Claude Code, OpenCode, Pi, Qoder, and QwenWork to run tasks, collaborate in sessions, and share agents.';
  return {
    title: locale === 'zh' ? homeZhCN[titleKey] : titleKey,
    description: locale === 'zh' ? homeZhCN[descriptionKey] : descriptionKey,
    body: renderToStaticMarkup(<Home locale={locale} appUrl={appUrl} />),
  };
}
