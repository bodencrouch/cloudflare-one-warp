# Configuration

Cloudflare One WARP uses layered configuration so operators can manage the daemon idiomatically on each platform while still allowing provisional overrides from the app.

## Precedence (low → high)

| Layer | Location | Typical use |
|-------|----------|-------------|
| 1. Defaults | in `lib/config.mjs` | Safe localhost-only baseline |
| 2. System JSON | `/etc/cloudflare-one-warp/config.json` | Fleet / machine policy |
| 3. Environment file | `/etc/default/cloudflare-one-warp` | Debian/RHEL-style `KEY=value` for systemd |
| 4. User JSON | `~/.config/cloudflare-one-warp/config.json` | Per-user preferences |
| 5. Prior install path | `~/.config/cloudflare-one-gui/config.json` | Migrated automatically if present |
| 6. Environment | `CLOUDFLARE_ONE_WARP_*`, `WARP_CLI`, `PORT` | Containers, CI, drop-ins |
| 7. Session | `POST /api/config/session` | In-app toggles until restart |

Higher layers win on conflicting keys.

## Config file schema

Copy the example:

```bash
sudo install -d /etc/cloudflare-one-warp
sudo cp config/config.example.json /etc/cloudflare-one-warp/config.json
sudo cp packaging/cloudflare-one-warp.default /etc/default/cloudflare-one-warp
```

### `server`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `port` | number | `4173` | HTTP listen port |
| `bind` | string | `127.0.0.1` | Bind address when remote Web UI is off |

### `webui`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Serve static Web UI and PWA assets |
| `allowRemote` | boolean | `false` | When enabled, bind `0.0.0.0` for LAN access |

**Defaults:** systemd daemon runs with Web UI **off** (`CLOUDFLARE_ONE_WARP_WEBUI=0`). The native tray and `cloudflare-one-warp --daemon` start with Web UI **on** (`CLOUDFLARE_ONE_WARP_WEBUI=1`). When enabled, the daemon always serves static assets — there is no runtime disable toggle.

**Configure on KDE Plasma:** `cloudflare-one-warp-tray --settings` or **Cloudflare One WARP Settings** in the app launcher (Settings category).

### `warp`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cli` | string | `warp-cli` | Path or name of the WARP CLI binary |
| `killSwitch` | boolean | `false` | Apply Cloudflare One WARP nftables kill switch on startup / via API. **Persisted** to `~/.config/cloudflare-one-warp/config.json` after a successful `POST /api/killswitch` |
| `killSwitchAllowLan` | boolean | `false` | When kill switch is on, also allow RFC1918 / ULA LAN destinations (persisted with `killSwitch`) |

Flatpak builds call `flatpak-spawn --host` automatically when `cli` is `warp-cli`.

**Kill switch:** Linux `warp-cli` has no public Always On toggle. Cloudflare One WARP installs table `inet cloudflare_one_warp_killswitch` (via `nft` or `pkexec cloudflare-one-warp-nft-apply`) so outbound traffic is dropped unless it uses `lo`, `CloudflareWARP`, or Cloudflare bootstrap/ingress IPs. Requires nftables and privilege to load rules. Successful toggles persist to the user config file.

Zero Trust browser/IdP enrollment cannot reach `*.cloudflareaccess.com` / corporate IdPs while the filter is active. Cloudflare One WARP **pauses** the kill switch (removes rules, does not clear persisted desired) when you open the Access portal, run `registerOrganization`, or submit a `registrationToken`. Completing a registration token restores the kill switch; otherwise it auto-resumes after 30 minutes. `POST /api/killswitch/enrollment-pause` with `{ "mode": "begin" | "end" }` controls this explicitly.

### `ui`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `openBrowser` | boolean | `true` | Launcher opens a browser when starting GUI |
| `theme` | string | `system` | Reserved for future theme sync |
| `locale` | string | `en` | UI locale (`public/locales/<locale>.json`) |
| `notifications` | boolean | `true` | Desktop notifications on WARP connect/disconnect (requires `notify-send`). Cloudflare One Client posts its own, so the daemon stays quiet while `tray.shell` is `cloudflare` |

