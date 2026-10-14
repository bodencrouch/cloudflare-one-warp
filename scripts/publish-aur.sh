#!/usr/bin/env bash
# Push packaging/aur/PKGBUILD to AUR (requires AUR_SSH_PRIVATE_KEY).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
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

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid release version" >&2; exit 1; }
SOURCE_URL="https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v${VERSION}/cloudflare-one-warp-${VERSION}-src.tar.gz"
curl --fail --location --connect-timeout 30 --max-time 600 "$SOURCE_URL" -o "$AUR_DIR/source.tar.gz"
SOURCE_SHA="$(sha256sum "$AUR_DIR/source.tar.gz" | awk '{print $1}')"
sed -e "s/^pkgver=.*/pkgver=${VERSION}/" -e "s/^sha256sums=.*/sha256sums=('${SOURCE_SHA}')/" \
  "${ROOT}/packaging/aur/PKGBUILD" > "${AUR_DIR}/PKGBUILD"
if command -v makepkg >/dev/null 2>&1; then
  (cd "$AUR_DIR" && makepkg --printsrcinfo > .SRCINFO)
else
  command -v docker >/dev/null || { echo "makepkg or Docker with Arch Linux is required" >&2; exit 1; }
  docker run --rm -v "$AUR_DIR:/work" archlinux:base-devel bash -euc \
    'useradd -m builder; chown -R builder /work; su builder -c "cd /work && makepkg --printsrcinfo > .SRCINFO"'
fi
test -s "$AUR_DIR/.SRCINFO"
grep -F "pkgver = $VERSION" "$AUR_DIR/.SRCINFO" >/dev/null
grep -F "sha256sums = $SOURCE_SHA" "$AUR_DIR/.SRCINFO" >/dev/null

if git clone "$AUR_REMOTE" "$AUR_DIR/repo" 2>/dev/null; then
  :
else
  mkdir -p "$AUR_DIR/repo"
  git -C "$AUR_DIR/repo" init
  git -C "$AUR_DIR/repo" remote add origin "$AUR_REMOTE"
fi

cp "${AUR_DIR}/PKGBUILD" "$AUR_DIR/repo/"
cp "${AUR_DIR}/.SRCINFO" "$AUR_DIR/repo/"

git -C "$AUR_DIR/repo" config user.email "221775936+bodencrouch@users.noreply.github.com"
git -C "$AUR_DIR/repo" config user.name "bodencrouch"
git -C "$AUR_DIR/repo" add PKGBUILD .SRCINFO
if git -C "$AUR_DIR/repo" diff --cached --quiet; then echo "No AUR changes to push."; exit 0; fi
git -C "$AUR_DIR/repo" commit -m "release: cloudflare-one-warp ${VERSION}"
git -C "$AUR_DIR/repo" push origin master
echo "Published cloudflare-one-warp ${VERSION} to AUR."
