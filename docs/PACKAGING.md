# Packaging

Cloudflare One WARP ships as `cloudflare-one-warp` / `cloudflare-one-warp` packages. Artifacts do **not** bundle Cloudflare WARP — install the official client first.

https://developers.cloudflare.com/warp-client/get-started/linux/

## Formats

| Artifact | Depends on | Notes |
|----------|------------|-------|
| `.deb` / `.rpm` / Arch `.pkg.tar.zst` | System `nodejs >= 22` | Built with [nfpm](https://nfpm.goreleaser.com/); recommends `python3-pyqt6` + WebEngine for tray |
| `.AppImage` | Host `warp-cli` | Bundles Node 24; x86_64 |
| `.flatpak` | Host `warp-cli`, host PyQt6 for tray | Bundles Node; `cloudflare-one-warp-tray` in app; tray needs host PyQt6 (Phase 2: bundle Qt) |
| `.snap` (classic) | Host `warp-cli` | Classic confinement; stages `python3-pyqt6` for tray; polkit policy included |
| `cloudflare-one-warp-*-src.tar.gz` + `PKGBUILD` | — | For AUR / manual builds |
| `SHA256SUMS` | — | Published with releases |
| **Docker (ghcr.io)** | Host `warp-cli` when running container | API server + CI builder images |
| **Homebrew (macOS)** | `node@24`, host `warp-cli` | Dedicated `bodencrouch/homebrew-cloudflare-one-warp` tap |

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
# Linux host with Cloudflare WARP installed and warp-svc running.
warp_cli_path=$(readlink -f "$(command -v warp-cli)")
test -x "$warp_cli_path" && test -d /run/cloudflare-warp || exit 1
docker run --rm --network host \
  --mount "type=bind,src=$warp_cli_path,dst=/usr/local/bin/warp-cli,readonly" \
  --mount type=bind,src=/run/cloudflare-warp,dst=/run/cloudflare-warp,readonly \
  -e WARP_CLI=/usr/local/bin/warp-cli \
  ghcr.io/bodencrouch/cloudflare-one-warp:latest

docker pull ghcr.io/bodencrouch/cloudflare-one-warp-ci:latest
```

On Linux, host networking shares the host network namespace, so the loopback-only API is reachable at `http://127.0.0.1:4173` from the host. Docker bridge port publishing cannot reach this daemon. The container calls the mounted host CLI through the WARP service's Unix socket; the read-only directory mount still permits socket communication. The host service controls the host's WARP connection.

The image runs as its unprivileged `node` user. That user must be able to execute the mounted CLI and access the service socket; match the host socket's group with `--group-add` if required. The CLI must match the image's architecture and Debian Bookworm runtime libraries. Missing libraries require a compatible custom image or a native installation. This example targets Linux Docker Engine; use a native installation on macOS or Windows. Desktop integration and the host's privileged nftables helper are not provided by this API container.

## Homebrew (macOS)

```bash
brew tap bodencrouch/cloudflare-one-warp
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
| `RuntimeDirectory=cloudflare-one-warp` and `TMPDIR=%t/cloudflare-one-warp` | Private writable temporary directory shared with the authorized helper |
| `StateDirectory=cloudflare-one-warp` | Persistent app state |
| `ReadWritePaths=-%t/cloudflare-one-warp -/run/cloudflare-warp` | App runtime plus the WARP service socket |
| Desktop integration write grants | App proxy launchers, user units, and config home; KDE atomic writes need a sibling temporary file |
| `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK` | Loopback HTTP, the WARP socket, and interface lookups — nothing else |

Every `ReadWritePaths` entry is `-` prefixed so a missing optional path does not stop the daemon from starting.

Three common hardening directives are deliberately absent, and the test asserts they stay out:

- `NoNewPrivileges` and `PrivateTmp` — both break the `pkexec` hop the kill switch uses to apply nftables rules. `NoNewPrivileges` blocks the setuid transition outright, and `PrivateTmp` hides the temporary rule file from the privileged helper.
- `MemoryDenyWriteExecute` — the Node JIT needs writable-executable pages.

If you revisit these, verify the kill switch end to end (`POST /api/killswitch` with a real `nft`), not just daemon startup — CI cannot exercise the privileged path.

## Signing

CI publishes `SHA256SUMS` for every release. Optional GPG signing of `.deb`/`.rpm` can be enabled later via repository secrets and [`packaging/scripts/checksums.sh`](../packaging/scripts/checksums.sh).

The daemon grants its config directory because KDE writes `kioslaverc` atomically through a sibling temporary file. It does not grant all of HOME, /home, or /tmp. The installer prepares desktop integration directories before starting the confined service. Native user namespace support is required to enforce these mount restrictions.

The fixed `ExecStartPre=+/usr/bin/mkdir` creates optional integration directories before the main process receives its filesystem sandbox. In a user manager it runs as the same user, with no root elevation. The main process retains narrow data-directory grants. The packaged unit uses the normal `~/.local/share` data home; installations with a custom `XDG_DATA_HOME` should use the local installer-generated unit or a user override for its precreation and writable paths.

Native deb/rpm/Arch packages accept supported Node 22 LTS or later; Node 24 LTS is recommended. AppImage, Flatpak, Snap, Docker and Homebrew use Node 24. CI covers both Linux Node 22 compatibility and Node 24 on Linux/macOS/Windows.
