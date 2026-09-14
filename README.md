# Steer

Steer is a Chat-first workspace for working with AI agents across local and remote machines. It keeps projects, conversations, runs, and durable artifacts together while [Relay](https://github.com/KDF5000/relay) handles multi-machine Runtime execution.

[中文文档](README.zh-CN.md)

## Architecture

Steer is an independent product with two deployable services:

```text
Steer Web → Steer Server → PostgreSQL
                         → Relay Server → Relay Nodes → Agent Runtimes
```

- `app/` contains the Vinext/React web client.
- `server/` contains the standalone Go business API.
- PostgreSQL stores Workspace-scoped Projects, Agents, conversations, Run projections, and artifact metadata.
- Relay remains separately deployed infrastructure. Steer Server uses Relay's public Go SDK; the browser never receives a Relay token.

See [Architecture](docs/architecture.md), [Deployment](docs/deployment.md), and [Chat-first product design](docs/chat-first-product.md).

## Verified MVP flow

The current build supports a real end-to-end path:

1. Discover Nodes, Runtimes, and model catalogs from Relay.
2. Create an Agent with automatic scheduling or a pinned Runtime instance.
3. Add an existing-directory Project on a specific Runtime, or a Git Project backed by Relay's mirror and isolated-worktree provider.
4. Start a conversation with an Agent. The Project, Runtime, and prepared workspace stay stable; compatible Agents can be switched from the composer between runs.
5. Follow streaming Relay Run output and cancel an active Run from the composer.
6. Review durable files produced by the current conversation in the right-side Artifact panel.
7. Preview or download artifacts and reopen recent conversations after refresh.

Every Run has a conversational response; artifacts are optional. Steer only treats intentional reusable outputs exposed through Relay as artifacts. Runtime final-message files, logs, and instruction files are not artifacts.

## Local verification

Requirements: Docker, Go 1.26+, and Node.js 22+.

Start the complete stack. Compose runs Steer Web, Steer Server, Relay Server, and one shared PostgreSQL instance with separate `steer` and `relay` databases:

```bash
cp .env.example .env
docker compose up -d --build
```

For a production-style setup with Relay deployed independently, start only the Steer services and point them at the external Relay:

```bash
RELAY_BASE_URL=https://relay.example.com \
RELAY_PUBLIC_URL=https://relay.example.com \
RELAY_HOST_TOKEN=your-host-token \
docker compose up -d --build postgres steer-server
```

For frontend development with hot reload, run the Web client outside Compose:

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The Steer API is available at <http://localhost:8080>, and `GET /health` reports both Steer and Relay connectivity.

To connect a Node from another machine, set `RELAY_BIND_ADDRESS=0.0.0.0`, set `RELAY_PUBLIC_URL` to this host's reachable LAN address or HTTPS domain, and replace both local development tokens in `.env`.

## Checks

```bash
npm run lint
npm run build
cd server && go test ./... && go vet ./...
```

PostgreSQL workflow tests are opt-in and use a disposable database (never point this at a production database):

```bash
cd server
STEER_TEST_DATABASE_URL=postgres://user:password@localhost:5432/steer_test \
  go test -race ./internal/store ./internal/api
```

These tests cover Projects, persistent conversations, Run projection, artifact discovery, and file preview through a deterministic Relay transport. They do not invoke an installed AI Runtime.

## Configuration

| Variable                     | Default                                  | Purpose                                            |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`               | local Compose PostgreSQL                 | Steer business database                            |
| `RELAY_BASE_URL`             | `http://relay-server:8787` in Compose    | Relay Server address                               |
| `RELAY_PUBLIC_URL`           | same as `RELAY_BASE_URL` outside Compose | Relay address shown to machines connecting a Node  |
| `RELAY_BIND_ADDRESS`         | `127.0.0.1`                              | Host interface used by bundled Relay               |
| `RELAY_HOST_TOKEN`           | empty                                    | Relay host access token                            |
| `RELAY_NODE_TOKEN`           | local development token                  | Token used by Nodes registering with bundled Relay |
| `RELAY_VERSION`              | pinned Relay commit                      | Relay revision built by the bundled Compose stack  |
| `STEER_ADDR`                 | `:8080`                                  | Steer Server listen address                        |
| `STEER_DEFAULT_WORKSPACE_ID` | `default`                                | Workspace used before authentication is introduced |
| `STEER_ALLOWED_ORIGINS`      | local Web origin                         | Browser CORS allowlist                             |
| `NEXT_PUBLIC_STEER_API_URL`  | `http://localhost:8080/api/v1`           | Web client API base URL                            |
| `STEER_SERVER_PORT`          | `8080`                                   | Published Steer Server port                        |
| `STEER_WEB_BIND_ADDRESS`     | `0.0.0.0`                                | Host interface used by Steer Web                   |
| `STEER_WEB_PORT`             | `3000`                                   | Published Steer Web port                           |
