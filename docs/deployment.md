# Deployment topology

## Accounts and workspaces

Steer requires sign-in for every business API. The first account registered on
an upgraded installation adopts `STEER_DEFAULT_WORKSPACE_ID`, preserving its
existing Projects, conversations, Agents, and artifacts. Later accounts receive
new private Workspaces, and every user can create additional Workspaces from the
sidebar switcher.

Authentication sessions are opaque random tokens stored server-side; browsers
receive only an HttpOnly, SameSite cookie. When Steer Web and Steer Server use
different origins, `STEER_ALLOWED_ORIGINS` must exactly contain the Web origin
so credentialed requests are accepted.

Workspace integration credentials are encrypted before being stored. Set a
stable, private `STEER_CREDENTIAL_ENCRYPTION_KEY` on `steer-server`; do not use
the Compose development default in production. See the
[Feishu integration guide](feishu-integration.md) for the self-service setup.

Steer and Relay are independent products and should be deployed as separate services.

```text
Internet
  ├─ Steer Web
  ├─ Steer Server ── Steer PostgreSQL
  │       └─ authenticated request ── Relay Server ── Relay PostgreSQL
  │                                      └─ heartbeat / lease ── Relay Nodes
  │                                                               └─ Agent Runtimes
  └─ users
```

For local development, Steer's `docker-compose.yml` starts Relay Server as well. Steer and Relay share one PostgreSQL container but use separate `steer` and `relay` databases, keeping their schemas and migrations independent. Production can deploy the same services separately to isolate upgrades, credentials, capacity, and failures.

When developing a Relay protocol change alongside Steer, keep the repositories
independent and layer the source-build override on top of the normal Compose
stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.relay-dev.yml up -d --build
```

The override builds Relay from `../relay` by default. Set `RELAY_SOURCE_DIR` if
the Relay checkout lives elsewhere. The regular Compose file continues to use a
versioned Relay release, so production packaging does not depend on a sibling
source checkout.

## Local deployment

Copy the example environment and start the complete stack:

```bash
cp .env.example .env
docker compose up -d --build --wait
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:3000
```

The default local topology is:

```text
postgres:5432/steer ← steer-server
postgres:5432/relay ← relay-server
```

- `RELAY_BASE_URL` defaults to `http://relay-server:8787` inside Compose.
- `RELAY_PUBLIC_URL` is shown in Runtime onboarding and must be reachable by the machine running Relay Node. Use a LAN address or public HTTPS domain for remote machines.
- `RELAY_HOST_TOKEN` lets Steer Server call Relay's host API. It never reaches the browser.
- `RELAY_NODE_TOKEN` is supplied only to Relay Server and installing Nodes.

Bundled Relay binds to `127.0.0.1` by default. To connect a Node from another machine, configure:

```dotenv
RELAY_BIND_ADDRESS=0.0.0.0
RELAY_PUBLIC_URL=http://192.168.1.20:8787
RELAY_HOST_TOKEN=replace-with-a-long-random-host-token
RELAY_NODE_TOKEN=replace-with-a-different-long-random-node-token
```

Use TLS and firewall rules before exposing Relay directly to the public internet.

Compose also starts Steer Web on port `3000`. For a remote host, replace
`localhost` in `NEXT_PUBLIC_STEER_API_URL`, `STEER_ALLOWED_ORIGINS`, and
`RELAY_PUBLIC_URL` with the browser- and Node-reachable host or HTTPS domain
before building the images.

Run `npm run dev` separately only when developing the Web client with hot reload.

## Public deployment

For an internet-accessible validation environment, deploy Relay as its own Railway service with its own PostgreSQL, then deploy Steer separately. Follow the [Relay Railway guide](https://github.com/KDF5000/relay#railway). Start only `postgres` and `steer-server` from this Compose file when testing against that external Relay:

```bash
docker compose up -d --build postgres steer-server
```

Set these variables on Steer Server:

```dotenv
RELAY_BASE_URL=https://relay.example.com
RELAY_PUBLIC_URL=https://relay.example.com
RELAY_HOST_TOKEN=the-relay-host-token
```

For a durable environment, configure Relay's artifact backend with S3-compatible storage instead of ephemeral container storage.

## Enroll a Relay Node and share its Runtimes

A Relay Node represents one physical machine and process. It is installed once,
belongs to the Steer user who generated its enrollment token, and reports the
Agent CLIs available on that machine. The owner can share the Node's physical
Runtimes with any of their Workspaces. Each Workspace receives an independent
logical Runtime Binding, while Node capacity remains one global limit shared by
all workloads on the machine.

Open **System → Runtimes → Add Runtime** in Steer:

1. Generate an installation command. Its one-time enrollment token expires
   after 15 minutes.
2. Run the command on the machine where Codex, `traex`, or `trae-cli` is
   installed.
3. Refresh **Your Relay Nodes**, select the discovered Runtime instances, and
   add them to the current Workspace. Repeat step 3 in another Workspace to
   share the same physical Runtime.

The generated command has this form:

```bash
curl -fsSL https://raw.githubusercontent.com/KDF5000/relay/main/install.sh \
  | RELAY_NODE_TOKEN='the-same-node-token-as-relay' sh -s -- \
    --server https://relay.example.com \
    --steer-server https://steer.example.com/api/v1 \
    --enrollment-token 'steer_enr_...' \
    --install-service
```

The installer generates a stable random Node ID and uses the machine hostname
only as its display name. `RELAY_NODE_TOKEN` still authenticates the Node to
Relay Server; the short-lived Steer enrollment token establishes the Node's
owner and cannot be reused.

Disconnecting a Runtime from one Workspace deletes only that Workspace's
logical Binding. It does not stop or uninstall the Node and does not affect
other Workspaces. Steer refuses to disconnect a Binding that is still selected
by an Agent, Project, or conversation.

### Breaking upgrade from the legacy Runtime assignment model

This release intentionally does not preserve the previous one-Workspace-per-
Runtime assignments. Migration `000021` clears existing Agent, Project, and
conversation Runtime selections. Remove the old Relay Node service and
configuration, then reinstall it with a new Steer enrollment command. After the
Node reconnects, share its Runtimes with each Workspace and reselect them on
Agents and directory Projects.
