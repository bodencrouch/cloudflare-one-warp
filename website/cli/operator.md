# cloudflare-one-warp operator

Build, install, and test entrypoint — comparable to `podman` system commands or a project `./cloudflare-one-warp` wrapper.

## Usage

```
cloudflare-one-warp install [--service]   User install to ~/.local/share/cloudflare-one-warp
cloudflare-one-warp uninstall [--purge]   Remove install
cloudflare-one-warp run [args...]         Launch GUI (bin/cloudflare-one-warp)
cloudflare-one-warp build <target>        Package builds
cloudflare-one-warp dev                   Dev server + Web UI
cloudflare-one-warp check                 Syntax check
cloudflare-one-warp test [suite]          Test suites
cloudflare-one-warp version               Print version
cloudflare-one-warp help                  Show help
```

## Install

```bash
./cloudflare-one-warp install
./cloudflare-one-warp install --service   # systemd user unit
```

## Build targets

```bash
./cloudflare-one-warp build appimage
./cloudflare-one-warp build deb
./cloudflare-one-warp build rpm
./cloudflare-one-warp build arch
./cloudflare-one-warp build flatpak
./cloudflare-one-warp build snap
./cloudflare-one-warp build source
./cloudflare-one-warp build all
```

## Development

```bash
./cloudflare-one-warp dev        # npm run dev
./cloudflare-one-warp check      # npm run check
./cloudflare-one-warp test all   # Plane M mock tests
./cloudflare-one-warp test ui    # Playwright smoke
```

## Test suites

| Suite | Command |
|-------|---------|
| All (no Playwright) | `test all` |
| Integration | `test integration` |
| OpenAPI | `test openapi` |
| Kill switch | `test killswitch` |
| Updates | `test update` |
| Real WARP (optional) | `test warp:real` |

See [Contributing](/contributing/) for CI planes (Plane M vs Plane R).
