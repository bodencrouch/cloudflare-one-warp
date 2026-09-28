# Tray CLI

Starts the selected desktop app: **Cloudflare One Client** (default, from the host WARP package) or **ThirdFlare One** (PyQt6 tray).

## Usage

```
thirdflare-one-tray                 Start the selected desktop app
thirdflare-one-tray --force-thirdflare
                                    Start the ThirdFlare One tray, this session only
thirdflare-one-tray --panel         Show ThirdFlare One window (starts tray if needed)
thirdflare-one-tray --settings      Open ThirdFlare One preferences
thirdflare-one-tray --stop          Stop the active desktop app
thirdflare-one-tray --check         Readiness (exit 0 when OK)
thirdflare-one-tray --status        WARP status + notification when available
thirdflare-one-tray --help          Show help
```

`thirdflare` with no flags starts the selected desktop app. `thirdflare --tray` starts the ThirdFlare One tray.

`--force-thirdflare` does not change your saved choice. It stops the Cloudflare One Client tray icon and leaves `warp-desktop-svc` running, so Cloudflare One Client comes back at next login — or right away with `thirdflare-one-tray`. If the ThirdFlare One tray fails to start, the Cloudflare tray icon is restored.

## KDE / Wayland (ThirdFlare One tray)

Uses **StatusNotifierItem** (not legacy XEmbed). Requires:

```bash
pip install PyQt6 PyQt6-WebEngine
thirdflare-one-tray --check
```

## Tooltip

When the ThirdFlare One tray is running, a multi-line tooltip shows connection state, mode, and account hints — updated on poll from the daemon API.

## API-only vs desktop app

| Mode | Command |
|------|---------|
| Selected desktop app | `thirdflare` |
| ThirdFlare One tray | `thirdflare --tray` |
| Daemon only | `thirdflare --no-open` |
| Show panel | `thirdflare --panel` |

Stopping the daemon does not always stop the tray — use `thirdflare-one-tray --stop`.
