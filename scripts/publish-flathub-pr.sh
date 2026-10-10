#!/usr/bin/env bash
# Open (or update) a PR to flathub/flathub with the release manifest.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('${ROOT}/package.json').version")}"
TAG="v${VERSION}"
COMMIT="$(git rev-parse "${TAG}" 2>/dev/null || git rev-parse HEAD)"
MANIFEST_NAME="io.github.bodencrouch.CloudflareOneWarp.yml"
FLATHUB_FORK="${FLATHUB_FORK:-bodencrouch/flathub}"
FLATHUB_UPSTREAM="flathub/flathub"
BRANCH="cloudflare-one-warp-${VERSION}"

if [[ -z "${FLATHUB_PAT:-}" ]]; then
  echo "FLATHUB_PAT is not set — skipping Flathub PR automation." >&2
  echo "Manual: copy packaging/flathub/${MANIFEST_NAME} to a PR against ${FLATHUB_UPSTREAM}" >&2
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

git clone "https://x-access-token:${FLATHUB_PAT}@github.com/${FLATHUB_FORK}.git" "$WORKDIR/flathub"
git -C "$WORKDIR/flathub" remote add upstream "https://github.com/${FLATHUB_UPSTREAM}.git" 2>/dev/null || true
git -C "$WORKDIR/flathub" fetch upstream master
git -C "$WORKDIR/flathub" checkout -B "$BRANCH" upstream/master

sed -e "s/^        tag: .*/        tag: ${TAG}/" \
    -e "s/^        commit: .*/        commit: ${COMMIT}/" \
    "${ROOT}/packaging/flathub/${MANIFEST_NAME}" > "$WORKDIR/flathub/${MANIFEST_NAME}"

git -C "$WORKDIR/flathub" config user.email "221775936+bodencrouch@users.noreply.github.com"
git -C "$WORKDIR/flathub" config user.name "bodencrouch"
git -C "$WORKDIR/flathub" add "$MANIFEST_NAME"
git -C "$WORKDIR/flathub" commit -m "Add Cloudflare One WARP ${VERSION}" || { echo "No Flathub manifest changes."; exit 0; }
git -C "$WORKDIR/flathub" push -f origin "$BRANCH"

if command -v gh >/dev/null 2>&1; then
  GH_TOKEN="$FLATHUB_PAT" gh pr create \
    --repo "$FLATHUB_UPSTREAM" \
    --head "${FLATHUB_FORK%%/*}:${BRANCH}" \
    --base master \
    --title "Add io.github.bodencrouch.CloudflareOneWarp ${VERSION}" \
    --body "Cloudflare One WARP ${VERSION} — unofficial Cloudflare One client via warp-cli.

Upstream: https://github.com/bodencrouch/cloudflare-one-warp/releases/tag/${TAG}" \
    || echo "PR may already exist — check ${FLATHUB_UPSTREAM}"
else
  echo "Push complete. Open PR manually: ${FLATHUB_FORK} branch ${BRANCH} -> ${FLATHUB_UPSTREAM}"
fi
