#!/usr/bin/env bash
# Upload built snap to Snap Store (requires SNAPCRAFT_STORE_CREDENTIALS).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('${ROOT}/package.json').version")}"
SNAP="${ROOT}/dist/packages/cloudflare-one-warp_${VERSION}_amd64.snap"

if [[ ! -f "$SNAP" ]]; then
  echo "Snap not found: $SNAP" >&2
  exit 1
fi

if [[ -z "${SNAPCRAFT_STORE_CREDENTIALS:-}" ]]; then
  echo "SNAPCRAFT_STORE_CREDENTIALS is not set." >&2
  echo "Export with: snapcraft export-login - | base64 -w0" >&2
  exit 1
fi

CREDS="$(mktemp)"
trap 'rm -f "$CREDS"' EXIT
echo "$SNAPCRAFT_STORE_CREDENTIALS" | base64 -d > "$CREDS"
export SNAPCRAFT_STORE_CREDENTIALS_FILE="$CREDS"

if ! command -v snapcraft >/dev/null 2>&1; then
  echo "Installing snapcraft..."
  sudo snap install snapcraft --classic
fi

echo "Uploading $SNAP ..."
snapcraft upload "$SNAP" --release=stable
echo "Published cloudflare-one-warp ${VERSION} to Snap Store (stable)."
