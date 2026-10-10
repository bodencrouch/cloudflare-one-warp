# Verify install

After install or reinstall, run the verify script from a checkout:

```bash
npm run verify:install
```

Or directly:

```bash
./scripts/verify-local-install.sh
```

## What it checks

1. Installed tree exists under `~/.local/share/cloudflare-one-warp`
2. `cloudflare-one-warp --version` succeeds
3. Daemon starts with **Web UI enabled** (`CLOUDFLARE_ONE_WARP_WEBUI=1`) for health check
4. `GET /api/health` returns OK
5. Stops the test daemon cleanly

## Tray check

```bash
cloudflare-one-warp-tray --check
```

Exit `0` when PyQt6 tray dependencies are importable and the StatusNotifier path is viable on your session.

## Common fixes

| Symptom | Fix |
|---------|-----|
| 503 on health | Daemon started without Web UI; use `npm run dev` or set `CLOUDFLARE_ONE_WARP_WEBUI=1` |
| Stale UI / log dock | Purge reinstall; service worker cache bumps on release |
| Tray missing on KDE | Install PyQt6-WebEngine; log out/in after first install |
