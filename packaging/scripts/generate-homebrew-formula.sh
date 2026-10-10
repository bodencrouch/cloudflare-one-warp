#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -p "require('${ROOT}/package.json').version")}"
OUT="${ROOT}/homebrew-tap/Formula/cloudflare-one-warp.rb"
TEMPLATE="${ROOT}/packaging/homebrew/cloudflare-one-warp.rb.in"
TARBALL="${ROOT}/dist/packages/cloudflare-one-warp-${VERSION}-src.tar.gz"
TAG="v${VERSION}"

mkdir -p "$(dirname "$OUT")"
URL="https://github.com/bodencrouch/cloudflare-one-warp/releases/download/${TAG}/cloudflare-one-warp-${VERSION}-src.tar.gz"
SHA256="$(sha256sum "$TARBALL" | awk '{print $1}')"

sed -e "s|__URL__|${URL}|g" -e "s|__SHA256__|${SHA256}|g" "$TEMPLATE" > "$OUT"
echo "Wrote ${OUT}"
