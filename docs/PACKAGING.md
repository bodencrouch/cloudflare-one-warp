# Packaging

Cloudflare One WARP ships as `cloudflare-one-warp` / `cloudflare-one-warp` packages. Artifacts do **not** bundle Cloudflare WARP — install the official client first.

https://developers.cloudflare.com/warp-client/get-started/linux/

## Formats

| Artifact | Depends on | Notes |
|----------|------------|-------|
| `.deb` / `.rpm` / Arch `.pkg.tar.zst` | System `nodejs >= 20` | Built with [nfpm](https://nfpm.goreleaser.com/); recommends `python3-pyqt6` + WebEngine for tray |
| `.AppImage` | Host `warp-cli` | Bundles Node 20; x86_64 |
| `.flatpak` | Host `warp-cli`, host PyQt6 for tray | Bundles Node; `cloudflare-one-warp-tray` in app; tray needs host PyQt6 (Phase 2: bundle Qt) |
| `.snap` (classic) | Host `warp-cli` | Classic confinement; stages `python3-pyqt6` for tray; polkit policy included |
| `cloudflare-one-warp-*-src.tar.gz` + `PKGBUILD` | — | For AUR / manual builds |
| `SHA256SUMS` | — | Published with releases |
| **Docker (ghcr.io)** | Host `warp-cli` when running container | API server + CI builder images |
| **Homebrew (macOS)** | `node@20`, host `warp-cli` | Tap branch `homebrew-tap` |

## CI / manual runs

```bash
# PR CI: syntax, mock warp-cli integration, update tests, deb/rpm smoke
gh workflow run ci.yml --ref main

# Optional real WARP attempt on Ubuntu runner
gh workflow run ci.yml --ref main -f real_warp=true

# Full packaging matrix + ghcr.io images
gh workflow run package.yml --ref main

# Publish to an existing GitHub Release tag
gh workflow run package.yml --ref main -f tag=v0.1.0 -f publish_release=true -f update_homebrew_tap=true
```

See [UPDATES.md](UPDATES.md) for release publishing and manifest sync.

See [DISTRIBUTION.md](DISTRIBUTION.md) for Flathub, Snap Store, COPR, AUR, and AppImageHub channels.

## Container images (GHCR)

```bash
docker pull ghcr.io/bodencrouch/cloudflare-one-warp:latest
docker run --rm -p 4173:4173 -e WARP_CLI=/path/to/warp-cli ghcr.io/bodencrouch/cloudflare-one-warp:latest

docker pull ghcr.io/bodencrouch/cloudflare-one-warp-ci:latest
```

## Homebrew (macOS)

```bash
brew tap bodencrouch/cloudflare-one-warp homebrew-tap
brew install cloudflare-one-warp
cloudflare-one-warp --no-open
```

Requires [Cloudflare WARP for macOS](https://developers.cloudflare.com/warp-client/get-started/macos/).

## Local commands

See **[GETTING_STARTED.md](../GETTING_STARTED.md)** (usage) and **[CONTRIBUTING.md](../CONTRIBUTING.md)** (build from source).

```bash
./cloudflare-one-warp install
./cloudflare-one-warp build appimage
./cloudflare-one-warp build all
npm run package:stage
npm run package:deb
npm run package:verify
```

## Install layout (deb/rpm/arch)

```
/usr/bin/cloudflare-one-warp
/usr/bin/cloudflare-one-warp
/usr/bin/cloudflare-one-warp-tray
/usr/lib/cloudflare-one-warp/
/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy
/usr/share/applications/cloudflare-one-warp.desktop
/usr/share/icons/hicolor/scalable/apps/cloudflare-one-warp.svg
/usr/share/applications/cloudflare-one-warp-tray.desktop
/usr/lib/systemd/user/cloudflare-one-warp.service
```

Tray dependencies (recommended, not always required):

| Format | Tray deps |
|--------|-----------|
| deb | `python3-pyqt6`, `python3-pyqt6.qtwebengine`, `yad` (X11 fallback) |
| rpm | `python3-pyqt6`, `python3-pyqt6-webengine`, `yad` (X11 fallback) |
| Fedora COPR | same via `Recommends:` in spec |
| Arch/AUR | `python-pyqt6`, `python-pyqt6-webengine` (optdepends) |
| Flatpak | Host PyQt6 for native shell; finish-args include StatusNotifier |
| Snap | `python3-pyqt6` staged; classic confinement |
| AppImage | Host PyQt6 documented; tray scripts in AppDir |

Kill switch / polkit:

- deb/rpm/AppImage: `/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy`
- Local install (`./cloudflare-one-warp install`): copy policy manually — install script prints the command
- Flatpak: policy in `/app/share/polkit-1/`; host `nft` may still be required via `flatpak-spawn --host`

Tray autostart template: `packaging/cloudflare-one-warp-tray.desktop` (installed to `~/.config/autostart/` when `tray.shell` is `cloudflare-one-warp` and `tray.autostart` is true). Cloudflare One Client autostart stays with the host WARP package unless Cloudflare One WARP hides it for this user.

Enable the user service after install:

```bash
systemctl --user enable --now cloudflare-one-warp.service
```

## Service confinement

[`packaging/cloudflare-one-warp.service`](../packaging/cloudflare-one-warp.service) and the user unit written by [`scripts/install-local.sh`](../scripts/install-local.sh) carry the same confinement block. `npm run test:systemd` parses both and fails on drift, so change them together.

The daemon runs with `ProtectSystem=strict`, so the whole filesystem is read-only apart from the paths it is granted:

| Directive | Why |
|-----------|-----|
| `ConfigurationDirectory=cloudflare-one-warp` (mode `0700`) | `~/.config/cloudflare-one-warp` holds `config.json` and the local session credential |
| `CacheDirectory=cloudflare-one-warp` (mode `0700`) | Update downloads and cached release metadata |
| `ReadWritePaths=-%h/.config/autostart -%h/.local/share/applications` | Tray autostart entries and generated app shortcuts |
| `ReadWritePaths=-%t -/run/cloudflare-warp` | Runtime dir plus the WARP service socket |
| `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK` | Loopback HTTP, the WARP socket, and interface lookups — nothing else |

Every `ReadWritePaths` entry is `-` prefixed so a missing optional path does not stop the daemon from starting.

Three common hardening directives are deliberately absent, and the test asserts they stay out:

- `NoNewPrivileges` and `PrivateTmp` — both break the `pkexec` hop the kill switch uses to apply nftables rules. `NoNewPrivileges` blocks the setuid transition outright, and `PrivateTmp` hides the temporary rule file from the privileged helper.
- `MemoryDenyWriteExecute` — the Node JIT needs writable-executable pages.

If you revisit these, verify the kill switch end to end (`POST /api/killswitch` with a real `nft`), not just daemon startup — CI cannot exercise the privileged path.

## Signing

CI publishes `SHA256SUMS` for every release. Optional GPG signing of `.deb`/`.rpm` can be enabled later via repository secrets and [`packaging/scripts/checksums.sh`](../packaging/scripts/checksums.sh).
