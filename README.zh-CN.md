# Steer

Steer 是一个 Chat-first 的 Agent 工作台，让用户通过同一个对话入口在本地或远程机器的项目目录中工作，由 [Relay](https://github.com/KDF5000/relay) 负责多机器 Runtime 执行。

## 架构

Steer 是独立产品，包含两个可独立部署的服务：

```text
Steer Web → Steer Server → PostgreSQL
                         → Relay Server → Relay Nodes → Agent Runtimes
```

- `app/`：Vinext/React Web 前端；
- `server/`：独立 Go 业务后端；
- PostgreSQL：保存按 Workspace 隔离的 Project、Agent、对话、Run 投影和成果索引；
- Relay：独立部署的执行基础设施。Steer Server 通过 Relay Go SDK 接入，浏览器不会接触 Relay Token。

详细说明见[架构设计](docs/architecture.md)、[部署拓扑](docs/deployment.md)和[Chat-first 产品设计](docs/chat-first-product.md)。

## 当前可验证链路

1. 从 Relay 自动发现 Node、Runtime 和模型；
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

在 Steer 的 **System → Runtimes → Add Runtime** 中可以获取 Relay Node 安装命令。Runtime 由 Node 自动发现并注册，不是在 Steer 数据库中手工创建的记录。

如需从其他机器连接 Node，请在 `.env` 中设置 `RELAY_BIND_ADDRESS=0.0.0.0`，将 `RELAY_PUBLIC_URL` 设置为本机可访问的局域网地址或 HTTPS 域名，并更换默认开发 Token。

## 检查

```bash
npm run lint
npm run build
cd server && go test ./... && go vet ./...
```
