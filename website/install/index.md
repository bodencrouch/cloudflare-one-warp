# Install

Cloudflare One WARP wraps the host **warp-cli** binary. Install Cloudflare WARP first, then Cloudflare One WARP.

## Requirements

- **Node.js** 18+ (20 recommended)
- **warp-cli** from [Cloudflare WARP](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/)
- **Linux** for tray, kill switch, and NetworkManager helpers (macOS/Windows: daemon + Web UI)
- **PyQt6** + **PyQt6-WebEngine** for the native KDE tray (`pip install PyQt6 PyQt6-WebEngine`)

## Choose a path

| Path | Best for |
|------|----------|
| [Quick install](/install/quick) | Clone repo and run `./cloudflare-one-warp install` |
| [User install](/install/local) | Idempotent install to `~/.local/share/cloudflare-one-warp` |
| [Distribution channels](/install/channels) | AppImage, deb, Flatpak, Snap, Homebrew |
| [Verify install](/install/verify) | Smoke script after reinstall |

## After install

```bash
cloudflare-one-warp              # tray + native panel (default)
cloudflare-one-warp --no-open    # daemon only, no browser/shell
cloudflare-one-warp --status     # is the daemon running?
```

User-facing product name is always **Cloudflare One WARP** (not bare "Cloudflare One WARP").
