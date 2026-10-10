# CLI overview

Cloudflare One WARP exposes three CLI layers — similar to how [Cursor CLI](https://cursor.com/docs/cli/overview) separates agent commands from install tooling, and [Render CLI](https://render.com/docs/cli) focuses on daily operations.

| Command | Role |
|---------|------|
| `cloudflare-one-warp` | Daily driver — selected desktop app, WARP toggle, daemon |
| `cloudflare-one-warp` | Operator — install, build, test, dev |
| `cloudflare-one-warp-tray` | Desktop app helper (Cloudflare One Client or PyQt6 tray) |

Aliases: `cloudflare-one-warp-gui` → same as `cloudflare-one-warp`.

## Default behavior

Running `cloudflare-one-warp` with no flags starts the **selected desktop app** (Cloudflare One Client by default). Pass `--tray` for the Cloudflare One WARP tray, or `--no-open` for API-only daemon mode.

## Environment

| Variable | Effect |
|----------|--------|
| `CLOUDFLARE_ONE_WARP_WEBUI=1` | Serve static Web UI from daemon |
| `CLOUDFLARE_ONE_WARP_PORT` | HTTP port (default `4173`; launcher scans +30 if busy) |
| `CLOUDFLARE_ONE_WARP_WARP_CLI` | Path to warp-cli binary |
| `CLOUDFLARE_ONE_WARP_CONFIG` | Override config file path |

Full list: [Configuration → Environment](/configuration/env).

## Next steps

- [cloudflare-one-warp reference](/cli/cloudflare-one-warp)
- [cloudflare-one-warp operator](/cli/operator)
- [Tray](/cli/tray)
- [Helper scripts](/cli/helpers)
