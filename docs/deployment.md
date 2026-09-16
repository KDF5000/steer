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

## Add a Runtime

A Runtime is not created as a Steer database row. It becomes available when a Relay Node reports a supported Agent CLI from its machine.

Open **System → Runtimes → Add Runtime** in Steer, or run the following command directly on a machine that already has Codex, `traex`, or `trae-cli` installed:

```bash
curl -fsSL https://raw.githubusercontent.com/KDF5000/relay/main/install.sh \
  | RELAY_NODE_TOKEN='the-same-node-token-as-relay' \
    sh -s -- --server https://relay.example.com --install-service
```

After the Node heartbeat arrives, refresh Runtimes in Steer. The current Relay release uses a static operator-managed Node Token. A future enrollment API should replace it with scoped, short-lived installation tokens before self-service onboarding is exposed to untrusted users.
