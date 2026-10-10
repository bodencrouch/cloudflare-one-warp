# WARP internals

How Cloudflare WARP behaves on the host and how Cloudflare One WARP maps it. Full maintainer notes also live in the repository as [WARP_INTERNALS.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/WARP_INTERNALS.md).

## Components on your machine

| Piece | What it does |
|-------|----------------|
| **warp-svc** | Cloudflare system daemon |
| **warp-cli** | CLI that Cloudflare One WARP executes (guarded) |
| **CloudflareWARP** | Tunnel interface in full-tunnel modes |
| **127.0.0.1:40000** | Default local proxy listen in proxy mode |

Cloudflare One WARP adds a Node HTTP API, optional Web UI, PyQt6 tray, and optional NetworkManager companion profiles. It does **not** bundle or replace `warp-svc`.

## Mode strings matter

`warp-cli settings list` uses display labels, not always the slug you pass to `warp-cli mode`:

| Command | Typical settings line | UI slug |
|---------|----------------------|---------|
| `mode warp` | `Mode: Warp` | `warp` |
| `mode proxy` | **`Mode: WarpProxy on port 40000`** | `proxy` |
| `mode doh` | `Mode: DnsOverHttps` | `doh` |

Cloudflare One WARP normalizes these in `lib/warp/settings.mjs`. If app routing stays on “Not set up yet” after enabling, the Mode line is the first thing to inspect in `/api/snapshot`.

## Local proxy / app routing

Proxy mode only tunnels apps that use the local SOCKS/HTTP proxy:

```bash
warp-cli mode proxy
warp-cli proxy port 40000   # default
```

Cloudflare One WARP’s **Turn on app routing** runs MASQUE + proxy mode, then offers desktop shortcuts so you do not configure each app by hand.

- MASQUE is required for proxy mode (not WireGuard).
- UDP is not carried in WARP proxy mode.
- See [App routing guide](/guides/routing).

## Split tunnel vs app routing

| Mechanism | Scope |
|-----------|--------|
| **Split tunnel** (IP/host lists) | System routing — exclude or include CIDRs and domains |
| **App routing** (local proxy) | Per-app — only shortcuts launched through the proxy |

Both appear on the Split Tunnel page; they solve different problems.

## Reference: warp-docker

The [warp-docker](https://github.com/cmj2002/warp-docker) project documents running WARP in containers (GOST front-end, `NET_ADMIN`, persistent `/var/lib/cloudflare-warp`). Useful background for MASQUE and proxy chaining — Cloudflare One WARP on a desktop uses host `warp-cli` directly instead.

## Cloudflare One WARP command map

| User action | warp-cli / API |
|-------------|----------------|
| Connect | `POST /api/action` `{ "action": "connect" }` |
| App routing | `enableLocalProxy` → MASQUE + `mode proxy` |
| Split IP | `tunnel ip add` via `/api/action` |
| Kill switch | nftables via polkit (not warp-cli) |

When Cloudflare changes CLI output, update `normalizeOperatingMode` and Plane M tests — see [Contributing](/contributing/).
