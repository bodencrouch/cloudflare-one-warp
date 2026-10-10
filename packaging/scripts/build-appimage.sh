#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -p "require('${ROOT}/package.json').version")}"
OUT="${ROOT}/dist/packages"
APPDIR="${ROOT}/dist/AppDir"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
ARCH="${APPIMAGE_ARCH:-x86_64}"

mkdir -p "$OUT"
export PACKAGE_VERSION="$VERSION"
bash "${ROOT}/packaging/scripts/stage-payload.sh"

rm -rf "$APPDIR"
mkdir -p "$APPDIR"
cp -a "${ROOT}/dist/payload/usr" "${APPDIR}/usr"

# Bundle official Node.js binary distribution.
node_tarball="node-v${NODE_VERSION}-linux-x64.tar.xz"
node_url="https://nodejs.org/dist/v${NODE_VERSION}/${node_tarball}"
node_sha256="c6fa75c841cbffac851678a472f2a5bd612fff8308ef39236190e1f8dbb0e567"
tmpdir="$(mktemp -d)"
curl --connect-timeout 30 --max-time 600 -fsSL "$node_url" -o "${tmpdir}/${node_tarball}"
echo "${node_sha256}  ${node_tarball}" | (cd "$tmpdir" && sha256sum -c -)
tar -xJf "${tmpdir}/${node_tarball}" -C "$tmpdir"
mkdir -p "${APPDIR}/usr/lib/cloudflare-one-warp/runtime"
mv "${tmpdir}/node-v${NODE_VERSION}-linux-x64" "${APPDIR}/usr/lib/cloudflare-one-warp/runtime/node"
rm -rf "$tmpdir"

install -m 0755 "${ROOT}/packaging/appimage/AppRun" "${APPDIR}/AppRun"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp.desktop" "${APPDIR}/cloudflare-one-warp.desktop"
sed -i 's|^Exec=.*|Exec=cloudflare-one-warp-tray|' "${APPDIR}/cloudflare-one-warp.desktop"
install -m 0644 "${ROOT}/assets/cloudflare-one-warp.svg" "${APPDIR}/cloudflare-one-warp.svg"
ln -sf cloudflare-one-warp.svg "${APPDIR}/.DirIcon"

tool_dir="$(mktemp -d)"
  curl --connect-timeout 30 --max-time 300 -fsSL -o "${tool_dir}/appimagetool" \
  "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
chmod +x "${tool_dir}/appimagetool"

# Extract appimagetool if FUSE is unavailable (common on CI).
if ! "${tool_dir}/appimagetool" --appimage-help >/dev/null 2>&1; then
  cd "$tool_dir"
  ./appimagetool --appimage-extract >/dev/null
  APPIMAGETOOL="${tool_dir}/squashfs-root/AppRun"
else
  APPIMAGETOOL="${tool_dir}/appimagetool"
fi

export ARCH
export VERSION
rm -f "${OUT}/cloudflare-one-warp-${VERSION}-${ARCH}.AppImage"
"$APPIMAGETOOL" "$APPDIR" "${OUT}/cloudflare-one-warp-${VERSION}-${ARCH}.AppImage"
chmod +x "${OUT}/cloudflare-one-warp-${VERSION}-${ARCH}.AppImage"
rm -rf "$tool_dir"
echo "Built ${OUT}/cloudflare-one-warp-${VERSION}-${ARCH}.AppImage"
