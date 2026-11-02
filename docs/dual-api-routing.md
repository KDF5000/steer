# IPv6 direct access with Cloudflare Tunnel fallback

Implemented and deployed on 2026-10-31 against source base `20fe146` plus the
dual-endpoint changes in the working tree. Public Web entry remains
`https://steer-console.pcursor.run`.
Final Vercel deployment: `dpl_ENEZYw6o2FFi1isEMgt4hmN28WtT` (READY, promoted).
All three backend containers are healthy; the Tunnel has two ready connections
and the existing Relay Node remains online with five runtimes.

Steer Web can select between two HTTPS endpoints for the same backend. This
is client-side routing; it does not depend on mixing proxied and DNS-only
records on the same hostname.

## Deployment configuration

```dotenv
# Vercel production build
NEXT_PUBLIC_STEER_API_URL=https://steer-direct.pcursor.run:8843/api/v1
NEXT_PUBLIC_STEER_API_FALLBACK_URL=https://steer-api.pcursor.run/api/v1
STEER_API_ORIGIN=https://steer-api.pcursor.run
# Steer Server
STEER_SESSION_COOKIE_DOMAIN=pcursor.run
STEER_ALLOWED_ORIGINS=https://steer-console.pcursor.run
RELAY_PUBLIC_URL=https://relay-server.pcursor.run:8443
RELAY_FALLBACK_URL=https://relay.pcursor.run
```

Keep the existing complete origin allowlist when updating the backend. The two
API origins must use the same database and session secrets. The direct hostname
is DNS-only, follows the existing DDNS record, and uses a public certificate
issued by Caddy. The fallback hostname is a proxied Tunnel CNAME. It uses a
first-level subdomain so Cloudflare Universal SSL covers it without a paid
certificate for a nested hostname.

The browser cookie is HttpOnly, Secure on HTTPS, SameSite=Lax, and scoped to
`pcursor.run`, which covers both API hostnames. Because these canonical names
are siblings, review other applications on the parent domain before sharing
the session cookie with them on `pcursor.run`. Only controlled API services
should use this namespace.
Users coming from the old API hostname need to sign in once on the new API.
Use the Web custom domain; an unrelated `*.vercel.app` origin cannot use this
same-site cookie arrangement for direct browser requests.

Leaving `NEXT_PUBLIC_STEER_API_FALLBACK_URL` empty preserves single-endpoint
behavior and requires no cookie-domain change.

## Routing behavior

- Probe `/api/v1/health` without credentials or caching. Accept only the Steer
  identity and healthy status, not an arbitrary successful web page.
- Start the direct and Tunnel probes concurrently. The first healthy response
  wins, so IPv6 is not preferred merely because it exists: a faster Tunnel can
  be selected too. Direct probes time out after 2.5 seconds; Tunnel probes get
  20 seconds so an IPv4-only client is not blocked by an unreachable AAAA path.
- Share one initial selection between concurrent requests. Keep the selected
  endpoint for subsequent requests.
- On a transport error or HTTP 502/503/504, retry a GET or HEAD once through a
  recently healthy alternate route. One failure is treated as network jitter
  and does not change the preferred route; two consecutive failures move future
  traffic. Replay a task submission only with its original Idempotency-Key and
  reusable body; ordinary writes are never automatically replayed.
- Bound the wait for response headers to 30 seconds. This deadline does not
  truncate a streaming response or download body.
- While requests are active, measure both routes in the background at most once
  a minute. Latency uses an exponentially smoothed value. Switch only when the
  alternate route is both at least 20% faster and saves at least 100 ms, or when
  the current route is unavailable. This hysteresis prevents route flapping.
  Existing SSE connections stay on their original endpoint until they reconnect.
- Send SSE heartbeat comments every 15 seconds. A client stream idle for
  45 seconds fails, changes route, and lets the existing conversation reconnect
  using its last event sequence. Cancellation by the user does not trigger a
  replay or failover. The conversation already deduplicates resumed events.

Native download/attachment links use the currently selected endpoint. They do
not replay an in-progress browser download across hosts; retry a failed download
after the API connection has recovered. Route switching is not backend HA:
both endpoints still depend on the same Mac, database, and home connection.

## Mac mini operations

Host: `kongdefei@192.168.31.248` (DHCP address after the 2026-11-02 reboot).
Checkout: `/Users/kongdefei/Documents/workspace/steer`.
Compose project: `steer-production`, environment: `.env.production`.