### `updates`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `channel` | string | `stable` | `stable` or `beta` (prereleases) |
| `source.owner` / `source.repo` | string | upstream GitHub repo | Release/fork source for updates |
| `checkOnStartup` | boolean | `true` | Non-blocking update toast when Web UI is open |

See [UPDATES.md](UPDATES.md) for the release → client pipeline.

### `tray`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `shell` | string | `cloudflare` | Desktop app in the system tray: `cloudflare` (Cloudflare One Client from the host WARP package) or `cloudflare-one-warp` (Cloudflare One WARP tray). **Persisted** via `POST /api/config/tray-shell`, install `--shell`, or App → Settings |
| `autostart` | boolean | `false` | When `shell` is `cloudflare-one-warp`, write `~/.config/autostart/cloudflare-one-warp-tray.desktop` so that tray starts at login (Linux). The value is a remembered preference: it survives a switch to Cloudflare One Client and back, and the entry is only written while `shell` is `cloudflare-one-warp`, so the two trays never fight at login. **Persisted** via `POST /api/config/tray-autostart`, whose response reports `active` and `effective` |

## Environment variables

| Variable | Maps to | Example |
|----------|---------|---------|
| `CLOUDFLARE_ONE_WARP_PORT` | `server.port` | `4173` |
| `CLOUDFLARE_ONE_WARP_BIND` | `server.bind` | `127.0.0.1` |
| `CLOUDFLARE_ONE_WARP_WEBUI` | `webui.enabled` | `1` / `0` |
| `CLOUDFLARE_ONE_WARP_WEBUI_ALLOW_REMOTE` | `webui.allowRemote` | `1` / `0` |
| `CLOUDFLARE_ONE_WARP_WARP_CLI` | `warp.cli` | `/usr/bin/warp-cli` |
| `WARP_CLI` | `warp.cli` | CI mock scripts |
| `CLOUDFLARE_ONE_WARP_LOCALE` | `ui.locale` | `en` |
| `CLOUDFLARE_ONE_WARP_NOTIFICATIONS` | `ui.notifications` | `1` / `0` |
| `CLOUDFLARE_ONE_WARP_DISABLE_NOTIFICATIONS` | (runtime) | `1` skips notify-send even if enabled |
| `CLOUDFLARE_ONE_WARP_UPDATE_CHANNEL` | `updates.channel` | `stable` / `beta` |
| `CLOUDFLARE_ONE_WARP_UPDATE_SOURCE` | `updates.source` | `owner/repo` |
| `CLOUDFLARE_ONE_WARP_UPDATE_CHECK` | `updates.checkOnStartup` | `0` to disable |
| `CLOUDFLARE_ONE_WARP_INSTALL_FORMAT` | install detection | `appimage` / `deb` / … |
| `CLOUDFLARE_ONE_WARP_APPIMAGE_PATH` | AppImage replace target | `/path/to/app.AppImage` |
| `CLOUDFLARE_ONE_WARP_GITHUB_TOKEN` | GitHub API auth | PAT for higher rate limits |

Legacy `CLOUDFLARE_ONE_GUI_PORT` and `CLOUDFLARE_ONE_GUI_NODE` remain supported for migration.

## systemd

### User service (recommended for desktops)

```bash
npm run install:service
systemctl --user enable --now cloudflare-one-warp.service
systemctl --user status cloudflare-one-warp
```

Packaged path: `/usr/lib/systemd/user/cloudflare-one-warp.service`

The unit loads:

```ini
EnvironmentFile=-/etc/default/cloudflare-one-warp
Environment=CLOUDFLARE_ONE_WARP_WEBUI=0
```

### Drop-in override (idiomatic)

```bash
systemctl --user edit cloudflare-one-warp
```

Example drop-in:

```ini
[Service]
Environment=CLOUDFLARE_ONE_WARP_PORT=5000
Environment=CLOUDFLARE_ONE_WARP_WEBUI=1
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user restart cloudflare-one-warp
```

### System-wide (optional)

