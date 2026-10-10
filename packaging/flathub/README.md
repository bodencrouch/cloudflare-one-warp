# Submitting Cloudflare One WARP to Flathub

1. Fork [github.com/flathub/flathub](https://github.com/flathub/flathub)
2. Add [`io.github.bodencrouch.CloudflareOneWarp.yml`](io.github.bodencrouch.CloudflareOneWarp.yml) to the repo root (same filename)
3. Update `tag` and `commit` in the manifest to the release you are publishing
4. Open a PR — Flathub bot will build and review
5. Ensure AppStream passes (`appstreamcli validate` on metainfo in main repo: `packaging/flatpak/metainfo.xml`)

After merge, users install with:

```bash
flatpak install flathub io.github.bodencrouch.CloudflareOneWarp
```

Optional CI automation: set `FLATHUB_PAT` and run [`scripts/publish-flathub-pr.sh`](../../scripts/publish-flathub-pr.sh) on release.
