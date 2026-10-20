import { renderToStaticMarkup } from 'react-dom/server';
import Home, { type Locale } from './Home';
import { homeZhCN } from './i18n';

export function render(locale: Locale, appUrl: string) {
  const titleKey =
    'Steer — Different machines. Different agents. One workspace.';
  const descriptionKey =
    'Steer brings agents and runtimes across your machines into one open-source workspace. Connect Codex, Trae, Claude Code, Pi, Qoder, and QwenWork, run tasks locally or remotely, and organize work through projects and conversations.';
  return {
    title: locale === 'zh' ? homeZhCN[titleKey] : titleKey,
    description: locale === 'zh' ? homeZhCN[descriptionKey] : descriptionKey,
    body: renderToStaticMarkup(<Home locale={locale} appUrl={appUrl} />),
  };
}
