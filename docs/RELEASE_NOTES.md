# Cloudflare One WARP 0.3.6

This follow-up expert review improves failure recovery, enrollment safety, desktop ownership, update guidance and package verification. See the [review map](https://github.com/bodencrouch/cloudflare-one-warp/blob/v0.3.6/docs/EXPERT_REVIEW.md) and [changelog](https://github.com/bodencrouch/cloudflare-one-warp/blob/v0.3.6/CHANGELOG.md).

Invalid enrollment-pause requests are rejected. Interrupted KDE restoration retains recovery information. Status and account parsers distinguish command failures from real connection and registration state. Native reads recover after daemon changes without replaying mutations; browser authorization loss clears private views. Desktop integration preserves unmanaged files, and installed uninstallers work from their own location.

Guided package updates use private temporary downloads and verify release checksums before installation. Source preparation disables npm installation hooks. Package verification rejects corrupt payloads and inspects their required runtime helpers.

Restart the daemon after upgrading. Use `cloudflare-one-warp --webui` to authorize the optional browser UI. Cloudflare's installed host `warp-cli` remains required.

Downloads include DEB, RPM, Arch, AppImage, Flatpak, Snap, source, Homebrew, checksums and an application dependency SBOM, with release provenance. Automatic AppImage replacement remains disabled pending a pinned production release key. Native signing/notarization and external store submissions depend on their separate credentials and platform evidence. [Documentation](https://bodencrouch.github.io/cloudflare-one-warp/).
