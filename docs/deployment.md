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
so credentialed requests are accepted. Direct API access also requires both
origins to be same-site (for example, HTTPS subdomains of `example.com`),
because the session cookie uses SameSite=Lax. CORS alone does not allow
cross-site cookies. The default Web configuration avoids this by proxying
`/api/v1` through Next.js.

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
- `RELAY_NODE_TOKEN` is the server-side root secret for signing Node credentials. Steer never sends this global secret to users; each generated installation command includes a credential scoped to its own Node ID. Existing manually configured Nodes can still use the legacy shared token.

Bundled Relay binds to `127.0.0.1` by default. To connect a Node from another machine, configure:

```dotenv
RELAY_BIND_ADDRESS=0.0.0.0
RELAY_PUBLIC_URL=http://192.168.1.20:8787
RELAY_HOST_TOKEN=replace-with-a-long-random-host-token
RELAY_NODE_TOKEN=replace-with-a-different-long-random-node-token
```

Use TLS and firewall rules before exposing Relay directly to the public internet.

Compose also starts Steer Web on port `3000`. For a remote host, replace
`STEER_ALLOWED_ORIGINS` and `RELAY_PUBLIC_URL` with the browser- and
Node-reachable origins. Keep `NEXT_PUBLIC_STEER_API_URL=/api/v1` for the
same-origin proxy; Compose builds it against `http://steer-server:8080`.
Existing `.env` files may still contain the old direct localhost API URL;
update that value before rebuilding. Steer Web runs the production Next.js
standalone server as an unprivileged user.

Run `npm run dev` separately only when developing the Web client with hot reload.

## Vercel frontends and persistent backends

Create two Vercel projects from this repository:

| Project         | Root Directory        | Framework | Output                      |
| --------------- | --------------------- | --------- | --------------------------- |
| Public website  | `website`             | Vite      | `dist` (static, bilingual)  |
| Steer workbench | repository root (`.`) | Next.js   | Framework default (`.next`) |

Both projects have their own `vercel.json` and npm lockfile. Remove any old
Vite/vinext build overrides from the workbench's Vercel settings. Use Node 22
and leave the workbench Output Directory at its Next.js default. The website
continues to build independently; see [website setup](../website/README.md).

On the **workbench** Vercel project, set:

```dotenv
STEER_API_ORIGIN=https://your-steer-api.example.com
NEXT_PUBLIC_STEER_API_URL=/api/v1
```

`STEER_API_ORIGIN` is the Go service origin, without `/api/v1`, a trailing
path, or credentials. Next.js forwards `/api/v1/*` to it, including cookies
and streaming responses. Both variables affect the build: redeploy after
changing them. Local `npm run dev` defaults to forwarding to
`http://localhost:8080`. Do not put database, Relay, or R2 credentials in
Vercel or in any `NEXT_PUBLIC_*` variable.

Set `STEER_ALLOWED_ORIGINS=https://your-workbench.vercel.app` on Steer Server
(or the actual custom domain). The browser uses a same-origin URL and keeps
its HttpOnly session cookie on the workbench domain. This works with the
platform-provided domain without changing cookie policy. Preview deployments
need their own origin configuration and an intentionally selected backend;
Node installation callbacks must be reachable without Vercel Deployment
Protection blocking them.

### Long-running tasks and streams

Vercel hosts the frontend and proxies API traffic. It does **not** execute
Agent tasks. Deploy `steer-server` and `relay-server` as persistent Go/container
services with PostgreSQL, for example on Northflank or Railway. They need to
remain running for task coordination and Feishu connections. Relay Nodes
continue running on the user's own machines and connect to the public Relay
HTTPS endpoint.

For regular use, prefer same-site custom domains and direct API traffic:

```dotenv
# Vercel workbench: https://app.example.com
NEXT_PUBLIC_STEER_API_URL=https://api.example.com/api/v1
# Steer Server
STEER_ALLOWED_ORIGINS=https://app.example.com
```

