# Helper scripts

Scripts shipped under `scripts/` and `packaging/`. Invoked directly or via npm.

## Daemon & install

| Script | Purpose |
|--------|---------|
| `scripts/install-local.sh` | User install (called by `cloudflare-one-warp install`) |
| `scripts/verify-local-install.sh` | Post-install smoke |
| `scripts/daemon-ready.mjs` | Wait for `/api/health` |
| `scripts/mock-warp-cli.mjs` | Stateful mock for CI |

## NetworkManager / KDE

| Script | Purpose |
|--------|---------|
| `scripts/cloudflare-one-warp-nm` | List/import/connect NM profiles |
| `scripts/cloudflare-one-warp-connect` | Connect via NM profile name |
| `scripts/cloudflare-one-warp-kde-proxy-sync` | Sync system proxy from local proxy settings |
| `scripts/sync-nm-profiles.mjs` | Regenerate profiles from daemon config |

Example:

```bash
cloudflare-one-warp-nm list
cloudflare-one-warp-nm import masque
cloudflare-one-warp-connect masque
```

## Tray

| Script | Purpose |
|--------|---------|
| `scripts/tray-qt.py` | PyQt6 tray implementation |

## npm shortcuts

```bash
npm run verify:install
npm run sync:nm          # if defined in package.json
```

See [KDE / NetworkManager guide](/guides/networkmanager) for profile details.
