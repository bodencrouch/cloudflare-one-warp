#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
DIST="${ROOT}/dist"
PAYLOAD="${PAYLOAD_DIR:-${DIST}/payload}"
LIB="${PAYLOAD}/usr/lib/cloudflare-one-warp"

# Native bundles must apply the same credential exclusions as source/Snap/Flatpak.
SOURCE_STAGE="$(mktemp -d)"
trap 'rm -rf "$SOURCE_STAGE"' EXIT
bash "${ROOT}/packaging/scripts/stage-source.sh" "$SOURCE_STAGE"

rm -rf "$PAYLOAD"
mkdir -p \
  "$LIB" \
  "${LIB}/lib" \
  "${PAYLOAD}/usr/bin" \
  "${PAYLOAD}/usr/share/applications" \
  "${PAYLOAD}/usr/share/icons/hicolor/scalable/apps" \
  "${PAYLOAD}/usr/lib/systemd/user" \
  "${PAYLOAD}/usr/share/doc/cloudflare-one-warp" \
  "${PAYLOAD}/usr/share/licenses/cloudflare-one-warp" \
  "${PAYLOAD}/usr/share/polkit-1/actions" \
  "${PAYLOAD}/etc/cloudflare-one-warp" \
  "${PAYLOAD}/etc/default"

install -m 0644 "${ROOT}/server.js" "${LIB}/server.js"
install -m 0644 "${ROOT}/package.json" "${LIB}/package.json"
cp -a "${SOURCE_STAGE}/lib/." "${LIB}/lib/"
mkdir -p "${LIB}/config"
install -m 0644 "${ROOT}/config/config.example.json" "${PAYLOAD}/etc/cloudflare-one-warp/config.json.example"
install -m 0644 "${ROOT}/config/update-manifest.json" "${LIB}/config/update-manifest.json"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp.default" "${PAYLOAD}/etc/default/cloudflare-one-warp"
install -m 0644 "${ROOT}/README.md" "${PAYLOAD}/usr/share/doc/cloudflare-one-warp/README.md"
install -m 0644 "${ROOT}/LICENSE" "${PAYLOAD}/usr/share/licenses/cloudflare-one-warp/LICENSE"
install -m 0644 "${ROOT}/CHANGELOG.md" "${PAYLOAD}/usr/share/doc/cloudflare-one-warp/CHANGELOG.md"
install -m 0644 "${ROOT}/SECURITY.md" "${PAYLOAD}/usr/share/doc/cloudflare-one-warp/SECURITY.md"

cp -a "${SOURCE_STAGE}/public" "${LIB}/public"
cp -a "${SOURCE_STAGE}/assets" "${LIB}/assets"
mkdir -p "${LIB}/scripts" "${LIB}/bin"
install -m 0755 "${ROOT}/scripts/health-check.mjs" "${LIB}/scripts/health-check.mjs"
install -m 0755 "${ROOT}/scripts/daemon-ready.mjs" "${LIB}/scripts/daemon-ready.mjs"
install -m 0755 "${ROOT}/scripts/port-open.mjs" "${LIB}/scripts/port-open.mjs"
install -m 0755 "${ROOT}/scripts/cloudflare-one-warp-nft-apply" "${LIB}/scripts/cloudflare-one-warp-nft-apply"
install -m 0755 "${ROOT}/scripts/health-webui-check.mjs" "${LIB}/scripts/health-webui-check.mjs"
install -m 0755 "${ROOT}/scripts/webui-handoff.mjs" "${LIB}/scripts/webui-handoff.mjs"
install -m 0755 "${ROOT}/scripts/proxy-launcher-cleanup.mjs" "${LIB}/scripts/proxy-launcher-cleanup.mjs"
install -m 0755 "${ROOT}/scripts/tray-settings.py" "${LIB}/scripts/tray-settings.py"
install -m 0755 "${ROOT}/scripts/tray-qt.py" "${LIB}/scripts/tray-qt.py"
install -m 0755 "${ROOT}/scripts/tray-sni.py" "${LIB}/scripts/tray-sni.py"
install -m 0755 "${ROOT}/scripts/tray_workers.py" "${LIB}/scripts/tray_workers.py"
install -m 0755 "${ROOT}/scripts/tray_api.py" "${LIB}/scripts/tray_api.py"
install -m 0755 "${ROOT}/scripts/tray-warp-action.py" "${LIB}/scripts/tray-warp-action.py"
install -m 0755 "${ROOT}/scripts/tray-shell-cli.mjs" "${LIB}/scripts/tray-shell-cli.mjs"
install -m 0755 "${ROOT}/scripts/sync-tray-autostart.mjs" "${LIB}/scripts/sync-tray-autostart.mjs"
install -m 0755 "${ROOT}/scripts/sync-nm-profiles.mjs" "${LIB}/scripts/sync-nm-profiles.mjs"
install -m 0755 "${ROOT}/scripts/cloudflare-one-warp-nm" "${LIB}/scripts/cloudflare-one-warp-nm"
install -m 0755 "${ROOT}/scripts/cloudflare-one-warp-connect" "${LIB}/scripts/cloudflare-one-warp-connect"
install -m 0755 "${ROOT}/scripts/cloudflare-one-warp-kde-proxy-sync" "${LIB}/scripts/cloudflare-one-warp-kde-proxy-sync"
install -m 0755 "${ROOT}/bin/cloudflare-one-warp" "${LIB}/bin/cloudflare-one-warp"
install -m 0755 "${ROOT}/bin/cloudflare-one-warp-tray" "${LIB}/bin/cloudflare-one-warp-tray"
install -m 0755 "${ROOT}/bin/cloudflare-one-warp-gui" "${LIB}/bin/cloudflare-one-warp-gui"

