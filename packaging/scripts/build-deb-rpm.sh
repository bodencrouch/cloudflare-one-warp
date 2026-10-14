#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
FORMAT="${1:-}"
VERSION="${PACKAGE_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
OUT="${ROOT}/dist/packages"
NFPM_VERSION="${NFPM_VERSION:-2.41.3}"

if [[ -z "$FORMAT" ]]; then
  echo "Usage: $0 <deb|rpm|arch|all>" >&2
  exit 2
fi

mkdir -p "$OUT"
export PACKAGE_VERSION="$VERSION"
bash "${ROOT}/packaging/scripts/stage-payload.sh"

if ! command -v nfpm >/dev/null 2>&1; then
  echo "Installing nfpm ${NFPM_VERSION}..."
  tmp="$(mktemp -d)"
  nfpm_sha256="${NFPM_SHA256:-22aa6d3bc2ec239d62d3d190bcb036a47f2b24e0c3c6edfccebb6a55fbb2078e}"
  if [[ "$NFPM_VERSION" != "2.41.3" && -z "${NFPM_SHA256:-}" ]]; then
    echo "NFPM_SHA256 is required when overriding NFPM_VERSION" >&2; exit 1
  fi
  curl --connect-timeout 30 --max-time 300 -fsSL "https://github.com/goreleaser/nfpm/releases/download/v${NFPM_VERSION}/nfpm_${NFPM_VERSION}_Linux_x86_64.tar.gz" -o "$tmp/nfpm.tar.gz"
  printf '%s  %s\n' "$nfpm_sha256" "$tmp/nfpm.tar.gz" | sha256sum -c -
  tar -xzf "$tmp/nfpm.tar.gz" -C "$tmp" nfpm
  install -m 0755 "${tmp}/nfpm" /usr/local/bin/nfpm 2>/dev/null \
    || install -m 0755 "${tmp}/nfpm" "${HOME}/.local/bin/nfpm"
  export PATH="${HOME}/.local/bin:${PATH}"
  rm -rf "$tmp"
fi

# Expand ${VERSION} for nfpm (it does not expand env by default unless templated).
cfg="$(mktemp)"
sed "s/\${VERSION}/${VERSION}/g" "${ROOT}/packaging/nfpm.yaml" > "$cfg"

pack() {
  local packager="$1"
  local target="$2"
  (cd "$ROOT" && VERSION="$VERSION" nfpm package --config "$cfg" --packager "$packager" --target "$target")
  echo "Built $target"
}

case "$FORMAT" in
  deb)
    pack deb "${OUT}/cloudflare-one-warp_${VERSION}_all.deb"
    ;;
  rpm)
    pack rpm "${OUT}/cloudflare-one-warp-${VERSION}-1.noarch.rpm"
    ;;
  arch)
    pack archlinux "${OUT}/cloudflare-one-warp-${VERSION}-1-any.pkg.tar.zst"
    ;;
  all)
    pack deb "${OUT}/cloudflare-one-warp_${VERSION}_all.deb"
    pack rpm "${OUT}/cloudflare-one-warp-${VERSION}-1.noarch.rpm"
    pack archlinux "${OUT}/cloudflare-one-warp-${VERSION}-1-any.pkg.tar.zst"
    ;;
  *)
    echo "Unknown format: $FORMAT" >&2
    rm -f "$cfg"
    exit 2
    ;;
esac

rm -f "$cfg"
