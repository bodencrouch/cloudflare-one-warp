---
layout: home

hero:
  name: ThirdFlare One
  text: Your warp-cli control plane
  tagline: Unofficial Cloudflare One client for Linux, macOS, and headless setups. Install once, connect from the tray or terminal, route specific apps through WARP, and script everything over a guarded local API — without replacing Cloudflare's daemon.
  image:
    src: /logo.svg
    alt: ThirdFlare One
  actions:
    - theme: brand
      text: Install in 2 minutes
      link: /install/quick
    - theme: alt
      text: App routing guide
      link: /guides/routing
    - theme: alt
      text: API cookbook
      link: /api/cookbook

features:
  - icon: ⌨️
    title: CLI-first workflow
    details: thirdflare for daily connect/disconnect and tray control. thirdflare-one to install, package, and run the full test suite from your checkout.
  - icon: 🎯
    title: App routing
    details: Turn on local proxy mode, pick apps from a dropdown, and get WARP shortcuts in your app menu — no manual SOCKS settings per application.
  - icon: 🔌
    title: Guarded HTTP API
    details: GET /api/snapshot for status and settings. POST /api/action for approved warp-cli mutations only. Secrets redacted in every response.
  - icon: 🎛️
    title: Simple and expert UI
    details: Native shell opens a connect-focused layout. Expert mode adds split tunnel, Gateway DNS, kill switch, diagnostics, and a live warp-cli console.
  - icon: 🖥️
    title: PyQt6 tray on Linux
    details: StatusNotifierItem on KDE Plasma embeds the full Web UI. thirdflare --no-open runs API-only when you do not need the panel.
  - icon: 🔒
    title: Always On (opt-in)
    details: nftables kill switch blocks leaks if WARP drops. Off by default; enable from Settings when you want Windows-style Always On on Linux.
---

::: info Before you start
Install [Cloudflare WARP](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/) and register with **warp-cli**. ThirdFlare One wraps that install — it is **not affiliated with Cloudflare**.
:::

## Install and launch

```bash
git clone https://github.com/bodencrouch/thirdflare-one.git
cd thirdflare-one
./thirdflare-one install
thirdflare --version   # 0.2.7+
thirdflare             # tray + native panel on Linux
```

User install path: `~/.local/share/thirdflare-one` · CLI symlinks in `~/.local/bin`

Verify after reinstall:

```bash
npm run verify:install
```

## App routing in three steps

The Split Tunnel page includes an **App routing** panel:

1. **Turn on app routing** — sets MASQUE + local proxy mode (`enableLocalProxy`).
2. **Choose an app** — dropdown of `.desktop` entries on your system.
3. **Create WARP shortcut** — launches that app through `127.0.0.1:40000`.

```bash
# Same flow from the API
SESSION=$(cat ~/.config/thirdflare/session-4173.token)
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"action":"enableLocalProxy"}'
curl -s http://127.0.0.1:4173/api/apps | jq
```

Real warp-cli reports proxy mode as `Mode: WarpProxy on port 40000` — ThirdFlare normalizes that for the UI. See [WARP internals](/guides/warp-internals).

## API-only and automation

```bash
thirdflare --no-open
curl -s http://127.0.0.1:4173/api/health | jq
curl -s http://127.0.0.1:4173/api/snapshot | jq '.status, .settings.Mode'
```

Default HTTP port is **4173** (launcher tries up to 30 ports if busy). Confirm with `thirdflare --status` or `GET /api/config`.

## Pick your surface

| Goal | Entry |
|------|--------|
| Daily desktop (KDE) | `thirdflare` → left-click tray |
| Browser UI | `THIRDFLARE_WEBUI=1` or enable in Settings → `http://127.0.0.1:4173` |
| Scripts / CI | [API cookbook](/api/cookbook) |
| Packages | `./thirdflare-one build appimage` |
| Plasma network list | [NetworkManager profiles](/guides/networkmanager) |

Web UI is **off by default** in the systemd user unit.

## What ships in 0.2.7

- Guarded warp-cli bridge (`/api/snapshot`, `/api/action`)
- Account / Zero Trust registration UI (`/api/account`)
- Split tunnel guides, route lists, and **app routing shortcuts**
- Expert log dock with warp-cli command history (`/api/logs`)
- Kill switch with polkit helper (opt-in)
- Client updates (stable/beta) from GitHub releases
- AppImage, deb, rpm, Flatpak, Snap, Homebrew tap

## Documentation map

- [First connection](/guides/first-connection) — register and connect
- [CLI reference](/cli/thirdflare) — flags and examples
- [Configuration](/configuration/) — layered config and env vars
- [WARP internals](/guides/warp-internals) — modes, MASQUE, proxy port
- [Troubleshooting](/troubleshooting/) — tray, stale UI, ports, polkit
