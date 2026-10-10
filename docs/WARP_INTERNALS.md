# WARP internals (reference)

Notes from [cmj2002/warp-docker](https://github.com/cmj2002/warp-docker) and live `warp-cli` on Linux. Cloudflare One WARP wraps the host install — it does not replace `warp-svc`.

## Architecture

| Component | Role |
|-----------|------|
| **warp-svc** | Cloudflare WARP system daemon |
| **warp-cli** | CLI control plane (what Cloudflare One WARP executes) |
| **CloudflareWARP** | Tunnel interface (full-tunnel modes) |
| **127.0.0.1:40000** | Default local proxy listen (proxy mode) |

Cloudflare One WARP adds a Node HTTP API, optional Web UI, PyQt6 tray, and Linux NM companion profiles. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Operating modes (warp-cli)

`warp-cli settings list` uses human-readable **Mode** lines, not always the short slug passed to `warp-cli mode <value>`:

| warp-cli command | Typical settings list value | Cloudflare One WARP UI slug |
|------------------|----------------------------|--------------------|
| `mode warp` | `Mode: Warp` / `WarpWithDnsOverHttps` | `warp` |
| `mode proxy` | **`Mode: WarpProxy on port 40000`** | `proxy` |
| `mode doh` | `Mode: DnsOverHttps` | `doh` |

Cloudflare One WARP normalizes these in `lib/warp/settings.mjs` (`normalizeOperatingMode`, `deriveProxyPort`). The Web UI must not compare raw Mode strings to `"proxy"` only.

## Tunnel protocol

Real settings use **`WARP tunnel protocol: MASQUE`** (not always `Protocol:`). MASQUE is required for local proxy mode. WireGuard is used for full-tunnel modes.

From warp-docker [masque.md](https://github.com/cmj2002/warp-docker/blob/main/docs/masque.md): MASQUE is Cloudflare’s TLS-based tunnel protocol; proxy mode expects MASQUE.

## Local proxy mode

From warp-docker [proxy-mode.md](https://github.com/cmj2002/warp-docker/blob/main/docs/proxy-mode.md):

```bash
warp-cli mode proxy
warp-cli proxy port 40000
```

- Only apps configured to use the SOCKS/HTTP proxy at `127.0.0.1:<port>` send traffic through WARP.
- **UDP is not supported** in WARP proxy mode.
- Cloudflare One WARP **app routing** enables MASQUE + proxy mode, then creates `.desktop` shortcuts that launch apps through the proxy (`lib/apps/proxy-launcher.mjs`).

## warp-docker container model

[warp-docker](https://github.com/cmj2002/warp-docker) runs official WARP inside Docker:

- **GOST** exposes `:1080` SOCKS/HTTP toward WARP’s proxy port (`127.0.0.1:40000` inside the container).
- Requires `NET_ADMIN`, `MKNOD`, tun device cgroup rules for `warp-svc`.
- Persistent state under `/var/lib/cloudflare-warp` (maps to host `./data`).
- Health check: `curl --socks5-hostname 127.0.0.1:1080 https://cloudflare.com/cdn-cgi/trace` → `warp=on` or `warp=plus`.

Useful for understanding proxy chaining; Cloudflare One WARP on a desktop talks to the host `warp-cli` directly instead.

## Split tunnel

warp-cli exposes exclude/include lists (`tunnel ip list`, `tunnel host list`, `tunnel dump`). This is **CIDR/host routing**, not per-PID app selection. Per-app routing on Linux uses **local proxy mode + app-specific shortcuts**, not warp-cli split tunnel alone.

## NetworkManager / KDE

WARP does not expose a standard WireGuard peer config like a manual VPN. Cloudflare One WARP NM profiles are **companion** connections for Plasma integration; the tunnel still comes from `warp-svc`. See [NETWORKING.md](./NETWORKING.md).

## Related warp-docker docs

| Doc | Topic |
|-----|--------|
| [zero-trust.md](https://github.com/cmj2002/warp-docker/blob/main/docs/zero-trust.md) | Zero Trust enrollment |
| [nat-gateway.md](https://github.com/cmj2002/warp-docker/blob/main/docs/nat-gateway.md) | L3 NAT through WARP (`WARP_ENABLE_NAT`) |
| [host-connectivity.md](https://github.com/cmj2002/warp-docker/blob/main/docs/host-connectivity.md) | Host connectivity fixes |
| [tun-not-permitted.md](https://github.com/cmj2002/warp-docker/blob/main/docs/tun-not-permitted.md) | TUN permission errors |

## Cloudflare One WARP mapping

| User action | warp-cli / API |
|-------------|----------------|
| Turn on app routing | `tunnel protocol set MASQUE` + `mode proxy` → `/api/action` `enableLocalProxy` |
| Connect | `connect` |
| Split tunnel IP | `tunnel ip add/remove` |
| Kill switch | nftables via polkit helper (not warp-cli) |

Keep this doc updated when warp-cli output format changes — add cases to `normalizeOperatingMode` and Plane M tests.
