# Web UI

The Web UI lives under `public/` and is **off by default** for systemd/API-only deployments.

## Enable

```bash
export CLOUDFLARE_ONE_WARP_WEBUI=1
cloudflare-one-warp --no-open
```

Or use `npm run dev` / `./cloudflare-one-warp dev`.

Open `http://127.0.0.1:4173`.

## Embedded in tray

On KDE, the same UI loads inside the PyQt6 WebEngine panel — no separate browser window.

## Features

- Connection toggle and status
- Settings mirror (mode, protocol, DNS, split tunnel)
- Account / registration display
- Kill switch controls
- Update check UI
- Expert log dock (Console tab) with warp-cli command log
- App routing shortcuts for local proxy
- i18n via `public/locales/`

## Service worker

Offline shell caching uses a versioned service worker. After upgrades, hard refresh or reinstall if UI appears stale.

## Scroll behavior

Polling refreshes preserve scroll position — the page should not jump to top on status updates.
