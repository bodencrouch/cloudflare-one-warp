# Distribution channels

Cloudflare One WARP ships through several channels. See [DISTRIBUTION](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/DISTRIBUTION.md) in the repo for maintainer details.

## Build from source

```bash
./cloudflare-one-warp build appimage   # single-file Linux binary
./cloudflare-one-warp build deb
./cloudflare-one-warp build rpm
./cloudflare-one-warp build flatpak
./cloudflare-one-warp build snap
./cloudflare-one-warp build all          # staged artifacts under packaging/dist/
```

## Channels

| Channel | Notes |
|---------|-------|
| **GitHub Releases** | AppImage and source tarballs |
| **AppImageHub** | Community AppImage index |
| **Flathub** | Flatpak (sandboxed) |
| **Snap Store** | Strict confinement |
| **COPR / AUR** | RPM and Arch packaging (see docs) |
| **Homebrew** | `homebrew-tap` branch — tap formula |
| **GHCR Docker** | Container images for headless/API use |

## npm package

The repo publishes the `cloudflare-one-warp` npm package name for programmatic installs; primary UX remains the native CLI launchers above.

## WARP prerequisite

Every channel assumes **warp-cli** is installed and registered on the host. Cloudflare One WARP does not bundle the Cloudflare daemon.