This avoids sending long SSE connections, uploads, and artifact downloads
through Vercel's proxy and its platform limits. Use HTTPS for both domains.
Do not directly connect `*.vercel.app` to an unrelated provider domain with
this cookie policy. The same-origin proxy remains the convenient initial
setup. Verify stream reconnection and large-file behavior on the deployed
platform before treating it as a production capacity guarantee; a successful
local proxy check does not establish Vercel's limits.

### Backend configuration

Steer and Relay can share one PostgreSQL instance with separate `steer` and
`relay` databases, as in Compose. Use a direct PostgreSQL connection or a
session-mode pooler: Steer uses session advisory locks, so a transaction-mode
pooler is not suitable. Free hosting allowances, sleep behavior, storage,
and connection quotas must be checked for the selected plan.

Set these variables on Steer Server (in addition to `DATABASE_URL`,
`STEER_ALLOWED_ORIGINS`, and a stable `STEER_CREDENTIAL_ENCRYPTION_KEY`):

```dotenv
RELAY_BASE_URL=https://relay.example.com
RELAY_PUBLIC_URL=https://relay.example.com
RELAY_HOST_TOKEN=the-relay-host-token
```

Use the provider's private Relay address for `RELAY_BASE_URL` when available;
keep `RELAY_PUBLIC_URL` reachable by remote Nodes. Keep Relay host and Node
tokens consistent across the corresponding services. For Railway-specific
setup, see the [Relay guide](https://github.com/KDF5000/relay#railway).

## Artifact storage: persistent volume or R2

Local Compose already stores Relay artifacts in a named volume. Keep that
for local use. On a cloud container platform with ephemeral disks, use
S3-compatible object storage; **R2 Standard is the recommended starting point**
when no suitable persistent volume is included. It survives application
redeployment and is already supported by Relay's S3 backend. No Workers
service, frontend SDK, or Relay code change is needed.

R2 stores artifact file bytes. PostgreSQL still stores accounts, conversations,
Run metadata, and artifact records; project directories and Agent runtime
state still live on Relay Nodes. R2 does not replace PostgreSQL or back up
those directories. Website images remain part of the Vercel static build.

Create a private Standard bucket and a bucket-scoped Object Read & Write
S3 API credential. Configure **Relay Server** with:

```dotenv
RELAY_ARTIFACT_BACKEND=s3
RELAY_S3_ENDPOINT=<ACCOUNT_ID>.r2.cloudflarestorage.com
RELAY_S3_ACCESS_KEY=<R2_ACCESS_KEY_ID>
RELAY_S3_SECRET_KEY=<R2_SECRET_ACCESS_KEY>
RELAY_S3_BUCKET=steer-artifacts
RELAY_S3_PREFIX=production
RELAY_S3_REGION=auto
RELAY_S3_SECURE=true
```

The endpoint intentionally has no `https://`: Relay's S3 client expects a
hostname. Provision the bucket first; Relay does not create it. Leave
`RELAY_S3_SESSION_TOKEN` unset for regular R2 API credentials. These values
belong only in the Relay service's secret/environment configuration. The
base Compose file deliberately retains its local file backend; merely adding
S3 variables to `.env` does not change it.

Downloads continue through authenticated Steer/Relay APIs. Do not enable
public bucket access or `r2.dev`; browser-to-R2 CORS is unnecessary for this
flow. R2 has no egress charge, but the backend (and Vercel if proxying) can
still charge for the traffic it serves.

As checked on 2026-10-16, R2 Standard includes 10 GB-month of storage,
1 million Class A operations, and 10 million Class B operations per month.
Above the allowance, published rates are $0.015/GB-month, $4.50/million
Class A, and $0.36/million Class B. These allowances do not apply to
Infrequent Access. Check [current pricing](https://developers.cloudflare.com/r2/pricing/)
and [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
before provisioning. Free allowance is not a spending cap.

Switching the backend does not migrate existing artifacts. If keeping old
artifacts, stop writes, copy the existing artifact files into the bucket
under the configured prefix while preserving their relative keys, retain
the PostgreSQL artifact records, and verify authenticated downloads before
removing the original volume. Do not apply a blanket object-expiration rule
without coordinating database retention.

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
RELAY_NODE_ID='node_generated-by-steer'
RELAY_MACHINE_NAME_JSON=$(hostname | sed 's/\\/\\\\/g; s/"/\\"/g')
curl -fsSL https://raw.githubusercontent.com/KDF5000/relay/main/install.sh \
  | RELAY_NODE_TOKEN='relay_node_v1.generated-for-this-node' sh -s -- \
    --server https://relay.example.com \
    --node-id "$RELAY_NODE_ID" \
    --force \
    --install-service && \
  curl -fsS -X POST https://steer.example.com/api/v1/relay-node-enrollments/claim \
    -H 'Content-Type: application/json' \
    --data-binary "{\"token\":\"steer_enr_...\",\"nodeId\":\"$RELAY_NODE_ID\",\"name\":\"$RELAY_MACHINE_NAME_JSON\",\"capacity\":2}"
```

Steer generates the stable Node ID before installation. The Relay installer
uses that ID, then the second request claims the same Node in Steer and uses the
machine hostname only as its display name. `--force` replaces an existing Relay
Node configuration so that a re-registration cannot silently keep a different
Node ID; the installer creates a timestamped backup first. The command's
`RELAY_NODE_TOKEN` is an automatically issued credential for this Node only;
users do not need to request a token from an administrator or edit the command.
Relay stores no per-Node secret: it verifies a signed credential using the root
secret configured on Relay Server. The installer saves the scoped credential
in the Node's configuration for registration and ongoing heartbeats.

The separate `steer_enr_...` enrollment token expires after 15 minutes, is bound
to the generated Node ID, and establishes ownership exactly once. It cannot be
used to claim a different Node. Expiration does not disconnect an installed
Node, because its Relay credential is persistent.

Deploy Relay Server v0.5.2 or later, which adds `POST /v1/node-credentials`,
before updating Steer Server and the workbench. Relay v0.5.1 and earlier do
not include this endpoint. Steer calls this endpoint using its server-side host token and
returns a clear error when the Relay version or authentication configuration
cannot issue scoped credentials. No Relay Node protocol or installer upgrade
is needed for this credential format. Migration `000025` invalidates pending
legacy enrollment codes; generate a fresh command after upgrading.

Keep the Relay Server root secret stable across restarts and replicas.
Rotating it invalidates all derived Node credentials (and legacy shared
credentials). Deleting a Node in Steer removes ownership and bindings; it does
not revoke a previously issued Relay credential. Individual credential
revocation is not part of this version.

Both the Relay Server URL and the Steer API URL in this command must be
reachable from the machine running the installer. In particular, do not use a
browser-relative Steer URL such as `/api/v1`, or `localhost` unless Steer is
running on that same machine.

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

### Project machine locations

Directory Projects store a `nodeId` for the machine containing the directory.
The selected Agent determines which Runtime executes there; only Runtimes
assigned to the current workspace are eligible. An Agent fixed to another
machine cannot execute a task in that directory Project. Git repository
Projects continue to use reusable conversation worktrees on the selected Agent's
Runtime.

Migration 26 converts existing Project Runtime bindings to their owning Node,
without changing Agent bindings or conversation Runtime state. Different Runtime
providers can start separate conversations under the same Project. A shared conversation can switch Agents and providers on the same machine.
Relay maintains a separate native session for each Agent/Runtime/provider. When
switching Agents, Steer supplies the bounded shared transcript as the continuation
prompt so a previously used native session receives intervening work. Consecutive
turns with the same Agent continue using the short current-turn prompt. Native
thinking, caches, and internal tool state are not shared across providers. Project Git status inspects the Project's current Node.

Deploy the Steer Server and frontend together for the new Project machine
selector. Relay Server and Relay Node require no protocol changes for this feature.
