#!/usr/bin/env bash
# Push packaging/aur/PKGBUILD to AUR (requires AUR_SSH_PRIVATE_KEY).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('${ROOT}/package.json').version")}"
AUR_DIR="$(mktemp -d)"
AUR_PKG="${AUR_PACKAGE_NAME:-cloudflare-one-warp}"
AUR_REMOTE="${AUR_REMOTE:-ssh://aur.archlinux.org/${AUR_PKG}.git}"

cleanup() {
  rm -rf "$AUR_DIR"
  [[ -n "${KEY_FILE:-}" ]] && rm -f "$KEY_FILE"
}
trap cleanup EXIT

if [[ -z "${AUR_SSH_PRIVATE_KEY:-}" ]]; then
  echo "AUR_SSH_PRIVATE_KEY is not set." >&2
  exit 1
fi

KEY_FILE="$(mktemp)"
echo "$AUR_SSH_PRIVATE_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"
export GIT_SSH_COMMAND="ssh -i ${KEY_FILE} -o StrictHostKeyChecking=accept-new"

sed "s/^pkgver=.*/pkgver=${VERSION}/" "${ROOT}/packaging/aur/PKGBUILD" > "${AUR_DIR}/PKGBUILD"

(
  cd "$AUR_DIR"
  if command -v makepkg >/dev/null 2>&1; then
    makepkg --printsrcinfo > .SRCINFO
  else
    echo "makepkg not found; copying template .SRCINFO (install makepkg for accurate .SRCINFO)" >&2
    cp "${ROOT}/packaging/aur/.SRCINFO" .SRCINFO 2>/dev/null || true
  fi
)

if git clone "$AUR_REMOTE" "$AUR_DIR/repo" 2>/dev/null; then
  :
else
  mkdir -p "$AUR_DIR/repo"
  git -C "$AUR_DIR/repo" init
  git -C "$AUR_DIR/repo" remote add origin "$AUR_REMOTE"
fi

cp "${AUR_DIR}/PKGBUILD" "$AUR_DIR/repo/"
[[ -f "${AUR_DIR}/.SRCINFO" ]] && cp "${AUR_DIR}/.SRCINFO" "$AUR_DIR/repo/"

git -C "$AUR_DIR/repo" config user.email "${AUR_GIT_EMAIL:-cloudflare-one-warp@users.noreply.github.com}"
git -C "$AUR_DIR/repo" config user.name "${AUR_GIT_NAME:-Cloudflare One WARP Release Bot}"
git -C "$AUR_DIR/repo" add PKGBUILD .SRCINFO
git -C "$AUR_DIR/repo" commit -m "release: cloudflare-one-warp ${VERSION}" || { echo "No AUR changes to push."; exit 0; }
git -C "$AUR_DIR/repo" push origin master
echo "Published cloudflare-one-warp ${VERSION} to AUR."
