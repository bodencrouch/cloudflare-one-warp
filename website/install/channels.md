# Distribution channels

Direct artifacts are available through GitHub Releases. Store recipes and publishing scripts do not establish that an app is listed in a store; the store channels below require their separate publishing/review steps. See [DISTRIBUTION](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/DISTRIBUTION.md) in the repo for maintainer details.

## Build from source

```bash
./cloudflare-one-warp build appimage   # single-file Linux binary
./cloudflare-one-warp build deb
./cloudflare-one-warp build rpm
./cloudflare-one-warp build flatpak
./cloudflare-one-warp build snap
./cloudflare-one-warp build all          # artifacts under dist/packages/
```

## Channels

| Channel | Notes |
|---------|-------|
| **GitHub Releases** | AppImage, deb, rpm, Arch, Flatpak, Snap and source artifacts |
| **AppImageHub** | Community index; available after listing acceptance |
| **Flathub** | Requires Flathub submission acceptance; direct Flatpak bundles come from GitHub Releases |
| **Snap Store** | Classic confinement; store upload and classic review required |
| **COPR / AUR** | Require configured COPR/AUR publishing; direct rpm/Arch artifacts remain available |
| **Homebrew** | Dedicated `bodencrouch/homebrew-cloudflare-one-warp` repository |
| **GHCR Docker** | Container images for headless/API use |

## Homebrew (macOS)

```bash
brew tap bodencrouch/cloudflare-one-warp
brew install cloudflare-one-warp
```

The tap is updated after release assets are published. If tap installation is unavailable, download the generated Formula artifact from the package workflow and run `brew install ./Formula/cloudflare-one-warp.rb`.

## npm commands

The repository is private in npm metadata and is not published as an npm installable package. Clone it and use the documented npm scripts to run checks or build artifacts.

## WARP prerequisite

Every channel assumes **warp-cli** is installed and registered on the host. Cloudflare One WARP does not bundle the Cloudflare daemon.
