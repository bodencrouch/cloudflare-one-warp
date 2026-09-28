# Desktop app and tray

ThirdFlare One can use **Cloudflare One Client** (the tray that comes with WARP) or **ThirdFlare One** (this project’s PyQt6 tray with the Web UI embedded). Default is Cloudflare One Client. Only one tray runs at a time.

## Choose the desktop app

Settings → **Desktop app**, or at install:

```bash
./thirdflare-one install --shell cloudflare   # default
./thirdflare-one install --shell thirdflare
```

## Start

```bash
thirdflare                    # selected desktop app
thirdflare --tray             # ThirdFlare One tray
thirdflare-one-tray --check
```

When ThirdFlare One is selected, left-click the tray icon opens the control panel.

## vs API-only

| | Cloudflare One Client | ThirdFlare One tray | `--no-open` |
|---|---|---|---|
| Tray | Cloudflare One Client | ThirdFlare One | None |
| Web UI | Off until you turn it on | Embedded in the tray | Optional browser |
| Notifications | Cloudflare One Client | ThirdFlare One + libnotify | API only |
| ThirdFlare daemon | API only | Web UI enabled | API only |
| Use case | Desktop daily driver | Full ThirdFlare UI | Automation, servers |

The daemon keeps running behind Cloudflare One Client, so the kill switch and NetworkManager profiles stay available. It stays quiet on notifications while that tray is active, so a single connect does not notify twice.

## Stop

```bash
thirdflare-one-tray --stop
thirdflare --stop    # daemon (tray may need a separate stop)
```

`--stop` on the tray command stops the **active** desktop app (including Cloudflare One Client when that is selected). Uninstall does not remove WARP.

## Packaging note

ThirdFlare One launches the host WARP desktop app; it does not bundle it. PyQt6 is a runtime dependency only when you use the ThirdFlare One tray.

`warp-desktop-svc` runs from the systemd user unit in the WARP package. When that package ships no unit, ThirdFlare One writes `~/.config/systemd/user/thirdflare-warp-desktop-svc.service` and enables that instead. Under Flatpak both binaries run on the host through `flatpak-spawn --host`.
