# Updates

Client self-update checks GitHub releases against `config/update-manifest.json`.

## API

```bash
SESSION=$(cat ~/.config/thirdflare/session-4173.token)
curl -s http://127.0.0.1:4173/api/update/check | jq

# AppImage apply: prepare first, then confirm with the returned token
TOKEN=$(curl -s -X POST http://127.0.0.1:4173/api/update/prepare \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{}' | jq -r .applyConfirmToken)

curl -s -X POST http://127.0.0.1:4173/api/update/apply \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d "{\"confirmToken\":\"$TOKEN\"}"
```

## What must be true before an update installs

An AppImage is replaced only when all of these hold:

- the download came from a GitHub release host (checked on every redirect),
- a detached signature published beside it verifies against a key built into your copy of ThirdFlare One, and
- the new version is newer than the one you have.

Otherwise nothing changes and ThirdFlare One tells you to download the release yourself.

## Channels

Stable and beta pointers live in the manifest. UI exposes channel selection via combobox (official repo and forks — not free-text).

## Pipeline

Release → manifest bump → client check. Maintainer docs: [UPDATES.md](https://github.com/bodencrouch/thirdflare-one/blob/main/docs/UPDATES.md).

## Tests

```bash
npm run test:update
```
