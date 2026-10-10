# Cloudflare One WARP documentation

## Quick links

| I want to… | Read |
|------------|------|
| Install and run Cloudflare One WARP | [GETTING_STARTED.md](GETTING_STARTED.md) |
| Configure settings | [CONFIGURATION.md](CONFIGURATION.md) |
| Contribute or run tests | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Understand the architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Build packages | [PACKAGING.md](PACKAGING.md) |
| Understand updates | [UPDATES.md](UPDATES.md) |
| Install from app stores | [DISTRIBUTION.md](DISTRIBUTION.md) |
| Understand CI | [CI.md](CI.md) |

## Common commands

```bash
# End user — from a clone
./cloudflare-one-warp install
cloudflare-one-warp

# Developer
export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"
npm run check && npm run test:all
npm run dev

# Maintainer
./cloudflare-one-warp build appimage
./cloudflare-one-warp build all
```

Project overview: [README.md](../README.md)
