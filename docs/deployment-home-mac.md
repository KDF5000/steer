# Home Mac deployment

Updated 2026-10-31: production now uses [IPv6 direct access with automatic Tunnel
fallback](dual-api-routing.md). The browser prefers
`https://steer-direct.pcursor.run:8843/api/v1`, falls back to
`https://steer-api.pcursor.run/api/v1`, and new Node enrollment uses
`https://relay.pcursor.run`. Earlier direct endpoints below remain for backward
compatibility. New API hostnames require users to sign in once.

Deployment prepared on 2026-10-27 from commit `6e7af7076f743411638971e6f22699ad001ea33f`.

Final production deployment: `dpl_ZmdFbrHmDB7CVJ5ZkFaHYeSh4wWE`, READY and
promoted to `steer-console.pcursor.run` at approximately 23:00 Asia/Shanghai.
Verified both public HTTPS health endpoints, unauthenticated API responses,
credentialed CORS for the Web origin, and the browser login screen without an
API error. The initial Vercel runtime error scan returned zero records.
Account registration, Node enrollment, and executing an Agent task remain
user onboarding steps and were not exercised with a real account.

## Services

Host: `kongdefei@192.168.31.248` (DHCP address after the 2026-11-02 reboot).
Checkout: `/Users/kongdefei/Documents/workspace/steer`.
Compose project: `steer-production`.

| Service              | Host binding             | Public endpoint                                                                            |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Steer Server         | `127.0.0.1:18080`        | `https://steer-direct.pcursor.run:8843` (direct), `https://steer-api.pcursor.run` (Tunnel) |
| Relay Server v0.5.11 | `127.0.0.1:18787`        | `https://relay-server.pcursor.run:8443`                                                    |
| PostgreSQL 17        | `127.0.0.1:54329`        | None                                                                                       |
| Steer Web            | Vercel `steer-workbench` | `https://steer-console.pcursor.run`                                                        |

The existing cn-proxy, Immich, and legacy `realy` deployment retain their
ports and data. The new deployment has independent PostgreSQL and artifact
volumes. It does not migrate legacy Relay Nodes or old application data.

## Backend operations

Production credentials were generated on the target host in `.env.production`
(mode `0600`, ignored by Git). Keep this file stable and back it up privately:
it contains database credentials, Relay signing secrets, and the credential
encryption key. Do not replace it with `.env.example` during upgrades.

Run on the target host:

```sh
cd /Users/kongdefei/Documents/workspace/steer
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
docker compose -p steer-production --env-file .env.production ps
docker compose -p steer-production --env-file .env.production logs --tail 100 steer-server relay-server
docker compose -p steer-production --env-file .env.production up -d --build --wait postgres relay-server steer-server
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18787/health
```

Containers use `restart: unless-stopped`. OrbStack must be running for Docker
services to run after a reboot. Never use `down -v` unless deliberately deleting
all production data. Back up both PostgreSQL databases and the Relay artifact
volume; backing up the checkout alone does not preserve application data.

## DNS and HTTPS

The direct backend name is a DNS-only CNAME to `glot-cn.pcursor.run`. The
existing `com.glot.cloudflare-ddns` daemon updates that target's IPv6 AAAA
record every 300 seconds, so the direct name follows the same DDNS without
another token or updater. The fallback name is a proxied CNAME for the
`steer-production` Cloudflare Tunnel.

`/Users/kongdefei/glot-proxy/Caddyfile` contains the Steer direct virtual host
on port 8843. A timestamped `Caddyfile.backup-steer-*` preserves
the previous configuration. Caddy obtains and renews certificates through the
existing Cloudflare DNS provider credentials. The new TLS blocks wait 30 seconds
after creating DNS challenge records, then let the ACME CA verify them directly
(`propagation_timeout -1`), because the host's DNS path returned cached NXDOMAIN
for newly created challenge records. This does not disable certificate checks.

The Steer origin requires working public IPv6 ingress on TCP 8843. Relay uses
TCP 8443. Direct clients require IPv6 connectivity, matching the existing
cn-proxy setup.
Cloudflare proxying was tested but returned 521, while direct IPv6 HTTPS worked;
the final DNS records therefore disable proxying. Retain `:8843` in the direct
Steer URL; the household setup cannot use port 443 for this origin.

## Vercel

Team: `kdf5000s-projects` (`team_v7vEpgL7m7MQAG0nNFJwF5tk`).
Project: `steer-workbench` (`prj_AtLlELJOOKwFMcCAUQKBXMm2WaMO`).
Root: repository root; Next.js; Node 22; `npm ci`; `npm run build`.

