# Getting started with Cloudflare One WARP

Cloudflare One WARP is an unofficial desktop client for [Cloudflare One / WARP](https://developers.cloudflare.com/cloudflare-one/). It wraps your existing **`warp-cli`** install with a local HTTP API and an optional browser UI — the experience Windows users get from the official app, on Linux, macOS, and headless setups.

> **Not affiliated with Cloudflare.** You must install Cloudflare’s WARP client separately. Cloudflare One WARP does not replace the WARP daemon.

## What you need

| Requirement | Why |
|-------------|-----|
| [Cloudflare WARP](https://developers.cloudflare.com/warp-client/get-started/linux/) with `warp-cli` on `PATH` | Cloudflare One WARP controls WARP; it does not bundle it |
| **Node.js 20+** (host or bundled) | Runs the HTTP daemon. AppImage bundles Node; deb/rpm use system Node |
| A browser (optional) | For the Web UI when enabled. Firefox is preferred on Linux |

Check WARP:

```bash
warp-cli --version
warp-cli status
```

---

## Choose how to install

There are three common paths. Pick one.

### 1. Prebuilt release (recommended for most users)

Download an artifact from [GitHub Releases](https://github.com/bodencrouch/cloudflare-one-warp/releases):

| Format | Best for |
|--------|----------|
| **AppImage** | Portable Linux x86_64 — no system Node required |
| **.deb / .rpm / Arch** | System package managers — uses host `nodejs >= 20` |
| **Flatpak / Snap** | Sandboxed Linux installs (classic Snap; Flatpak calls host `warp-cli`) |
| **Homebrew** (macOS) | `brew tap` + `brew install` — see [PACKAGING.md](PACKAGING.md) |

After installing a package, launch from your app menu or run:

```bash
cloudflare-one-warp          # open Web UI
cloudflare-one-warp --no-open   # API-only daemon
```

AppImage example:

```bash
chmod +x cloudflare-one-warp-*-x86_64.AppImage
./cloudflare-one-warp-*-x86_64.AppImage
```

### 2. Local user install from a git checkout

Use this when you clone the repo and want a **stable install path** that does not break when you move the checkout.

From the repository root:

```bash
./cloudflare-one-warp install
```

This is **idempotent** — safe to run again after `git pull`. On a terminal it asks which desktop app should start at login (Cloudflare One Client by default). Non-interactive:

```bash
./cloudflare-one-warp install --shell cloudflare
./cloudflare-one-warp install --shell cloudflare-one-warp
```

**What it installs:**

| Path | Purpose |
|------|---------|
| `~/.local/share/cloudflare-one-warp/` | Application tree (synced from your checkout) |
| `~/.local/bin/cloudflare-one-warp`, `cloudflare-one-warp`, `cloudflare-one-warp-tray` | CLI commands on your `PATH` |
| `~/.local/share/applications/cloudflare-one-warp.desktop` | Application menu entry |

Optional systemd user daemon:

```bash
./cloudflare-one-warp install --service
systemctl --user enable --now cloudflare-one-warp.service
```

Override install location:

```bash
CLOUDFLARE_ONE_WARP_HOME=$HOME/apps/cloudflare-one-warp ./cloudflare-one-warp install
```

Uninstall desktop links and CLI symlinks (keep the tree):

```bash
./cloudflare-one-warp uninstall
```

Remove everything including the install tree:

```bash
./cloudflare-one-warp uninstall --purge
```

> **Tip:** Re-run `./cloudflare-one-warp install` after moving or deleting a git checkout to refresh desktop entries and CLI links.

### After pulling UI changes (local install + tray)

The KDE Plasma tray loads the Web UI from **`~/.local/share/cloudflare-one-warp`**, not your git checkout. After UI work, purge-reinstall and verify the daemon serves the new assets:

```bash
cloudflare-one-warp-tray --stop 2>/dev/null || true
./scripts/uninstall-local.sh --purge
./scripts/install-local.sh
./scripts/verify-local-install.sh
```

**Reset embedded WebEngine / UI prefs** when the tray still shows an old shell (missing log dock, stale controls):

1. Quit the tray (`cloudflare-one-warp-tray --stop`).
2. Optional Qt WebEngine cache clear: `rm -rf ~/.cache/QtWebEngine/Default/Cache*`
3. Reopen the tray and use **Reload window** from the tray menu, or hard-reload once in the panel.
4. To reset in-app layout prefs, clear these `localStorage` keys in the embedded panel (DevTools → Application): `cloudflare-one-warp-ui-expert`, `cloudflare-one-warp-log-collapsed`, `cloudflare-one-warp-log-tab`, `cloudflare-one-warp-log-height`.

Expert mode (Settings → Expert UI) shows the log dock at the bottom with **Status**, **Console**, and **Diagnostics** tabs.

### KDE / NetworkManager (WARP in system network UI)

Cloudflare One WARP installs three NetworkManager profiles — **MASQUE**, **WireGuard**, and **Local proxy** — so you can connect from KDE System Settings → Network or import them via **Import VPN connection**. Run once after install:

```bash
./scripts/cloudflare-one-warp-nm --user
./scripts/cloudflare-one-warp-nm --system   # dispatcher + sysctl (pkexec; recommended)
```

See **[NETWORKING.md](NETWORKING.md)** for Plasma widget usage, protocol choice, and limitations.

### 3. Run directly from a checkout (development)

No install step — good for hacking on the code:

```bash
git clone https://github.com/bodencrouch/cloudflare-one-warp.git
cd cloudflare-one-warp
npm install          # devDependencies only (Playwright for UI tests)

npm run dev          # server + Web UI at http://127.0.0.1:4173
# or
./bin/cloudflare-one-warp     # launcher: starts daemon, opens browser
```

Do **not** use `npm run install` from a moving checkout for menu entries — `./cloudflare-one-warp install` copies to a stable path under `~/.local/share/cloudflare-one-warp`.

---

## Daily usage

### Operator entrypoint: `cloudflare-one-warp`

The repo ships `./cloudflare-one-warp` as the single entrypoint for install, build, run, and test:

```bash
./cloudflare-one-warp help
./cloudflare-one-warp install
./cloudflare-one-warp run
./cloudflare-one-warp build appimage
./cloudflare-one-warp test all
```

After a user install, `cloudflare-one-warp` is also on your `PATH` via `~/.local/bin`.

### Launcher CLI: `cloudflare-one-warp` / `cloudflare-one-warp`

Both names run the same launcher (`bin/cloudflare-one-warp`):

```bash
cloudflare-one-warp                 # start daemon + open Web UI
cloudflare-one-warp --no-open       # start daemon, print URL (Web UI off by default)
cloudflare-one-warp --connect       # warp-cli connect + open UI
cloudflare-one-warp --disconnect
cloudflare-one-warp --toggle
cloudflare-one-warp --warp-status
cloudflare-one-warp --tray          # optional yad system tray (requires yad)
cloudflare-one-warp --status        # is the daemon healthy?
cloudflare-one-warp --stop
cloudflare-one-warp --version
```

Default URL when the daemon is running: **http://127.0.0.1:4173**

### Web UI

The Web UI is a static app served by the Node daemon when enabled.

| How | Web UI |
|-----|--------|
| `cloudflare-one-warp` (no flags) | **On** — launcher sets `CLOUDFLARE_ONE_WARP_WEBUI=1` |
| `cloudflare-one-warp --no-open` | **Off** by default |
| systemd user service | **Off** by default (API-only daemon) |
| `webui.enabled: true` in config | **On** persistently — see [CONFIGURATION.md](CONFIGURATION.md) |

Open **http://127.0.0.1:4173** when the UI is enabled.

### systemd background daemon

For an always-on API server without opening a browser:

```bash
./cloudflare-one-warp install --service
systemctl --user enable --now cloudflare-one-warp.service
systemctl --user status cloudflare-one-warp.service
```

Packaged `.deb`/`.rpm` installs also ship `/usr/lib/systemd/user/cloudflare-one-warp.service`.

To enable the Web UI on the service, edit config or use a drop-in — see [CONFIGURATION.md](CONFIGURATION.md).

### Desktop app (Cloudflare One Client or Cloudflare One WARP tray)

Linux WARP already ships **Cloudflare One Client** in the system tray. Cloudflare One WARP uses that as the default desktop app and keeps its own PyQt6 tray as the other option. Only one tray runs at a time. Switch in **Settings → Desktop app**, or at install with `--shell`.

```bash
cloudflare-one-warp                    # selected desktop app (Cloudflare One Client by default)
cloudflare-one-warp --tray             # Cloudflare One WARP tray even if Cloudflare One Client is selected
cloudflare-one-warp-tray --check   # print selected app and Cloudflare One WARP tray readiness
cloudflare-one-warp-tray --stop    # stop the active desktop app
```

**Cloudflare One WARP tray** (when selected) uses PyQt6 + WebEngine on KDE Plasma / Wayland:

```bash
# Fedora
sudo dnf install python3-pyqt6 python3-pyqt6-webengine

# Debian/Ubuntu
sudo apt install python3-pyqt6 python3-pyqt6.qtwebengine
```

**X11 fallback:** `yad` status-notifier menu when PyQt6 is unavailable.

Packaged `.deb`/`.rpm` installs ship `/usr/bin/cloudflare-one-warp-tray` and recommend PyQt6 packages.

#### What runs on the default path

Cloudflare One Client draws the tray and posts its own status notifications. Cloudflare One WARP starts its daemon in API-only mode behind it, so the kill switch and NetworkManager profiles keep working. The Cloudflare One WARP Web UI stays off until you turn it on with `cloudflare-one-warp --daemon`, `webui.enabled`, or the Cloudflare One WARP tray.

Cloudflare One WARP also starts `warp-desktop-svc`, the background service the Cloudflare tray talks to. It prefers the systemd user unit from the WARP package. When that package ships no unit, Cloudflare One WARP writes `~/.config/systemd/user/cloudflare-one-warp-desktop-svc.service` and enables that instead. Switching back to the Cloudflare One WARP tray removes it.

Under Flatpak both binaries run on the host through `flatpak-spawn --host`.

### Tray autostart (Cloudflare One WARP tray)

When the desktop app is Cloudflare One WARP, enable **Start tray at login** in Settings, or:

```json
"tray": { "shell": "cloudflare-one-warp", "autostart": true }
```

This writes `~/.config/autostart/cloudflare-one-warp-tray.desktop` and hides the WARP package’s Cloudflare One Client autostart for this user. Choosing Cloudflare One Client restores that autostart and removes the Cloudflare One WARP tray entry. Your autostart preference is remembered, so switching back to the Cloudflare One WARP tray brings it with you.

Cloudflare One WARP does not bundle Cloudflare’s desktop app — it launches the copy already installed with `warp-cli`.

### Always On (Linux kill switch)

Linux `warp-cli` has no public Always On toggle. Cloudflare One WARP installs nftables table `inet cloudflare_one_warp_killswitch` as the equivalent — toggle in **Home → Always On (kill switch)**.

**Polkit:** deb/rpm installs ship `/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy` so `pkexec cloudflare-one-warp-nft-apply` prompts once. After `./cloudflare-one-warp install`, install the policy manually if needed (see install output).

**Flatpak/Snap:** kill switch apply may require host `nft` access; see [PACKAGING.md](PACKAGING.md).

---

## Configuration (overview)

Settings merge from several layers (lowest → highest priority):

1. Built-in defaults
2. `/etc/cloudflare-one-warp/config.json`
3. `/etc/default/cloudflare-one-warp` (systemd environment file)
4. `~/.config/cloudflare-one-warp/config.json`
5. Environment variables (`CLOUDFLARE_ONE_WARP_*`)
6. In-app session overrides (until daemon restart)

Common environment variables:

| Variable | Purpose |
|----------|---------|
| `CLOUDFLARE_ONE_WARP_WEBUI=1` | Enable Web UI for this process |
| `CLOUDFLARE_ONE_WARP_PORT=4173` | HTTP port |
| `WARP_CLI=/path/to/warp-cli` | Override warp-cli binary |
| `CLOUDFLARE_ONE_WARP_CLI` | Same as `WARP_CLI` (preferred) |

Full key reference: **[CONFIGURATION.md](CONFIGURATION.md)**

Example user config:

```bash
mkdir -p ~/.config/cloudflare-one-warp
cp config/config.example.json ~/.config/cloudflare-one-warp/config.json
# edit webui.enabled, ui.notifications, killswitch, updates.channel, etc.
```

---

## Building packages locally

From a checkout, use the operator entrypoint or npm scripts:

```bash
./cloudflare-one-warp build appimage    # → dist/packages/cloudflare-one-warp-VERSION-x86_64.AppImage
./cloudflare-one-warp build deb
./cloudflare-one-warp build rpm
./cloudflare-one-warp build all         # stage + deb + rpm + appimage + source + checksums
```

Equivalent npm commands: `npm run package:appimage`, `npm run package:deb`, etc.

Details, CI release flow, Docker, and Homebrew: **[PACKAGING.md](PACKAGING.md)**

---

## Updates

In-app **Settings → Updates** checks GitHub Releases (stable/beta channels, optional forks). **AppImage** installs can auto-apply updates after confirmation. Other formats show guided install commands.

Release pipeline and manifest: **[UPDATES.md](UPDATES.md)**

---

## Troubleshooting

### Desktop entry does nothing / wrong path

Re-run the idempotent installer from any checkout:

```bash
./cloudflare-one-warp install
```

Verify the desktop file points at `~/.local/share/cloudflare-one-warp`, not an old checkout path:

```bash
grep ^Exec= ~/.local/share/applications/cloudflare-one-warp.desktop
```

### Daemon does not start

```bash
cloudflare-one-warp --status
cat ~/.cache/cloudflare-one-warp/server.log
```

Ensure Node 20+ is available (`node --version`) unless you use AppImage.

### `warp-cli` not found

Install [Cloudflare WARP for Linux](https://developers.cloudflare.com/warp-client/get-started/linux/) or set:

```bash
export WARP_CLI=/full/path/to/warp-cli
```

### Web UI blank or 404

Confirm Web UI is enabled (`CLOUDFLARE_ONE_WARP_WEBUI=1` or `webui.enabled: true`) and open **http://127.0.0.1:4173** (not https).

### Kill switch / nftables

The kill switch installs nftables rules and requires privilege (`nft` or `pkexec`). It is Linux-only. See [CONFIGURATION.md](CONFIGURATION.md) and the in-app Kill Switch page.

---

## Next steps

| Topic | Document |
|-------|----------|
| Every config key and systemd drop-in | [CONFIGURATION.md](CONFIGURATION.md) |
| API routes, security model, codebase map | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Package formats and release CI | [PACKAGING.md](PACKAGING.md) |
| Update channels and AppImage apply | [UPDATES.md](UPDATES.md) |
| Contributing code and tests | [CONTRIBUTING.md](CONTRIBUTING.md) |
