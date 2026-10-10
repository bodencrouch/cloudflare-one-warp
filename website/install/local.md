# User install

The operator command `./cloudflare-one-warp install` is idempotent. Re-running updates the staged tree and refreshes symlinks.

## Layout

| Path | Contents |
|------|----------|
| `~/.local/share/cloudflare-one-warp/` | Application tree (server, public, lib, bin) |
| `~/.local/bin/cloudflare-one-warp` | Launcher symlink |
| `~/.local/bin/cloudflare-one-warp` | Operator symlink |
| `~/.local/bin/cloudflare-one-warp-tray` | Tray binary |
| `~/.config/cloudflare-one-warp/` | User config (optional) |
| `~/.local/share/applications/cloudflare-one-warp.desktop` | Desktop entry |

## Options

```bash
./cloudflare-one-warp install              # user install
./cloudflare-one-warp install --service    # also install systemd user unit (Linux)
./cloudflare-one-warp uninstall            # remove symlinks and desktop file
./cloudflare-one-warp uninstall --purge    # also remove install tree and config
```

## systemd user daemon

With `--service`, a user unit starts the daemon at login (API-only by default). Enable Web UI in config or environment if needed.

```bash
systemctl --user enable --now cloudflare-one-warp.service
systemctl --user status cloudflare-one-warp.service
```

## Important

The **tray reads the installed tree**, not your git workspace. After changing code in a checkout, reinstall or run from `./bin/cloudflare-one-warp` in the repo for development.
