import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer, defineConfig, loadEnv, type ViteDevServer } from 'vite';
import type { render } from './src/render.tsx';

const root = fileURLToPath(new URL('.', import.meta.url));
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

function httpUrl(value: string, name: string, originOnly = false) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `${name} must be a public HTTP(S) URL without credentials.`,
    );
  }
  if (originOnly && (url.pathname !== '/' || url.search || url.hash)) {
    throw new Error(
      `${name} must be an origin, for example https://steer.example.com.`,
    );
  }
  return originOnly ? url.origin : url.href;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_');
  const appUrl = httpUrl(
    env.VITE_STEER_APP_URL || 'https://steer.byted.org/fusion',
    'VITE_STEER_APP_URL',
  );
  const vercelDomain =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const siteValue =
    env.VITE_SITE_URL || (vercelDomain ? `https://${vercelDomain}` : '');
  const siteUrl = siteValue ? httpUrl(siteValue, 'VITE_SITE_URL', true) : '';
  let renderer: Promise<ViteDevServer> | undefined;
  function getRenderer() {
    renderer ??= createServer({
      root,
      configFile: false,
      envFile: false,
      plugins: [react()],
      appType: 'custom',
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    return renderer;
  }
  async function closeRenderer() {
    if (renderer) await (await renderer).close();
  }

  return {
    root,
    appType: 'mpa',
    plugins: [
      react(),
      {
        name: 'steer-static-pages',
        configureServer(server) {
          server.httpServer?.once('close', () => {
            void closeRenderer();
          });
        },
        transformIndexHtml: {
          order: 'pre',
          async handler(html, context) {
            const locale = context.path.startsWith('/zh/') ? 'zh' : 'en';
            const isRoot =
              context.path === '/' || context.path === '/index.html';
            const path = isRoot ? '/' : `/${locale}/`;
            const module = (await (
              await getRenderer()
            ).ssrLoadModule('/src/render.tsx')) as { render: typeof render };
            const { title, description, body } = module.render(locale, appUrl);
            const alternates = siteUrl
              ? `
            <link rel="canonical" href="${escape(siteUrl + path)}" />
            <link rel="alternate" hreflang="zh-CN" href="${escape(siteUrl)}/zh/" />
            <link rel="alternate" hreflang="en" href="${escape(siteUrl)}/en/" />
            <link rel="alternate" hreflang="x-default" href="${escape(siteUrl)}/" />
            <meta property="og:url" content="${escape(siteUrl + path)}" />
            <meta property="og:image" content="${escape(siteUrl)}/steer-workspace${locale === 'zh' ? '-zh' : ''}.png" />`
              : '';
            return html
              .replace(
                '<!--page-head-->',
                `
            <title>${escape(title)}</title>
            <meta name="description" content="${escape(description)}" />
            <meta property="og:type" content="website" />
            <meta property="og:site_name" content="Steer &amp; Relay" />
            <meta property="og:title" content="${escape(title)}" />
            <meta property="og:description" content="${escape(description)}" />
            <meta property="og:locale" content="${locale === 'zh' ? 'zh_CN' : 'en_US'}" />
            <meta property="og:locale:alternate" content="${locale === 'zh' ? 'en_US' : 'zh_CN'}" />
            <meta name="twitter:card" content="summary_large_image" />
            ${alternates}
          `,
              )
              .replace('<!--page-body-->', body);
          },
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'robots.txt',
            source: `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''}`,
          });
          if (siteUrl) {
            const urls = ['/', '/zh/', '/en/']
              .map((path) => `<url><loc>${escape(siteUrl + path)}</loc></url>`)
              .join('');
            this.emitFile({
              type: 'asset',
              fileName: 'sitemap.xml',
              source: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
            });
          }
        },
        closeBundle: closeRenderer,
      },
    ],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(root, 'index.html'),
          zh: resolve(root, 'zh/index.html'),
          en: resolve(root, 'en/index.html'),
        },
      },
    },
  };
});
