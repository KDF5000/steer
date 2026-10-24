// Capture the real workbench with isolated, fictional API fixtures.
// STEER_CAPTURE_URL=http://localhost:3103/fusion PLAYWRIGHT_MODULE=/path/to/playwright node scripts/capture-product-shots.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE, 'index.mjs'))
        .href
    : 'playwright'
);
const output = path.resolve(import.meta.dirname, '../public');
const now = '2026-10-24T02:24:00.000Z';
const later = '2026-10-24T02:24:37.000Z';
const guidePath = 'docs/getting-started.md';
const copy = {
  en: {
    title: 'Write a getting-started guide',
    user: 'Create a short getting-started guide for this project.',
    reply:
      'Created a getting-started guide for the project.\n\n- Connect a machine through Relay and choose an Agent.\n- Add a project using a local directory or Git repository.\n- Start a conversation, then quote a reply to delegate a task.\n\nRead the guide: [docs/getting-started.md](/workspace/steer/docs/getting-started.md)\n\nThe guide includes a setup checklist and next steps.',
    draft:
      'Review the guide for clarity and missing steps. Please do not edit yet.',
    guide:
      '# Getting started with Steer\n\nOne workspace for your machines and coding agents.\n\n## 1. Connect your machine\n\nInstall Relay Node on the machine where your code lives. Add an available Runtime to your workspace.\n\n## 2. Choose your Agent\n\nCreate an Agent with a Runtime, model, and instructions. Codex, Claude Code, and OpenCode can share the same machine.\n\n## 3. Add a project\n\nChoose a local directory or Git repository. The project sets the machine; your Agent chooses how to work.\n\n## 4. Start a conversation\n\nAsk your Agent to build, explain, or review. Quote a reply and @mention another Agent to delegate a task in its own session.\n\n## Setup checklist\n\n- [x] Machine connected\n- [x] Agent configured\n- [x] Project added\n- [ ] Send your first task\n',
  },
  zh: {
    title: '编写项目快速入门指南',
    user: '为这个项目编写一份简洁的快速入门指南。',
    reply:
      '已为项目编写快速入门指南。\n\n- 通过 Relay 连接机器，选择智能体。\n- 使用本地目录或 Git 仓库添加项目。\n- 开始对话，引用回复并委派任务。\n\n查看指南：[docs/getting-started.md](/workspace/steer/docs/getting-started.md)\n\n指南包含配置清单和后续操作说明。',
    draft: '检查指南是否清晰，有没有遗漏的步骤，先不要修改。',
    guide:
      '# Steer 快速入门\n\n在同一个工作台中使用不同机器和编程智能体。\n\n## 1. 连接机器\n\n在代码所在机器安装 Relay Node，将可用的 Runtime 接入工作区。\n\n## 2. 选择智能体\n\n设置 Runtime、模型和指令。同一台机器可以使用 Codex、Claude Code 和 OpenCode。\n\n## 3. 添加项目\n\n选择本地目录或 Git 仓库。项目指定机器，智能体决定执行方式。\n\n## 4. 开始对话\n\n让智能体开发、解释或检查代码。引用回复并 @另一个智能体，即可在独立会话中委派任务。\n\n## 配置清单\n\n- [x] 机器已连接\n- [x] 智能体已配置\n- [x] 项目已添加\n- [ ] 发送第一个任务\n',
  },
};
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const locale of ['en', 'zh'])
      for (const scale of [1, 2]) {
        const text = copy[locale];
        const language = locale === 'zh' ? 'zh-CN' : 'en';
        const agents = [
          ['builder', 'Builder', 'codex'],
          ['reviewer', 'Reviewer', 'claude'],
          ['writer', 'Writer', 'opencode'],
        ].map(([id, name, provider]) => ({
          id,
          name,
          runtimeId: `dev-machine/${provider}`,
          runtimeProvider: provider,
        }));
        const project = {
          id: 'steer',
          name: 'Steer',
          workspaceKind: 'local',
          workspaceSource: '/workspace/steer',
          nodeId: 'dev-machine',
          executionMode: 'in_place',
        };
        const session = {
          id: 'main',
          title: text.title,
          agentId: 'builder',
          projectId: 'steer',
          executionRuntimeId: 'dev-machine/codex',
          createdAt: now,
          updatedAt: later,
        };
        const messages = [
          {
            id: 'request',
            role: 'user',
            content: text.user,
            status: 'complete',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'answer',
            role: 'agent',
            content: text.reply,
            status: 'succeeded',
            relayRunId: 'demo-run',
            createdAt: now,
            updatedAt: later,
            context: {
              agentId: 'builder',
              agentName: 'Builder',
              ownerAgentId: 'builder',
            },
          },
        ];
        const page = await browser.newPage({
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: scale,
          locale: language,
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript((language) => {
          localStorage.setItem('steer.firstLoginGuide:demo-user', 'completed');
          localStorage.setItem('steer.interface-language', language);
          localStorage.setItem('steer.reviewWidth', '480');
        }, language);
        await page.route('**/api/v1/**', async (route) => {
          const url = new URL(route.request().url());
          const p = url.pathname;
          let result = {};
          if (p.endsWith('/auth/me'))
            result = {
              user: {
                id: 'demo-user',
                displayName: 'Alex',
                email: 'alex@example.com',
              },
              workspaces: [{ id: 'demo', name: 'Steer Demo' }],
            };
          else if (p.endsWith('/bootstrap'))
            result = {
              workspace: { id: 'demo', name: 'Steer Demo' },
              agents,
              projects: [project],
              sessions: [
                session,
                {
                  ...session,
                  id: 'setup',
                  title: locale === 'zh' ? '运行环境配置' : 'Runtime setup',
                },
              ],
              artifacts: [],
              skills: [],
              agentSkills: {},
              documents: [],
              settings: { interfaceLanguage: language },
              relay: {
                connected: true,
                nodes: [
                  {
                    id: 'dev-machine',
                    labels: { name: 'dev-machine' },
                    status: 'online',
                    runtimes: agents.map((a) => ({
                      id: a.runtimeId,
                      provider: a.runtimeProvider,
                      health: 'healthy',
                      models: [],
                    })),
                  },
                ],
              },
            };
          else if (p.endsWith('/sessions/main'))
            result = { session, project, messages };
          else if (p.endsWith('/runs/demo-run'))
            result = {
              run: {
                id: 'demo-run',
                status: 'succeeded',
                created_at: now,
                updated_at: later,
              },
              content: text.reply,
              events: [],
              artifacts: [],
            };
          else if (p.endsWith('/workspace'))
            result = {
              root: '/workspace/steer',
              path: url.searchParams.get('path') || '',
              content:
                url.searchParams.get('operation') === 'read' ? text.guide : '',
              entries: [
                { name: 'docs', directory: true, size: 0 },
                { name: 'README.md', directory: false, size: 100 },
              ],
              git: { repository: true, branch: 'main' },
            };
          else if (
            p.endsWith('/artifacts') ||
            p.endsWith('/events') ||
            p.endsWith('/relay-nodes')
          )
            result = [];
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(result),
          });
        });
        await page.goto(
          process.env.STEER_CAPTURE_URL || 'http://localhost:3103/fusion',
        );
        await page
          .getByRole('button', {
            name: 'Expand conversations for Steer',
            exact: true,
          })
          .click();
        await page.getByText(text.title, { exact: true }).first().click();
        await page
          .getByRole('button', {
            name: locale === 'zh' ? '引用回复' : 'Quote reply',
            exact: true,
          })
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({
          content: 'nextjs-portal { display: none !important; }',
        });
        await page.getByRole('link', { name: guidePath, exact: true }).click();
        await page.locator('.ws-workspace-preview').waitFor();
        const hide = page.getByRole('button', {
          name: locale === 'zh' ? '收起文件浏览' : 'Hide file browser',
          exact: true,
        });
        if (await hide.isVisible()) await hide.click();
        await page.waitForTimeout(300);
        const prefix = `steer-workspace${locale === 'zh' ? '-zh' : ''}`;
        await page.screenshot({
          path: path.join(output, `${prefix}${scale === 1 ? '-1x' : ''}.png`),
        });
        if (scale === 2) {
          // Close the file preview using its accessible name from the current UI.
          const close = page.getByRole('button', {
            name: 'Close review panel',
            exact: true,
          });
          if (await close.count()) await close.click();
          else {
            console.log(
              'buttons',
              await page.getByRole('button').allTextContents(),
            );
            throw new Error('preview close button missing');
          }
          await page
            .getByRole('button', {
              name: locale === 'zh' ? '引用回复' : 'Quote reply',
              exact: true,
            })
            .click();
          const input = page.getByRole('textbox', {
            name: 'Message Agent',
            exact: true,
          });
          await input.fill('@');
          await page
            .getByRole('option')
            .filter({ hasText: 'Reviewer' })
            .click();
          await input.fill(text.draft);
          await input.blur();
          await page.waitForTimeout(300);
          assert.equal(
            await page.locator('.ws-mention-token').innerText(),
            '@Reviewer',
          );
          const box = await page.locator('.ws-chat-page').boundingBox();
          console.log(locale, 'handoff', box);
          await page.locator('.ws-chat-page').screenshot({
            path: path.join(output, `steer-handoff-${locale}.png`),
          });
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
