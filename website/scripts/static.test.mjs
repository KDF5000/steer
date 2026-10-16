import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const dist = resolve(import.meta.dirname, '../dist');
const read = (path) => readFile(resolve(dist, path), 'utf8');

test('both languages are complete HTML documents before JavaScript runs', async () => {
  const zh = await read('zh/index.html');
  const en = await read('en/index.html');
  assert.match(zh, /<html lang="zh-CN">/);
  assert.match(en, /<html lang="en">/);
  assert.match(
    zh,
    /<title>Steer — 不同机器，不同 Agent。同一个工作台。<\/title>/,
  );
  assert.match(
    en,
    /<title>Steer — Different machines. Different agents. One workspace.<\/title>/,
  );
  assert.match(zh, /换个 Agent，接着做。/);
  assert.match(en, /Switch agents. Keep going./);
  assert.match(zh, /<meta name="description" content="Steer 将不同机器/);
  assert.match(
    en,
    /<meta name="description" content="Steer brings agents and runtimes/,
  );
  for (const html of [zh, en]) {
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(!html.includes('<!--page-body-->'));
    assert.ok(!html.includes('<!--page-head-->'));
    assert.match(html, /href="\/zh\/"[^>]*data-language="zh"/);
    assert.match(html, /href="\/en\/"[^>]*data-language="en"/);
    assert.ok(
      !html.includes('href="/fusion"'),
      'workspace links must point outside the website',
    );
    assert.equal((html.match(/data-workspace-link="true"/g) || []).length, 4);
    if (process.env.TEST_WORKSPACE_URL) {
      const workspaceLinks = [
        ...html.matchAll(/href="([^"]+)" data-workspace-link="true"/g),
      ];
      assert.equal(workspaceLinks.length, 4);
      for (const [, href] of workspaceLinks)
        assert.equal(href, process.env.TEST_WORKSPACE_URL);
    }
    assert.ok(!/(_next\/|\/api\/|localhost:8080)/.test(html));
    for (const [, path] of html.matchAll(
      /(?:src|href)="(\/(?:assets\/[^" ]+|favicon\.svg|steer-handoff-(?:en|zh)\.png|steer-workspace(?:-zh)?(?:-1x)?\.png))"/g,
    )) {
      assert.ok((await readFile(resolve(dist, path.slice(1)))).length > 0);
    }
  }
});

test('the root is readable without JavaScript and language links are real URLs', async () => {
  const root = await read('index.html');
  assert.match(root, /Switch agents. Keep going./);
  assert.match(root, /href="\/zh\/"/);
  assert.match(root, /href="\/en\/"/);
});

test('build emits a static site and a small client script, without a React runtime', async () => {
  const assets = await readdir(resolve(dist, 'assets'));
  const css = (
    await Promise.all(
      assets
        .filter((name) => name.endsWith('.css'))
        .map((name) => read(`assets/${name}`)),
    )
  ).join('');
  assert.match(css, /\.website_page/);
  assert.match(css, /\.website_shell/);
  const js = assets.filter((name) => name.endsWith('.js'));
  assert.equal(js.length, 1);
  const script = await read(`assets/${js[0]}`);
  assert.ok(
    script.length < 10_000,
    `unexpected client bundle size: ${script.length}`,
  );
  assert.ok(!/react-dom|hydrateRoot|createRoot|cloudflare|vinext/.test(script));
  assert.match(script, /steer.website-language/);
  assert.ok(!assets.some((name) => name.endsWith('.map')));
});

test('configured canonical URLs, alternates, and sitemap agree', async () => {
  const zh = await read('zh/index.html');
  const canonical = zh.match(/rel="canonical" href="([^"]+)"/);
  if (!canonical) {
    assert.ok(
      !(await read('robots.txt')).includes('Sitemap:'),
      'local builds must not advertise a fake domain',
    );
    return;
  }
  const origin = new URL(canonical[1]).origin;
  for (const locale of ['zh', 'en']) {
    const html = await read(`${locale}/index.html`);
    assert.ok(html.includes(`rel="canonical" href="${origin}/${locale}/"`));
    for (const [lang, path] of [
      ['zh-CN', '/zh/'],
      ['en', '/en/'],
      ['x-default', '/'],
    ]) {
      assert.ok(html.includes(`hreflang="${lang}" href="${origin}${path}"`));
    }
  }
  assert.ok(
    (await read('robots.txt')).includes(`Sitemap: ${origin}/sitemap.xml`),
  );
  const sitemap = await read('sitemap.xml');
  for (const path of ['/', '/zh/', '/en/'])
    assert.ok(sitemap.includes(`<loc>${origin}${path}</loc>`));
});

test('localized screenshots provide real 1x and 2x image sizes', async () => {
  for (const locale of ['en', 'zh']) {
    const prefix = `steer-workspace${locale === 'zh' ? '-zh' : ''}`;
    const html = await read(`${locale}/index.html`);
    assert.ok(
      html
        .toLowerCase()
        .includes(`srcset="/${prefix}-1x.png 1280w, /${prefix}.png 2560w"`),
    );
    for (const scale of [1, 2]) {
      const png = await readFile(
        resolve(dist, `${prefix}${scale === 1 ? '-1x' : ''}.png`),
      );
      assert.equal(png.readUInt32BE(16), 1280 * scale);
      assert.equal(png.readUInt32BE(20), 800 * scale);
    }
  }
});
