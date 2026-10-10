# Cloudflare One WARP

Unofficial [Cloudflare One](https://developers.cloudflare.com/cloudflare-one/) client for Linux, macOS, and headless environments. Cloudflare One WARP wraps your existing **`warp-cli`** install with a local API and optional browser UI — functional parity with the official Windows desktop app.

> **Not affiliated with Cloudflare.** Install [Cloudflare WARP](https://developers.cloudflare.com/warp-client/get-started/linux/) separately. Cloudflare trademarks belong to Cloudflare, Inc.

**Documentation:** [bodencrouch.github.io/cloudflare-one-warp](https://bodencrouch.github.io/cloudflare-one-warp/) — install, CLI, app routing, API, and WARP internals.

## Quick start

### End users

**From a [GitHub Release](https://github.com/bodencrouch/cloudflare-one-warp/releases)** — download AppImage, `.deb`, `.rpm`, Flatpak, or Snap, then launch **Cloudflare One WARP** from your app menu or run:

```bash
cloudflare-one-warp
```

**From source** — clone, install to a stable path, launch:

```bash
git clone https://github.com/bodencrouch/cloudflare-one-warp.git
cd cloudflare-one-warp
./cloudflare-one-warp install
cloudflare-one-warp
```

Install layout: `~/.local/share/cloudflare-one-warp` · CLI on `~/.local/bin` · desktop entry `cloudflare-one-warp.desktop`

**Background daemon (optional):**

```bash
./cloudflare-one-warp install --service
systemctl --user enable --now cloudflare-one-warp.service
```

Open **http://127.0.0.1:4173** when the Web UI is enabled.

### Developers

```bash
git clone https://github.com/bodencrouch/cloudflare-one-warp.git
cd cloudflare-one-warp
npm install

export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"
npm run check
npm run test:all               # some tests require root, use sudo
npm run dev                    # Web UI at http://127.0.0.1:4173
```

Build an AppImage locally:

```bash
./cloudflare-one-warp build appimage   # → dist/packages/cloudflare-one-warp-*-x86_64.AppImage
```

Full contributor guide: **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**

## Requirements

| Component | Notes |
|-----------|--------|
| Cloudflare WARP | `warp-cli` on `PATH` — [Linux](https://developers.cloudflare.com/warp-client/get-started/linux/) · [macOS](https://developers.cloudflare.com/warp-client/get-started/macos/) |
| Node.js 20+ | Host Node for deb/rpm; bundled in AppImage / Flatpak / Snap |
| Browser | For the Web UI when enabled |

## CLI reference

| Command | Description |
|---------|-------------|
| `cloudflare-one-warp` | Start daemon and open Web UI |
| `cloudflare-one-warp --no-open` | Start API-only daemon |
| `cloudflare-one-warp --connect` | Connect WARP and open UI |
| `cloudflare-one-warp --disconnect` | Disconnect WARP |
| `cloudflare-one-warp --toggle` | Toggle WARP connection |
| `cloudflare-one-warp --status` | Daemon health |
| `cloudflare-one-warp --stop` | Stop managed daemon |
| `cloudflare-one-warp --version` | Print version |
| `cloudflare-one-warp --tray` | Optional tray menu (requires `yad`) |

`cloudflare-one-warp` and `cloudflare-one-warp-gui` are equivalent aliases.

### Operator entrypoint (from a checkout)

```bash
./cloudflare-one-warp install [options]   # idempotent user install
./cloudflare-one-warp build appimage      # build packages
./cloudflare-one-warp run [args]          # same as bin/cloudflare-one-warp
./cloudflare-one-warp test all            # run test suites
./cloudflare-one-warp help
```

## Features

- Connect/disconnect, modes, Gateway DNS, split tunnel, trusted networks, registration, diagnostics via guarded `warp-cli`
- Optional Web UI (off by default for systemd)
- Layered configuration — `/etc/cloudflare-one-warp`, user config, env vars, session overrides ([docs/CONFIGURATION.md](docs/CONFIGURATION.md))
- Linux nftables kill-switch ([docs/CONFIGURATION.md](docs/CONFIGURATION.md))
- Release updates with AppImage auto-apply ([docs/UPDATES.md](docs/UPDATES.md))
- Desktop notifications on WARP status changes

## Documentation

| Guide | Description |
|-------|-------------|
| [docs/README.md](docs/README.md) | Documentation index |
| [Getting started](docs/GETTING_STARTED.md) | Install paths, daily use, troubleshooting |
| [Contributing](docs/CONTRIBUTING.md) | Dev setup, tests, pull requests |
| [Configuration](docs/CONFIGURATION.md) | Config keys and environment variables |
| [Architecture](docs/ARCHITECTURE.md) | HTTP API and codebase overview |
| [Packaging](docs/PACKAGING.md) | Release artifacts and CI |
| [Distribution](docs/DISTRIBUTION.md) | Flathub, Snap, COPR, AUR, AppImageHub |
| [Updates](docs/UPDATES.md) | Update channels and manifest |
| [CI](docs/CI.md) | Test confidence levels |

## Distribution

Prebuilt packages: **[GitHub Releases](https://github.com/bodencrouch/cloudflare-one-warp/releases)**

```bash
# Container (API server — mount host warp-cli at runtime)
docker pull ghcr.io/bodencrouch/cloudflare-one-warp:latest

# macOS Homebrew
brew tap bodencrouch/cloudflare-one-warp homebrew-tap
brew install cloudflare-one-warp
```

See **[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)** for Flathub, Snap Store, COPR, AUR, and AppImageHub install paths.

See **[docs/PACKAGING.md](docs/PACKAGING.md)** for build details and maintainer workflows.

## Contributing

Contributions are welcome. Please read **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** before opening a pull request.

```bash
export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"
npm run check && npm run test:all
```

## License

[MIT](LICENSE)
