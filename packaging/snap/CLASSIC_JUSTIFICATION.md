# Classic confinement justification — cloudflare-one-warp

**Snap name:** `cloudflare-one-warp`
**Confinement:** classic

## Why classic is required

Cloudflare One WARP is a **control plane** for the host Cloudflare WARP client. It must:

1. Execute **`warp-cli`** on the host filesystem (not inside the snap sandbox)
2. Communicate with the **CloudflareWARP** system daemon
3. Read/write runtime state under user XDG paths (`XDG_RUNTIME_DIR`, cache) consistent with the official WARP workflow

Strict confinement prevents reliable access to the host `warp-cli` binary and WARP UNIX sockets. The application does not implement its own VPN tunnel — it orchestrates the existing official WARP install.

## Security model

- Binds HTTP API to `127.0.0.1` by default
- Does not bundle or replace Cloudflare WARP
- Invokes `warp-cli` via argument allow-lists (no shell)

## User documentation

Install Cloudflare WARP before using Cloudflare One WARP:

https://developers.cloudflare.com/warp-client/get-started/linux/
