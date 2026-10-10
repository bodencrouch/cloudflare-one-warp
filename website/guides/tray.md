# Desktop app and tray

Cloudflare One WARP can use **Cloudflare One Client** (the tray that comes with WARP) or **Cloudflare One WARP** (this project’s PyQt6 tray with the Web UI embedded). Default is Cloudflare One Client. Only one tray runs at a time.

## Choose the desktop app

Settings → **Desktop app**, or at install:

```bash
./cloudflare-one-warp install --shell cloudflare   # default
./cloudflare-one-warp install --shell cloudflare-one-warp
```

## Start

```bash
cloudflare-one-warp                    # selected desktop app
cloudflare-one-warp --tray             # Cloudflare One WARP tray
cloudflare-one-warp-tray --check
```

When Cloudflare One WARP is selected, left-click the tray icon opens the control panel.

## vs API-only

| | Cloudflare One Client | Cloudflare One WARP tray | `--no-open` |
|---|---|---|---|
| Tray | Cloudflare One Client | Cloudflare One WARP | None |
| Web UI | Off until you turn it on | Embedded in the tray | Optional browser |
| Notifications | Cloudflare One Client | Cloudflare One WARP + libnotify | API only |
| Cloudflare One WARP daemon | API only | Web UI enabled | API only |
| Use case | Desktop daily driver | Full Cloudflare One WARP UI | Automation, servers |

The daemon keeps running behind Cloudflare One Client, so the kill switch and NetworkManager profiles stay available. It stays quiet on notifications while that tray is active, so a single connect does not notify twice.

## Stop

```bash
cloudflare-one-warp-tray --stop
cloudflare-one-warp --stop    # daemon (tray may need a separate stop)
```

`--stop` on the tray command stops the **active** desktop app (including Cloudflare One Client when that is selected). Uninstall does not remove WARP.

## Packaging note

Cloudflare One WARP launches the host WARP desktop app; it does not bundle it. PyQt6 is a runtime dependency only when you use the Cloudflare One WARP tray.

`warp-desktop-svc` runs from the systemd user unit in the WARP package. When that package ships no unit, Cloudflare One WARP writes `~/.config/systemd/user/cloudflare-one-warp-desktop-svc.service` and enables that instead. Under Flatpak both binaries run on the host through `flatpak-spawn --host`.
