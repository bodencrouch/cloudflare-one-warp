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

`packaging/scripts/stage-payload.sh` copies server, lib, public, bin, and config into FHS paths consumed by nfpm, AppImage and the Arch/AUR/Fedora recipes. It includes every library module, launcher/settings helper and Qt worker module.

## Contents

| Artifact | Notes |
|----------|-------|
| **AppImage** | Portable Linux, bundles verified Node 24; automatic replacement requires a pinned key/signature |
| **deb/rpm** | nfpm + postinstall systemd/desktop |
| **Flatpak** | `packaging/flatpak/` manifest |
| **Snap** | classic confinement; bundles verified Node 24 |
| **Docker** | GHCR images for headless API |

## systemd

The packaged user unit is `packaging/cloudflare-one-warp.service`; the local installer generates a matching user unit. Enable it explicitly with `systemctl --user enable --now cloudflare-one-warp.service`. Its default API-only posture leaves the official Cloudflare tray in control.

`ProtectSystem=strict` retains a dedicated runtime temporary directory and explicit state/integration write grants. Fixed pre-start directory creation runs as the same user before the main process receives its mount sandbox. The generated unit honors custom XDG config/data homes; see the repository Packaging guide for custom data-home overrides of the packaged unit.

## NetworkManager

Dispatcher and addressless dummy marker profiles ship with staged Linux integration:

- `packaging/networkmanager/99-cloudflare-one-warp`
- `packaging/networkmanager/nm-cloudflare-one-warp-service.name`

## Maintainer docs

Full detail in repository [PACKAGING.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/PACKAGING.md) and [DISTRIBUTION.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/DISTRIBUTION.md).

## CI

Plane M validates mock warp-cli on Linux/macOS/Windows. Plane R optional real WARP smoke on Ubuntu — [CI.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/CI.md).

## Review fixes

The [0.3.4 review tracker](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/REVIEW_FIXES.md) maps all 24 findings to changes, regression coverage and native validation limits.
