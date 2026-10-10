#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -p "require('${ROOT}/package.json').version")}"
OUT="${ROOT}/dist/packages"

mkdir -p "$OUT" "${ROOT}/snap"

if ! command -v snapcraft >/dev/null 2>&1; then
  echo "snapcraft is required to build the snap locally." >&2
  echo "In CI, snapcore/action-build uses snap/snapcraft.yaml." >&2
  exit 1
fi

sed "s/^version: .*/version: '${VERSION}'/" \
  "${ROOT}/packaging/snap/snapcraft.yaml" > "${ROOT}/snap/snapcraft.yaml"

(
  cd "$ROOT"
  snapcraft --destructive-mode --verbose
)

shopt -s nullglob
snaps=( "${ROOT}"/*.snap )
if ((${#snaps[@]} == 0)); then
  echo "No .snap artifact found after snapcraft." >&2
  exit 1
fi

for snap in "${snaps[@]}"; do
  dest="${OUT}/cloudflare-one-warp_${VERSION}_amd64.snap"
  mv -f "$snap" "$dest"
  echo "Built $dest"
done
