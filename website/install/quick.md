# Quick install

From a git checkout:

```bash
./cloudflare-one-warp install
```

This runs `scripts/install-local.sh` and installs to `~/.local/share/cloudflare-one-warp`, symlinks `cloudflare-one-warp` / `cloudflare-one-warp` into `~/.local/bin`, and adds a `.desktop` entry.

Ensure `~/.local/bin` is on your `PATH`, then:

```bash
cloudflare-one-warp --version
cloudflare-one-warp --check   # tray readiness (PyQt6)
cloudflare-one-warp
```

## Development without install

```bash
npm install
npm run dev          # CLOUDFLARE_ONE_WARP_WEBUI=1, hot daemon from repo root
./bin/cloudflare-one-warp --no-open
```

Open `http://127.0.0.1:4173` when Web UI is enabled.

## Reinstall / purge

To reset WebEngine cache and stale daemon state:

```bash
./cloudflare-one-warp uninstall --purge
./cloudflare-one-warp install
npm run verify:install
```

See [Verify install](/install/verify) for what the verify script checks.