install -m 0755 "${ROOT}/packaging/usr-bin-wrapper.sh" "${PAYLOAD}/usr/bin/cloudflare-one-warp"
install -m 0755 "${ROOT}/packaging/usr-bin-alias-wrapper.sh" "${PAYLOAD}/usr/bin/cloudflare-one-warp-gui"
install -m 0755 "${ROOT}/packaging/usr-bin-tray-wrapper.sh" "${PAYLOAD}/usr/bin/cloudflare-one-warp-tray"
install -m 0644 "${ROOT}/packaging/polkit/com.cloudflare.one.warp.policy" \
  "${PAYLOAD}/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp.desktop" \
  "${PAYLOAD}/usr/share/applications/cloudflare-one-warp.desktop"
install -m 0644 "${ROOT}/assets/cloudflare-one-warp.svg" \
  "${PAYLOAD}/usr/share/icons/hicolor/scalable/apps/cloudflare-one-warp.svg"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp-tray.desktop" \
  "${PAYLOAD}/usr/share/applications/cloudflare-one-warp-tray.desktop"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp-settings.desktop" \
  "${PAYLOAD}/usr/share/applications/cloudflare-one-warp-settings.desktop"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp.service" \
  "${PAYLOAD}/usr/lib/systemd/user/cloudflare-one-warp.service"

mkdir -p \
  "${PAYLOAD}/usr/share/cloudflare-one-warp/networkmanager/profiles" \
  "${PAYLOAD}/etc/NetworkManager/dispatcher.d" \
  "${PAYLOAD}/etc/sysctl.d"
install -m 0755 "${ROOT}/packaging/networkmanager/99-cloudflare-one-warp" \
  "${PAYLOAD}/etc/NetworkManager/dispatcher.d/99-cloudflare-one-warp"
install -m 0644 "${ROOT}/packaging/sysctl/99-cloudflare-one-warp.conf" \
  "${PAYLOAD}/etc/sysctl.d/99-cloudflare-one-warp.conf"
CLOUDFLARE_ONE_WARP_NM_SHARE="${PAYLOAD}/usr/share/cloudflare-one-warp/networkmanager/profiles" \
CLOUDFLARE_ONE_WARP_NM_USER="${PAYLOAD}/usr/share/cloudflare-one-warp/networkmanager/profiles" \
  node "${ROOT}/scripts/sync-nm-profiles.mjs"

if [[ -z "${PAYLOAD_DIR:-}" ]]; then
  printf '%s\n' "$VERSION" > "${DIST}/VERSION"
fi
echo "Staged payload at ${PAYLOAD} (version ${VERSION})"