Independent Tunnel: `steer-production`, UUID
`a7a3ea80-ac3b-497c-98fe-29c93b58c247`.
Existing Immich Tunnel remains separate.

Configuration: `~/.cloudflared/steer-production.yml`.
LaunchAgent: `~/Library/LaunchAgents/com.steer.cloudflared.plist`.
Logs: `~/.cache/steer/tunnel.error.log`.
Readiness: `http://127.0.0.1:20246/ready`.

```sh
launchctl print gui/$(id -u)/com.steer.cloudflared
launchctl kickstart -k gui/$(id -u)/com.steer.cloudflared
curl -fsS http://127.0.0.1:20246/ready
```

Tunnel ingress maps `steer-api.pcursor.run` to `http://127.0.0.1:18080` and
`relay.pcursor.run` to `http://127.0.0.1:18787`. Other hostnames receive 404.
The connector uses QUIC: HTTP/2 edge handshakes failed in this host's current
network configuration, while QUIC connected successfully. As of 2026-11-01,
Tunnel edge traffic bypasses Clash proxy nodes and the TUN interface through
physical-interface routes and real DNS resolution. See the
[native egress verification and latency results](testing/tunnel-native-2026-11-01.md).
The LaunchAgent starts at user login; it is not a pre-login system daemon.

Caddy's LaunchAgent has explicit HTTP(S) proxy settings for certificate issuer
requests, because direct ACME directory requests returned EOF. Its loopback
upstreams bypass that proxy. Existing Caddy configuration and LaunchAgent were
backed up beside their originals before changes.

Relay Nodes receive the direct IPv6 URL first and the Tunnel URL second during
one-command enrollment. A Node keeps one active route, switches on transport or
gateway failure, and periodically probes the preferred direct route for
recovery. Both URLs must reach this same Relay Server and database. Existing
Nodes older than v0.5.10 keep their single configured URL until reinstalled or upgraded.
The Node running on the Relay Server host itself uses
`http://127.0.0.1:18787` before those two public routes. This avoids routing a
local control-plane connection through Clash fake-IP DNS while preserving the
same public failover behavior for Nodes installed on other machines.
Do not put an interactive Cloudflare Access login in front of Relay's
machine-to-machine API without a corresponding service auth design.

## Verification and rollback

```sh
npm test
npx tsc --noEmit
cd server && go test -race ./internal/api ./cmd/steer-server
curl -6 https://steer-direct.pcursor.run:8843/api/v1/health
curl -4 https://steer-api.pcursor.run/api/v1/health
curl -4 https://relay.pcursor.run/health
```

Test login, credentialed CORS, stream replay with an event cursor, failed direct
connections, and restoring direct access. Tests must not submit a task twice
without a stable idempotency key. Do not interpret a healthy public endpoint as
proof of performance from all Chinese carriers; collect representative client
and evening measurements before setting a latency target.

Rollout verification passed: 32 frontend tests, TypeScript, scoped lint, a Next.js
production build, and Go API tests with the race detector. The HTTP stream test
observed a real 15-second heartbeat and confirmed upstream cancellation.
An expiring temporary auth session was used to verify HTTP 200 on both API
entrances, a historical stream resumed on the IPv4 Tunnel after its original
event cursor, the shared logout cookie, and HTTP 401 after logout. That temporary
session was removed. No user password or new Agent task was needed.
The real endpoint router test forced IPv6 unavailable, verified IPv4 Tunnel
selection, then restored IPv6 and verified recovery to direct access.

Single-client samples during verification were approximately 0.08 seconds for
direct `/auth/me` and 2.5 seconds through Tunnel; the resumed Tunnel stream took
3.3 seconds. These are deployment checks, not domestic carrier benchmarks or
availability guarantees. One earlier Tunnel request timed out before subsequent
checks succeeded. Keep both paths and monitor real client behavior.
Repository-wide lint also encounters existing errors in unrelated untracked
prototype files; lint for the modified TypeScript and test files passes.

The backend environment, Caddy files, and database were backed up before the
rollout. Database dumps are under `~/.local/share/steer/backups/` with private
permissions. The old backend image is tagged
`steer-production-steer-server:before-dual-api`.
To roll back the browser routing, restore its previous production deployment
or set the old direct API URL and clear the fallback URL, then rebuild.
The old direct domains remain available. Remove the new LaunchAgent only after
the browser no longer depends on its Tunnel.
