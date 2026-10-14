#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
OUT="${ROOT}/dist/packages"

mkdir -p "$OUT"
export PACKAGE_VERSION="$VERSION"
bash "${ROOT}/packaging/scripts/stage-payload.sh"

# Normalize archive metadata for repeatable builds from the same source commit.
epoch="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null || true)}"
tar_options=()
if [[ -n "$epoch" ]]; then
  [[ "$epoch" =~ ^[0-9]+$ ]] || { echo "Invalid SOURCE_DATE_EPOCH" >&2; exit 2; }
  if tar --help 2>/dev/null | grep -q -- --sort; then
    tar_options=(--sort=name "--mtime=@$epoch" --owner=0 --group=0 --numeric-owner)
  fi
fi

tar "${tar_options[@]}" -C "${ROOT}/dist/payload" -cf - . | gzip -n > "${OUT}/cloudflare-one-warp-${VERSION}.tar.gz"

# Source tree for AUR / manual builds, with the same secret exclusions as local installs.
source_stage="$(mktemp -d)"
trap 'rm -rf "$source_stage"' EXIT
bash "${ROOT}/packaging/scripts/stage-source.sh" "$source_stage"
tar "${tar_options[@]}" -C "$source_stage" -cf - . | gzip -n > "${OUT}/cloudflare-one-warp-${VERSION}-src.tar.gz"
source_sha="$(sha256sum "${OUT}/cloudflare-one-warp-${VERSION}-src.tar.gz" | awk '{print $1}')"
sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SOURCE_SHA256__/${source_sha}/g" \
  "${ROOT}/packaging/arch/PKGBUILD.in" > "${OUT}/PKGBUILD"

echo "Built source archives in ${OUT}"
