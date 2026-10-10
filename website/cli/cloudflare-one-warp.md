# cloudflare-one-warp

Primary launcher for Cloudflare One WARP.

## Usage

```
cloudflare-one-warp                    Start native tray + app shell
cloudflare-one-warp --no-open          Start/reuse API daemon (no shell)
cloudflare-one-warp --status           Print daemon status
cloudflare-one-warp --stop             Stop managed daemon
cloudflare-one-warp --version          Print version
cloudflare-one-warp --help             Show help
```

## WARP actions

```
cloudflare-one-warp --connect            warp-cli connect + open UI
cloudflare-one-warp --disconnect         warp-cli disconnect + open UI
cloudflare-one-warp --toggle             Connect if down, else disconnect
cloudflare-one-warp --warp-status        Print warp-cli status
cloudflare-one-warp --warp-action <act>  Connect/disconnect via API (no browser)
```

## Native shell

```
cloudflare-one-warp --tray               Start tray (same as default)
cloudflare-one-warp --panel              Show native app window
```

On KDE Plasma / Wayland, left-click the tray icon opens the PyQt6 panel with the full Web UI.

## Examples

```bash
# Headless automation host
cloudflare-one-warp --no-open
curl -s http://127.0.0.1:4173/api/snapshot | jq '.status'

# Quick connect from terminal
cloudflare-one-warp --connect

# Check daemon
cloudflare-one-warp --status
cloudflare-one-warp --stop
```

## Aliases

- `cloudflare-one-warp` (when invoked as GUI launcher from some installs)
- `cloudflare-one-warp-gui`
