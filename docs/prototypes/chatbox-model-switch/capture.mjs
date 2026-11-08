import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Pass an installed Playwright module when it is outside this workspace.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STEER_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.STEER_CHROME_PATH ? { executablePath: process.env.STEER_CHROME_PATH } : {}),
});
const output = fileURLToPath(new URL('./previews/', import.meta.url));
const origin = process.env.STEER_PROTOTYPE_ORIGIN || 'http://127.0.0.1:3107';
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`${origin}/docs/prototypes/chatbox-model-switch/`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${output}01-default.png` });
await page.click('#model-trigger');
assert.equal(await page.locator('#model-picker [data-model=default]').getAttribute('aria-selected'), 'true');
await page.screenshot({ path: `${output}02-model-menu.png` });
await page.screenshot({ path: `${output}02-model-menu-detail.png`, clip: { x: 395, y: 420, width: 780, height: 575 } });
await page.click('[data-model="GPT-5.5"]');
assert.match(await page.locator('#model-trigger').innerText(), /GPT-5.5/);
assert.match(await page.locator('#agent-trigger').innerText(), /前端工程师/);
assert.match(await page.locator('.ws-chat-mode-note').innerText(), /当前会话指定/);
await page.screenshot({ path: `${output}03-model-changed.png` });
await page.locator('.ws-chatbox-wrap').screenshot({ path: `${output}03-model-changed-detail.png` });
await page.click('#model-trigger');
await page.locator('#model-picker input').fill('gemini');
assert.equal(await page.locator('#model-options [role=option]').count(), 1);
await page.keyboard.press('Escape');
assert.equal(await page.locator('#model-trigger').getAttribute('aria-expanded'), 'false');
await page.click('#agent-trigger');
await page.screenshot({ path: `${output}04-agent-menu.png` });
await page.click('[data-agent=reviewer]');
assert.match(await page.locator('#model-trigger').innerText(), /GPT-5.5/);
await page.click('#model-trigger');
await page.click('[data-model=default]');
assert.match(await page.locator('.ws-chat-mode-note').innerText(), /智能体默认/);
await page.click('#agent-trigger');
await page.click('[data-agent=frontend]');
assert.match(await page.locator('#model-trigger').innerText(), /GPT-5.4/);
await page.click('#model-trigger');
await page.click('[data-model="GPT-5.5"]');
await page.click('.ws-chat-send');
assert.equal(await page.locator('.ws-chat-message.agent').count(), 2);
assert.match(await page.locator('.ws-chat-message.agent').last().innerText(), /前端工程师[\s\S]*GPT-5.5/);
assert.equal(await page.evaluate(() => prototypeState.agent.model), 'GPT-5.4');

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
mobile.on('pageerror', (error) => errors.push(error.message));
await mobile.goto(`${origin}/docs/prototypes/chatbox-model-switch/`);
await mobile.evaluate(() => document.fonts.ready);
await mobile.screenshot({ path: `${output}05-mobile-default.png` });
await mobile.click('#model-trigger');
await mobile.screenshot({ path: `${output}06-mobile-menu.png` });
const bounds = await mobile.locator('#model-picker').boundingBox();
assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
await mobile.click('[data-model="Gemini-3.1-Pro-Preview"]');
assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await mobile.screenshot({ path: `${output}07-mobile-changed.png` });
assert.deepEqual(errors, []);
await browser.close();
console.log('Verified model override, default inheritance, role switching, search, Escape, simulated send, and mobile layout. Screenshots saved.');
