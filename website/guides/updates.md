# Updates

Client self-update checks GitHub releases against `config/update-manifest.json`.

## API

```bash
SESSION=$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/update/check | jq

# AppImage apply: available only with a usable pinned release signature; prepare first, then confirm with the returned token
TOKEN=$(curl -s -X POST http://127.0.0.1:4173/api/update/prepare \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{}' | jq -r .applyConfirmToken)

curl -s -X POST http://127.0.0.1:4173/api/update/apply \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d "{\"confirmToken\":\"$TOKEN\"}"
```

## What must be true before an update installs

An AppImage is replaced only when all of these hold:

- the download came from a GitHub release host (checked on every redirect),
- a detached signature published beside it verifies against a key built into your copy of Cloudflare One WARP, and
- the new version is newer than the one you have.

Otherwise nothing changes and Cloudflare One WARP tells you to download the release yourself.

The current bootstrap key ring is empty, so automatic AppImage Apply is unavailable. Download the matching release artifact and install it manually. An update must also match the host architecture. Verified replacement uses a temporary sibling of the installed AppImage and works when the cache is on another filesystem.

## Channels

Stable and beta pointers live in the manifest. UI exposes channel selection via combobox (official repo and forks — not free-text).

## Pipeline

Release → manifest bump → client check. Maintainer docs: [UPDATES.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/UPDATES.md).

## Tests

```bash
npm run test:update
```
