# Steer × Relay 官网

独立的 Vite + React 静态工程，复用 Steer 官网设计与真实产品截图。React 只在开发或构建时渲染 HTML；发布产物不包含 React 运行时，不需要 Next.js、数据库或业务后端。

## 本地开发

只需 Node.js 22.13+，无需安装仓库根目录的依赖：

```bash
cd website
npm ci
cp .env.example .env.local
npm run dev
```

- 中文：<http://localhost:3100/zh/>
- 英文：<http://localhost:3100/en/>
- `/` 根据上次选择或浏览器首选语言跳转。未启用 JavaScript 时显示完整英文页面，仍可通过链接进入中文。

明确访问 `/zh/` 或 `/en/` 时，URL 决定语言，不会被浏览器偏好覆盖。切换语言使用普通链接，可以复制、分享，也能在没有 JavaScript 的情况下工作。

## 构建与验证

```bash
npm run lint
npm run build
npm test
npm run preview
```

预览地址：<http://localhost:4173>。构建产物位于 `dist/`：

```text
index.html
zh/index.html
en/index.html
assets/                # CSS、本地字体和语言跳转脚本
favicon.svg
steer-workspace*.png   # 中英文截图，包含 1x 与 2x 分辨率
robots.txt
sitemap.xml            # 配置官网地址后生成
```

中英文正文、标题、描述、Open Graph 标签均在构建时写入 HTML，无需执行 JavaScript 才能获取内容。字体随网站发布，不请求 Google Fonts。`dist/` 可以直接交给任何支持目录索引的静态服务器；无需 SPA 回退或 Serverless Functions。

## 配置

| 构建变量             | 说明                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_STEER_APP_URL` | “打开 Steer”等全部工作台入口的完整地址，默认 `https://steer-console.pcursor.run`。可以包含路径。                                  |
| `VITE_SITE_URL`      | 官网正式 origin，例如 `https://steer.example.com`，用于 canonical、hreflang、分享图片及 sitemap。不能包含子路径、查询参数或片段。 |

两项均为公开地址，不要填写凭据。更改后需要重新构建。

未指定 `VITE_SITE_URL` 时，Vercel 环境使用 `VERCEL_PROJECT_PRODUCTION_URL`，其次使用 `VERCEL_URL`。本地没有官网域名时不生成 canonical、hreflang、sitemap 或绝对分享地址，避免发布虚假的域名。自定义域名上线时请显式设置 `VITE_SITE_URL`。

## Vercel 独立发布

1. 在 Vercel 导入此 Git 仓库，创建一个单独的官网 Project。
2. **Root Directory** 设置为 `website`。
3. **Framework Preset** 选择 `Vite`。
4. 在项目环境变量中设置 `VITE_STEER_APP_URL` 和正式域名 `VITE_SITE_URL`。
5. 发布并绑定域名。

`vercel.json` 已指定 `npm ci`、`npm run build`、输出目录 `dist` 和尾斜杠规则。不要把仓库根目录或业务系统的构建产物作为官网输出，也不要添加把所有路径改写到 `/index.html` 的 SPA 规则。

Vercel 仅托管静态官网。Steer Web、Go 后端、PostgreSQL、Relay、飞书长连接仍在原有环境运行，官网通过普通链接跳转到工作台。

## 修改内容

- `src/Home.tsx`：产品页面结构与英文文案键。
- `src/i18n.ts`：对应的中文文案。
- `src/home.css`：响应式布局与组件样式。
- `src/global.css`：独立基础样式与字体设置。
- `public/`：官网独立拥有的静态素材。
- `vite.config.ts`：构建时渲染、公开地址校验及 SEO 输出。

`en/index.html`、`zh/index.html` 和 `index.html` 是薄模板。页面结构只有一份，构建时分别注入对应语言，避免维护两套布局。

## 产品截图

首页使用真实 Steer `/fusion` 界面，展示示例项目、对话和文档预览。截图通过独立浏览器中的演示 API 数据生成，不包含真实账户信息，也不需要官网连接业务后端。中文和英文页面分别使用对应语言的截图；工作台少数尚未翻译的控件保留原始显示。

每种语言提供 1280 × 800 与 2560 × 1600 两种 PNG，通过 `srcset` 按显示尺寸和屏幕像素密度选择，点击截图可查看 2x 原图。更新截图时应直接以 1280 × 800 视口、1x / 2x 像素密度重新截取，不要放大旧图。

产品亮点区的 `steer-handoff-en.png` / `steer-handoff-zh.png` 是真实工作台聊天区域的 2x 截图：用户引用 Builder 的回复，并通过 @mention 选择同机的 Reviewer，准备在独立会话中委派任务。项目指定机器，Agent 可以使用该机器上已接入工作区的不同 Runtime。截图使用演示任务，不代表已完成真实代码审查。

新增的协作与共享区域使用 `steer-session-en.png` / `steer-session-zh.png` 和 `steer-agents-en.png` / `steer-agents-zh.png`，均为当前工作台的 2560 × 1600 截图。前者展示同一会话的参与者身份与协作者头像，后者展示「共享给我」中的已授权 Agent 与项目。所有姓名、消息与授权均使用虚构数据。

会话协作只授予指定会话的查看或执行权限，任务沿用已有 Agent 和项目并串行执行。Agent 共享授予指定项目上的执行能力，接收者开启自己的私人会话。邀请在应用内接受，工作区保持个人所有；官网不宣传尚未实现的评论、讨论或邮件通知功能。

当前支持的内置 Runtime：Codex、Trae、Claude Code、OpenCode、Pi、Qoder、QwenWork（千问办公）。列表按当前 Steer / Relay 的内置适配器核实。

可复用 `scripts/capture-product-shots.mjs` 重新生成十张截图。先启动仓库根目录的 Next 开发服务，再指定地址及本机 Playwright 模块路径：

```bash
STEER_CAPTURE_URL=http://localhost:3103/fusion \
PLAYWRIGHT_MODULE=/path/to/playwright \
node scripts/capture-product-shots.mjs
```

脚本只在独立浏览器中拦截 API，使用虚构的 Steer Demo 工作区，不写入业务数据。需要本机 Chrome。更新前后素材归档于 `docs/prototypes/website-product-shots/2026-10-24/`；保留旧版本，不覆盖归档。
