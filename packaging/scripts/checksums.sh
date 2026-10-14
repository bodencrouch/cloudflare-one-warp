#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
OUT="${ROOT}/dist/packages"

mkdir -p "$OUT"
cleanup_paths=()
cleanup_secrets() {
  if (( ${#cleanup_paths[@]} )); then rm -rf "${cleanup_paths[@]}"; fi
}
trap cleanup_secrets EXIT

# Optional GPG signing when GPG_PRIVATE_KEY / GPG_PASSPHRASE are provided.
if [[ -n "${GPG_PRIVATE_KEY:-}" ]]; then
  echo "Importing GPG key for package signing..."
  gnupg_home="$(mktemp -d)"
  cleanup_paths+=( "$gnupg_home" )
  export GNUPGHOME="$gnupg_home"
  printf '%s\n' "$GPG_PRIVATE_KEY" | gpg --batch --import
  # Signing individual packages is package-format specific; checksums remain the baseline.
  echo "GPG key imported. Attach signatures manually or extend this script per format."
fi

# AppImage self-update only installs builds carrying a detached Ed25519 signature
# from the pinned release key (lib/update/trusted-keys.mjs), so sign before hashing.
sign_appimages() {
  local -a images=()
  local image key_file="" cleanup_key=0
  shopt -s nullglob
  images=( "$OUT"/*.AppImage )
  shopt -u nullglob
  if (( ${#images[@]} == 0 )); then
    return 0
  fi

  if [[ -n "${CLOUDFLARE_ONE_WARP_SIGNING_KEY_PEM:-}" ]]; then
    key_file="$(mktemp)"
    cleanup_paths+=( "$key_file" )
    chmod 600 "$key_file"
    printf '%s\n' "$CLOUDFLARE_ONE_WARP_SIGNING_KEY_PEM" > "$key_file"
    cleanup_key=1
  elif [[ -n "${CLOUDFLARE_ONE_WARP_SIGNING_KEY:-}" ]]; then
    key_file="${CLOUDFLARE_ONE_WARP_SIGNING_KEY}"
  fi

  if [[ -n "$key_file" ]]; then
    node "${ROOT}/scripts/sign-release.mjs" sign --key "$key_file" "${images[@]}"
    (( cleanup_key )) && rm -f "$key_file"
  fi

  local -a missing=()
  for image in "${images[@]}"; do
    [[ -f "${image}.sig" ]] || missing+=( "$(basename "$image")" )
  done

  if (( ${#missing[@]} )); then
    if [[ "${CLOUDFLARE_ONE_WARP_ALLOW_UNSIGNED:-0}" == "1" ]]; then
      echo "WARNING: unsigned AppImage(s): ${missing[*]} — clients will refuse to self-update from this build." >&2
    else
      echo "ERROR: no release signature for: ${missing[*]}" >&2
      echo "Set CLOUDFLARE_ONE_WARP_SIGNING_KEY(_PEM) to sign, or CLOUDFLARE_ONE_WARP_ALLOW_UNSIGNED=1 for a local build." >&2
      return 1
    fi
  fi
}

sign_appimages

# Emit the versioned recipe before hashing it.
source_archive="${OUT}/cloudflare-one-warp-${VERSION}-src.tar.gz"
if [[ -f "$source_archive" ]]; then
  source_sha="$(sha256sum "$source_archive" | awk '{print $1}')"
  sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SOURCE_SHA256__/${source_sha}/g" \
    "${ROOT}/packaging/arch/PKGBUILD.in" > "${OUT}/PKGBUILD"
fi

(
  cd "$OUT"
  shopt -s nullglob
  files=( *.deb *.rpm *.AppImage *.AppImage.sig *.flatpak *.snap *.pkg.tar.zst *.tar.gz *.cdx.json *.rb )
  [[ ! -f PKGBUILD ]] || files+=( PKGBUILD )
  if ((${#files[@]} == 0)); then
    echo "No package artifacts found in $OUT" >&2
    exit 1
  fi
  sha256sum "${files[@]}" | tee SHA256SUMS
)

echo "Wrote ${OUT}/PKGBUILD and ${OUT}/SHA256SUMS"
