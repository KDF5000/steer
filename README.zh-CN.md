# Steer

Steer 是一个 Chat-first 的 Agent 工作台，让用户通过同一个对话入口在本地或远程机器的项目目录中工作，由 [Relay](https://github.com/KDF5000/relay) 负责多机器 Runtime 执行。

## 架构

Steer 是独立产品，包含两个可独立部署的服务：

```text
Steer Web → Steer Server → PostgreSQL
                         → Relay Server → Relay Nodes → Agent Runtimes
```

- `app/`：Next.js/React Web 前端；
- `server/`：独立 Go 业务后端；
- PostgreSQL：保存按 Workspace 隔离的 Project、Agent、对话、Run 投影和成果索引；
- Relay：独立部署的执行基础设施。Steer Server 通过 Relay Go SDK 接入，浏览器不会接触 Relay Host Token 或 Node 签名根密钥。

详细说明见[架构设计](docs/architecture.md)、[部署拓扑](docs/deployment.md)、[Conversation Task API](docs/task-api.md)、[飞书集成](docs/feishu-integration.md)和[Chat-first 产品设计](docs/chat-first-product.md)。

## 产品官网

独立静态官网位于 [`website/`](website/README.md)，构建中英文 HTML 页面，可单独发布到 Vercel，不依赖 Steer 后端或数据库。执行 `cd website && npm ci && npm run dev` 即可预览。

## 当前可验证链路

1. 一次性注册 Relay Node，并通过独立的逻辑 Runtime Binding 将同一个物理 Runtime 共享给一个或多个 Workspace；
2. 创建 Agent，可自动调度或固定 Runtime 实例；
3. 添加 Project：已有目录必须选择所在 Runtime，Git Repository 则由 Relay 通过 mirror 和隔离 worktree 准备；
4. 选择 Agent 开始 Conversation；Project、Runtime 和已准备的工作区保持稳定，可在每次 Run 之间切换兼容当前 Runtime 的 Agent；
5. 查看流式 Run 输出，并可从输入框停止进行中的执行；
6. 在当前会话右侧查看 Run 有意产生的持久文件；
7. 预览、下载 Artifact，并在刷新后恢复最近会话。

每次 Run 都有对话回复，但 Artifact 是可选的。Steer 只把 Relay 明确暴露的可复用文件或代码结果视为 Artifact；Runtime final-message、日志和指令文件都不是成果。

可设置 `STEER_TEST_DATABASE_URL`，在独立 PostgreSQL 数据库运行 `go test -race ./internal/store ./internal/api`（工作目录为 `server/`）。测试覆盖 Project、持久会话、Run 投影、Artifact 发现与文件预览，不调用真实 AI Runtime。

## 本地验证

需要 Docker、Go 1.26+ 和 Node.js 22+。

```bash
cp .env.example .env
docker compose up -d --build
npm install
npm run dev
```

打开 <http://localhost:3000>。Steer API 地址为 <http://localhost:8080>。

本地 Compose 会同时启动 Steer Server、Relay Server 和一个 PostgreSQL 实例。Steer 与 Relay 共用 PostgreSQL 进程，但分别使用 `steer` 和 `relay` 数据库。

生产环境如需独立部署 Relay，可以只启动 Steer 服务并配置远程地址：

```bash
RELAY_BASE_URL=https://relay.example.com \
RELAY_PUBLIC_URL=https://relay.example.com \
RELAY_HOST_TOKEN=your-host-token \
docker compose up -d --build postgres steer-server
```

在 Steer 的 **System → Runtimes → Add Runtime** 中生成带有 15 分钟有效期的一次性 enrollment token 的 Relay Node 安装命令。Node 归生成命令的登录用户所有；安装一次后，可以把同一个物理 Runtime 分别连接到该用户拥有的多个 Workspace。各 Workspace 使用独立的逻辑 Binding，Node 并发容量仍由整台机器全局共享。

Node 运行包含 Qoder 适配器的 Relay 版本后，Qoder（`qodercli`）和千问办公（`qoderclicn`）会以 `qoder`、`qwenwork` 两个 Runtime provider 出现。需要以 Node 的系统用户先执行一次 `qodercli login` 或 `qoderclicn login`，并在 Node 配置中设置无头权限策略，例如 `"args": ["--permission-mode", "accept_edits"]`，否则 Qoder 会拒绝写文件和执行命令。

如需从其他机器连接 Node，请在 `.env` 中设置 `RELAY_BIND_ADDRESS=0.0.0.0`，将 `RELAY_PUBLIC_URL` 设置为本机可访问的局域网地址或 HTTPS 域名，并更换默认开发 Token。

## 检查

```bash
npm run lint
npm run build
cd server && go test ./... && go vet ./...
```

## Vercel 部署

同一仓库创建两个 Vercel 项目：官网 Root Directory 选 `website`，工作台选仓库根目录（Next.js）。
工作台设置 `STEER_API_ORIGIN` 为 Steer Server 的公网源地址（不带 `/api/v1`），
`NEXT_PUBLIC_STEER_API_URL` 保持 `/api/v1`，通过同源转发支持登录。
Go 后端和 PostgreSQL 仍独立部署。长期使用建议配置同站点域名，让流式请求直连后端。
详见[部署与 R2 存储配置](docs/deployment.md#vercel-frontends-and-persistent-backends)。
