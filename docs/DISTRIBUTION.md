# Distribution channels

Where to install Cloudflare One WARP and how each channel is published from this repository.

> **Not affiliated with Cloudflare.** Install [Cloudflare WARP](https://developers.cloudflare.com/warp-client/get-started/linux/) separately on every platform.

## Quick install by channel

| Channel | Install command | Discoverability |
|---------|-----------------|-----------------|
| **GitHub Releases** | Download artifact from [Releases](https://github.com/bodencrouch/cloudflare-one-warp/releases) | Always available |
| **Flathub** | `flatpak install flathub io.github.bodencrouch.CloudflareOneWarp` | After Flathub PR merge |
| **Snap Store** | `snap install cloudflare-one-warp --classic` | After store upload + classic review |
| **Fedora COPR** | `dnf copr enable bodencrouch/cloudflare-one-warp && dnf install cloudflare-one-warp` | After Packit/COPR build |
| **Homebrew (macOS)** | `brew tap bodencrouch/cloudflare-one-warp homebrew-tap && brew install cloudflare-one-warp` | Automated on release |
| **AppImageHub** | Listed at [appimage.github.io](https://appimage.github.io/) | After listing PR merge |
| **Arch AUR** | `yay -S cloudflare-one-warp` | After AUR package publish |
| **User install (any Linux)** | `./cloudflare-one-warp install` from a clone | Manual |

### GitHub Releases (direct download)

```bash
# AppImage (x86_64, bundles Node)
chmod +x cloudflare-one-warp-VERSION-x86_64.AppImage
./cloudflare-one-warp-VERSION-x86_64.AppImage

# Debian / Ubuntu
sudo dpkg -i cloudflare-one-warp_VERSION_all.deb

# Fedora / RHEL (from release asset)
sudo rpm -Uvh cloudflare-one-warp-VERSION-1.noarch.rpm
```

### Flathub

```bash
flatpak install flathub io.github.bodencrouch.CloudflareOneWarp
cloudflare-one-warp
```

Manifest for submission: [`packaging/flathub/io.github.bodencrouch.CloudflareOneWarp.yml`](../packaging/flathub/io.github.bodencrouch.CloudflareOneWarp.yml)

**Migration:** Older sideloaded `.flatpak` bundles used app ID `io.github.cloudflare_one_gui_linux.CloudflareOneGui`. Flathub and new builds use `io.github.bodencrouch.CloudflareOneWarp`.

### Snap Store

```bash
snap install cloudflare-one-warp --classic
```

Classic confinement is required so the snap can reach the host `warp-cli` and WARP daemon. Justification: [`packaging/snap/CLASSIC_JUSTIFICATION.md`](../packaging/snap/CLASSIC_JUSTIFICATION.md)

### Fedora COPR

```bash
sudo dnf copr enable bodencrouch/cloudflare-one-warp
sudo dnf install cloudflare-one-warp
```

Builds are triggered from release tags via [Packit](https://packit.dev) (see [`.packit.yaml`](../.packit.yaml)).

### Homebrew (macOS)

```bash
brew tap bodencrouch/cloudflare-one-warp homebrew-tap
brew install cloudflare-one-warp
cloudflare-one-warp --no-open
```

Requires [Cloudflare WARP for macOS](https://developers.cloudflare.com/warp-client/get-started/macos/).

### AppImageHub

After listing merge, AppImageHub points to the latest GitHub Release AppImage URL pattern:

`https://github.com/bodencrouch/cloudflare-one-warp/releases/download/vVERSION/cloudflare-one-warp-VERSION-x86_64.AppImage`

Listing template: [`packaging/appimagehub/cloudflare-one-warp.yml`](../packaging/appimagehub/cloudflare-one-warp.yml)

### Arch AUR

```bash
yay -S cloudflare-one-warp
# or
git clone https://aur.archlinux.org/cloudflare-one-warp.git && cd cloudflare-one-warp && makepkg -si
```

PKGBUILD template: [`packaging/aur/PKGBUILD`](../packaging/aur/PKGBUILD)

---

## Platform coverage

| Platform | Native bundle | Install path today |
|----------|---------------|-------------------|
| **Linux** | Primary target | Flathub, Snap, COPR, AppImage, deb, rpm, AUR, GitHub Releases |
| **macOS** | No `.app` yet | Homebrew tap (CLI + browser Web UI) |
| **Windows** | No `.exe` yet | Not packaged — official Cloudflare One client exists; CI runs mock tests only |

A future **Tauri** shell could ship `.exe` / `.app` bundles wrapping the same localhost API; that is tracked separately from store publishing.

---

## Maintainer automation

Release flow:

1. Tag + GitHub Release (Release packages or `gh release create`)
2. [`package.yml`](../.github/workflows/package.yml) builds artifacts and uploads to the release
3. [`publish-stores.yml`](../.github/workflows/publish-stores.yml) publishes to stores when secrets are configured

| Secret | Enables |
|--------|---------|
| `SNAPCRAFT_STORE_CREDENTIALS` | Snap Store upload |
| `COPR_API_TOKEN` | Manual COPR trigger from CI (Packit uses its own integration) |
| `AUR_SSH_PRIVATE_KEY` | AUR package push via [`scripts/publish-aur.sh`](../scripts/publish-aur.sh) |
| `FLATHUB_PAT` | Optional PR to flathub/flathub via [`scripts/publish-flathub-pr.sh`](../scripts/publish-flathub-pr.sh) |
| `GH_PAT` | Optional AppImageHub listing PR via [`scripts/publish-appimagehub-pr.sh`](../scripts/publish-appimagehub-pr.sh) |

### One-time setup checklist

- [ ] Merge Flathub PR at [github.com/flathub/flathub](https://github.com/flathub/flathub) using manifest in `packaging/flathub/`
- [ ] Register `cloudflare-one-warp` on Snap Store; export login → `SNAPCRAFT_STORE_CREDENTIALS`
- [ ] Enable Packit on the repo for COPR project `bodencrouch/cloudflare-one-warp`
- [ ] Create AUR package `cloudflare-one-warp` (manual or CI with `AUR_SSH_PRIVATE_KEY`)
- [ ] Open AppImageHub PR using `packaging/appimagehub/cloudflare-one-warp.yml`

See also [PACKAGING.md](PACKAGING.md) and [UPDATES.md](UPDATES.md).
