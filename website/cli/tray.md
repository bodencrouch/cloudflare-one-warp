# Tray CLI

Starts the selected desktop app: **Cloudflare One Client** (default, from the host WARP package) or **Cloudflare One WARP** (PyQt6 tray).

## Usage

```
cloudflare-one-warp-tray                 Start the selected desktop app
cloudflare-one-warp-tray --force-cloudflare-one-warp
                                    Start the Cloudflare One WARP tray, this session only
cloudflare-one-warp-tray --panel         Show Cloudflare One WARP window (starts tray if needed)
cloudflare-one-warp-tray --settings      Open Cloudflare One WARP preferences
cloudflare-one-warp-tray --stop          Stop the active desktop app
cloudflare-one-warp-tray --check         Readiness (exit 0 when OK)
cloudflare-one-warp-tray --status        WARP status + notification when available
cloudflare-one-warp-tray --help          Show help
```

`cloudflare-one-warp` with no flags starts the selected desktop app. `cloudflare-one-warp --tray` starts the Cloudflare One WARP tray.

`--force-cloudflare-one-warp` does not change your saved choice. It stops the Cloudflare One Client tray icon and leaves `warp-desktop-svc` running, so Cloudflare One Client comes back at next login — or right away with `cloudflare-one-warp-tray`. If the Cloudflare One WARP tray fails to start, the Cloudflare tray icon is restored.

## KDE / Wayland (Cloudflare One WARP tray)

Uses **StatusNotifierItem** (not legacy XEmbed). Requires:

```bash
pip install PyQt6 PyQt6-WebEngine
cloudflare-one-warp-tray --check
```

## Tooltip

When the Cloudflare One WARP tray is running, a multi-line tooltip shows connection state, mode, and account hints — updated on poll from the daemon API.

## API-only vs desktop app

| Mode | Command |
|------|---------|
| Selected desktop app | `cloudflare-one-warp` |
| Cloudflare One WARP tray | `cloudflare-one-warp --tray` |
| Daemon only | `cloudflare-one-warp --no-open` |
| Show panel | `cloudflare-one-warp --panel` |

Stopping the daemon does not always stop the tray — use `cloudflare-one-warp-tray --stop`.
