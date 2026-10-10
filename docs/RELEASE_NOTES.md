Cloudflare One WARP 0.3.0 renames the client and all distribution artifacts to match the repository.

- Product: **Cloudflare One WARP**.
- CLI and package: `cloudflare-one-warp`; tray: `cloudflare-one-warp-tray`.
- Environment variables: `CLOUDFLARE_ONE_WARP_*`.
- Configuration: `~/.config/cloudflare-one-warp/config.json` and `/etc/cloudflare-one-warp/config.json`.
- systemd service: `cloudflare-one-warp.service`.
- App ID: `io.github.bodencrouch.CloudflareOneWarp`.
- Documentation: https://bodencrouch.github.io/cloudflare-one-warp/.

This release changes installation and configuration paths. Reinstall using the renamed package and move any existing configuration to the paths above. Cloudflare's host `warp-cli` remains required.

Release downloads include deb, rpm, Arch, AppImage, Flatpak, Snap, source archives, Homebrew formula, and checksums. Containers are published to GHCR.