Production variables:

```dotenv
STEER_API_ORIGIN=https://steer-api.pcursor.run
NEXT_PUBLIC_STEER_API_URL=https://steer-direct.pcursor.run:8843/api/v1
NEXT_PUBLIC_STEER_API_FALLBACK_URL=https://steer-api.pcursor.run/api/v1
```

These are build-time values. Deploy again after changing them. Browser API
requests connect directly to the API. Both Web and API use HTTPS subdomains of
`pcursor.run`, so SameSite=Lax cookies work across the two origins. Use the custom
Web domain above: the platform `*.vercel.app` domain is cross-site and cannot
support this direct API login configuration with the current cookie policy.
The unused same-origin rewrite remains configured, but the Vercel proxy's access
to the IPv6-only backend is not required for the final browser flow.
`STEER_ALLOWED_ORIGINS` on the backend must include every actual Web origin.
Preview environments are not automatically connected to production.

The Vercel connector returned access errors for this project, while the local
CLI's existing account could access it. Use the CLI with explicit team scope:

```sh
npx --yes vercel@65.3.1 deploy --prod --skip-domain --yes --scope kdf5000s-projects
# Verify the returned deployment URL before assigning production domains.
npx --yes vercel@65.3.1 promote <deployment-url> --yes --scope kdf5000s-projects
```

Verify `https://steer-direct.pcursor.run:8843/api/v1/auth/me` returns an
authentication response (401 when logged out) and CORS permits
`https://steer-console.pcursor.run`. Then sign up through the
Web UI and enroll a Relay Node through System → Runtimes. No administrator
account or Node enrollment is created by this deployment procedure.

The old API hostnames remain temporary compatibility aliases. New deployments
should use the canonical direct and Tunnel names above.

## Relay Node stalls before Runtime starts after reinstall

On 2026-10-27 at 23:05:59, run `run_3844fa9b943d34f8b4616dcc` reached
`workspace.prepared`, but no `runtime.codex.started` event followed. The Node
continued heartbeating and renewing its lease, with no Codex child process.
macOS `tccd` recorded `Failed to match existing code requirement` for
`/Users/kongdefei/.local/bin/relay-node` and
`kTCCServiceSystemPolicyDocumentsFolder`, followed by `AUTHREQ_PROMPTING`.
Reinstalling the binary invalidated its previous Documents permission.

On the Mac's desktop, allow relay-node's pending Documents folder access
request. If necessary, inspect System Settings → Privacy & Security → Files
and Folders → relay-node. Grant Documents access; full disk access is not
required by this diagnosis. Then verify that the existing run emits
`runtime.codex.started` and runtime output. Node health alone does not establish
that workspace file access or a specific runtime execution works.

## Codex starts but workspace routing discovery times out

After Documents permission was approved, the same run emitted
`runtime.codex.started` and `thread.started`, then failed with
`workspace routing discovery timed out`. It exhausted both WebSocket and HTTPS
retries. Clash Verge was running, but DNS returned unrelated addresses for
`chatgpt.com` and `api.openai.com`. Public Google DoH queried through the proxy
returned different addresses. Even after correcting DNS, the selected
Singapore high-speed 02 proxy timed out; Japan dedicated 03 passed the same test.

Applied recovery on the target host:

- Backed up `dns_config.yaml` and `clash-verge.yaml` beside the originals with
  `.backup-openai-dns-<timestamp>` suffixes and private permissions.
- Added `dns.nameserver-policy` entries for `+.chatgpt.com`, `+.openai.com`,
  `+.oaistatic.com`, and `+.oaiusercontent.com` using
  `https://8.8.8.8/dns-query#良心云` in both files. The first is Clash Verge's
  persistent DNS settings; the second is the active generated configuration.
- Validated the active configuration, reloaded it through the existing Unix
  controller socket, and flushed the Mihomo DNS cache.
- Changed the `良心云` selector from `🇸🇬新加坡高速02|BGP|CTCUCM` to
  `🇯🇵日本专线03|BGP|流媒体`. `profile.store-selected` is enabled. A private
  `steer-proxy-change-<timestamp>.json` records the old and new choices.

Verification: the installed Codex CLI, using the original `gpt-5.6-sol` model,
completed an ephemeral read-only smoke test with exit code 0 and replied `OK`.
No project files were read by that test. The original failed run is terminal;
retry its message from Steer after this repair. There is no need to reinstall
Relay Node or change the selected model.

References: [Mihomo DNS configuration](https://wiki.metacubex.one/en/config/dns/)
and [controller API](https://wiki.metacubex.one/en/api/).
