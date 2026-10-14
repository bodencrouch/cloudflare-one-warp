#!/usr/bin/env bash
# Generate AppImageHub listing with release URL + sha256; optionally open PR.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
TAG="v${VERSION}"
APPIMAGE="cloudflare-one-warp-${VERSION}-x86_64.AppImage"
BASE="https://github.com/bodencrouch/cloudflare-one-warp/releases/download/${TAG}/${APPIMAGE}"
OUT="${ROOT}/dist/appimagehub-${VERSION}.yml"

SHA=""
SUMS="${ROOT}/dist/packages/SHA256SUMS"
if [[ -f "$SUMS" ]]; then
  SHA="$(awk -v f="$APPIMAGE" '$2 == f { print $1; exit }' "$SUMS")"
fi
if [[ -z "$SHA" ]]; then
  echo "Warning: SHA256 not found in ${SUMS}; listing will need manual sha256." >&2
  SHA="REPLACE_WITH_SHA256"
fi

mkdir -p "${ROOT}/dist"
cat > "$OUT" <<YAML
name: Cloudflare One WARP
categories:
  - Network
  - Utility
description: Unofficial Cloudflare One client via warp-cli
installations:
  - type: file
    url: ${BASE}
    sha256: ${SHA}
    arch: x86_64
YAML

echo "Wrote ${OUT}"

if [[ -z "${GH_PAT:-}" ]]; then
  echo "GH_PAT not set — open PR manually to https://github.com/AppImage/appimage.github.io" >&2
  exit 0
fi

if [[ ! "$SHA" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Refusing to publish AppImageHub listing without a valid SHA-256" >&2; exit 1
fi

HUB_FORK="${APPIMAGEHUB_FORK:-bodencrouch/appimage.github.io}"
BRANCH="cloudflare-one-warp-${VERSION}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
# shellcheck source=lib/common.sh
source "${ROOT}/scripts/lib/common.sh"
cloudflare_one_warp_setup_git_credentials "$WORKDIR" "${GH_PAT}"

git clone "https://github.com/${HUB_FORK}.git" "$WORKDIR/hub"
git -C "$WORKDIR/hub" checkout -B "$BRANCH"
mkdir -p "$WORKDIR/hub/data"
cp "$OUT" "$WORKDIR/hub/data/cloudflare-one-warp.yml"
git -C "$WORKDIR/hub" config user.email "221775936+bodencrouch@users.noreply.github.com"
git -C "$WORKDIR/hub" config user.name "bodencrouch"
git -C "$WORKDIR/hub" add "data/cloudflare-one-warp.yml"
if git -C "$WORKDIR/hub" diff --cached --quiet; then echo "No AppImageHub changes."; exit 0; fi
git -C "$WORKDIR/hub" commit -m "Add Cloudflare One WARP ${VERSION}"
git -C "$WORKDIR/hub" push --force-with-lease origin "$BRANCH"

if command -v gh >/dev/null 2>&1; then
  GH_TOKEN="$GH_PAT" gh pr create \
    --repo AppImage/appimage.github.io \
    --head "${HUB_FORK%%/*}:${BRANCH}" \
    --base master \
    --title "Add Cloudflare One WARP ${VERSION}" \
    --body "Listing for ${BASE}" \
    || echo "PR may already exist."
fi
