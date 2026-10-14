# Cloudflare One WARP 0.3.5

This release hardens account ownership, network protection, desktop integration, updates, accessibility and distribution after an independent expert review. See the [review and validation map](https://github.com/bodencrouch/cloudflare-one-warp/blob/v0.3.5/docs/EXPERT_REVIEW.md) and [changelog](https://github.com/bodencrouch/cloudflare-one-warp/blob/v0.3.5/CHANGELOG.md).

Private API reads, writes and live events now require the owner credential. Use `cloudflare-one-warp --webui` to authorize the optional browser UI; native clients read the private token file. Restart the daemon after upgrading. Anonymous health/version probes remain available.

Downloads include deb, rpm, Arch, AppImage, Flatpak, Snap, source, Homebrew formula, checksums and an application dependency SBOM. Release provenance and container build provenance accompany the artifacts. Automatic AppImage replacement remains disabled until a production release key is pinned; manual installation is available.

Cloudflare's installed host `warp-cli` remains required. [Documentation](https://bodencrouch.github.io/cloudflare-one-warp/) and [Homebrew tap](https://github.com/bodencrouch/homebrew-cloudflare-one-warp) are maintained separately from store submission channels.