For shared machines, install unit files under `/etc/systemd/system/` and point `WorkingDirectory=/usr/lib/cloudflare-one-warp`. Prefer `/etc/cloudflare-one-warp/config.json` for policy so unprivileged users cannot override fleet settings without sudo.

## Local session credential

Reading state is open to anything on this computer, but **changing** state requires a credential so a web page you visit cannot drive WARP behind your back. Each daemon mints one at startup and writes it to a private file:

```
~/.config/cloudflare-one-warp/session-<port>.token   # mode 0600, removed on shutdown
```

The Web UI, tray, and settings dialog handle this for you. For scripts, send it as `x-cloudflare-one-warp-session` on every `POST`:

```bash
SESSION=$(cat ~/.config/cloudflare-one-warp/session-4173.token)
```

Requests that change something must also come from this computer, be addressed to `127.0.0.1` / `localhost`, and send `content-type: application/json`. Anything else is refused with `403` (or `415` for a non-JSON body) and logged in the Console tab. Setting `webui.allowRemote` or a `0.0.0.0` bind still only exposes read-only endpoints to the LAN.

## In-app session overrides

Inspect effective config:

```bash
curl -s http://127.0.0.1:4173/api/config | jq
```

Apply provisional overrides (lost on daemon restart unless written to disk separately).

Session may set `ui.locale` / `ui.theme` / `ui.openBrowser` / `ui.notifications` and `updates.channel` / `updates.checkOnStartup` via `/api/config/session`.
`updates.source` may only change through `POST /api/update/source`, which accepts the pinned upstream or one of its GitHub forks.
`warp.killSwitch` / `warp.killSwitchAllowLan` are written to the **user** config file by `POST /api/killswitch` after nftables apply succeeds (not via `/api/config/session`). Failed applies do not change the file. Fleet policy in `/etc/cloudflare-one-warp/config.json` still loads first, but a later user file value for the same keys wins under normal precedence — treat UI toggles as per-user.
`warp.cli`, `server.*`, and `webui.*` are **not** session-overridable.

```bash
curl -s -X POST http://127.0.0.1:4173/api/config/session \
  -H 'content-type: application/json' \
  -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"config":{"updates":{"channel":"beta"}}}'
```

Clear session overrides:

```bash
curl -s -X POST http://127.0.0.1:4173/api/config/session \
  -H 'content-type: application/json' \
  -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"clear":true}'
```

**Restart required** after changing `server.port`, `server.bind`, `webui.enabled`, or `webui.allowRemote`.

Persist Web UI, server, UI notifications, desktop app, and tray autostart:

```bash
curl -s -X POST http://127.0.0.1:4173/api/config/webui \
  -H 'content-type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" -d '{"enabled":true}'

curl -s -X POST http://127.0.0.1:4173/api/config/server \
  -H 'content-type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" -d '{"port":4173}'

curl -s -X POST http://127.0.0.1:4173/api/config/ui \
  -H 'content-type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" -d '{"notifications":true}'

curl -s -X POST http://127.0.0.1:4173/api/config/tray-shell \
  -H 'content-type: application/json' -d '{"shell":"cloudflare"}'

curl -s -X POST http://127.0.0.1:4173/api/config/tray-autostart \
  -H 'content-type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" -d '{"autostart":true}'
```

## Platform notes

| OS | Idiomatic config |
|----|------------------|
| Linux (deb/rpm) | `/etc/default/cloudflare-one-warp` + `/etc/cloudflare-one-warp/config.json` |
| Linux (user) | `~/.config/cloudflare-one-warp/config.json` + user systemd |
| macOS (Homebrew) | `~/.config/cloudflare-one-warp/config.json` + `launchctl`/`brew services` (future) |
| Container | `CLOUDFLARE_ONE_WARP_*` env vars on `docker run` |

## WARP / Cloudflare One settings

Cloudflare One WARP does **not** replace Cloudflare account policy or MDM. Device modes, split tunnels, Gateway IDs, and registration are still applied through `warp-cli` exactly as on Windows — Cloudflare One WARP is a drop-in UI and automation layer, not a separate VPN implementation.
