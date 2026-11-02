# Native Tunnel egress and latency verification

Date: 2026-11-01, Asia/Shanghai. Target: home Mac mini at
`kongdefei@192.168.31.248`, China Unicom broadband. The DHCP address changed
from `.128` after the 2026-11-02 reboot.

## Result

Steer's Tunnel established fresh QUIC connections without a Clash proxy node
and without its data traffic entering the TUN interface. Clash was kept running
for other applications; the whole application was not shut down during this test.

Before the change, Tunnel traffic matched the catch-all rule and used
`🇯🇵日本专线03|BGP|流媒体`. After the change:

- Cloudflared connects to real `198.41.192.*` and `198.41.200.*` edge addresses,
  rather than Fake-IP destinations, and has four ready connections.
- System route checks for the edge ranges and explicit resolver show physical
  interface `en1` through the home router, instead of `utun1024`.
- The current connector's UDP sockets are absent from Clash's tracked Tunnel
  connections after reconnection.
- Its LaunchAgent clears HTTP(S)/ALL proxy environment variables and sets
  `NO_PROXY=*`. Run arguments specify `223.5.5.5:53` for service discovery.
- The public IPv4 API entrance continues returning HTTP 200 after a cold restart.

## Persistent configuration and rollback

Under `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/`:

- `profiles/Script.js` adds DIRECT rules for Tunnel domains/port-7844 edge ranges
  and adds TUN route exclusions.
- `config.yaml` and `clash-verge.yaml` preserve/apply the exclusions below.
- `dns_config.yaml` and `clash-verge.yaml` exclude `+.argotunnel.com` and
  `+.cftunnel.com` from Fake-IP, returning real addresses to the OS.

```yaml
route-exclude-address:
  - 198.41.192.0/24
  - 198.41.200.0/24
  - 2606:4700:a0::/64
  - 2606:4700:a8::/64
  - 223.5.5.5/32
```

Connector configuration: `~/.cloudflared/steer-production.yml`.
Service: `~/Library/LaunchAgents/com.steer.cloudflared.plist`.
The connector was restarted after real-DNS and route settings became active.

Timestamped `.backup-tunnel-*`, `.backup-native-direct-*`, and
`.backup-no-proxy-*` files beside the modified files preserve prior settings.
Full config backups have private permissions because they may contain secrets.
Restore corresponding files, reload Clash config, and restart the connector to
undo this change. These edge-range exclusions also apply to other cloudflared
connectors using the same destinations.

This removes the Tunnel data-path dependency on Clash. Other applications and
Caddy's previously configured certificate-issuer proxy are outside this change.
Future Cloudflare edge-range changes may require updating the exclusions.

## Measurements

Six requests per path/phase to `/api/v1/health`, each using a fresh TCP/TLS
connection. Curl bypassed environment HTTP proxies. Direct requests used IPv6;
public Tunnel requests used IPv4. All 24 measured requests returned HTTP 200.
These are complete small HTTP request times, not ping RTT or throughput.

| Path                           | Median total |            Range | Success |
| ------------------------------ | -----------: | ---------------: | ------: |
| IPv6 direct, before            |      30.2 ms |     26.9–56.3 ms |     6/6 |
| Tunnel via Japan proxy, before |    1533.3 ms | 1153.1–1976.3 ms |     6/6 |
| IPv6 direct, after             |      35.9 ms |     32.8–89.2 ms |     6/6 |
| Tunnel native egress, after    |    1637.8 ms | 1284.5–2018.8 ms |     6/6 |

The client and Mac mini share a public IPv6 /64: the direct values are a local
network baseline, not external domestic-carrier measurements. The client-facing
Cloudflare request showed AMS, while the native connector connected to LAX.
This is an observed route, not a routing or performance guarantee.

Removing the proxy did not demonstrate a latency improvement in this small
sample. Its verified benefit is eliminating the proxy hop/dependency. IPv6-first
routing remains useful. No nationwide, evening, or large-file test was performed.

[Sanitized raw samples](tunnel-native-2026-11-01.json).

References: [Cloudflare connector destinations](https://developers.cloudflare.com/tunnel/configuration/),
[Mihomo TUN exclusions](https://wiki.metacubex.one/en/config/inbound/tun/),
[routing rules](https://wiki.metacubex.one/en/config/rules/).
