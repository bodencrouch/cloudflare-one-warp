# Packaging

Build matrix and FHS layout for Cloudflare One WARP artifacts.

## Operator builds

```bash
./cloudflare-one-warp build appimage
./cloudflare-one-warp build deb
./cloudflare-one-warp build rpm
./cloudflare-one-warp build flatpak
./cloudflare-one-warp build snap
./cloudflare-one-warp build all
```

npm aliases: `npm run package:stage`, `npm run package:deb`, etc.

## Staging

`packaging/scripts/stage-payload.sh` copies server, lib, public, bin, and config into FHS paths for nfpm/AppImage.

## Contents

| Artifact | Notes |
|----------|-------|
| **AppImage** | Portable Linux, update apply target |
| **deb/rpm** | nfpm + postinstall systemd/desktop |
| **Flatpak** | `packaging/flatpak/` manifest |
| **Snap** | strict confinement |
| **Docker** | GHCR images for headless API |

## systemd

User and system units under `packaging/systemd/`. Postinstall enables desktop integration.

## NetworkManager

Dispatcher and VPN name stub ship in deb/rpm/AppImage when staged:

- `packaging/networkmanager/99-cloudflare-one-warp`
- `packaging/networkmanager/nm-cloudflare-one-warp-service.name`

## Maintainer docs

Full detail in repository [PACKAGING.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/PACKAGING.md) and [DISTRIBUTION.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/DISTRIBUTION.md).

## CI

Plane M validates mock warp-cli on Linux/macOS/Windows. Plane R optional real WARP smoke on Ubuntu — [CI.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/CI.md).
