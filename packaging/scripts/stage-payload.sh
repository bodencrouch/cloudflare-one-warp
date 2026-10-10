#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${PACKAGE_VERSION:-$(node -p "require('${ROOT}/package.json').version")}"
DIST="${ROOT}/dist"
PAYLOAD="${DIST}/payload"
LIB="${PAYLOAD}/usr/lib/cloudflare-one-warp"

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
mkdir -p "${LIB}/lib/update" "${LIB}/lib/warp" "${LIB}/lib/notify" "${LIB}/lib/killswitch" "${LIB}/lib/tray" "${LIB}/lib/apps" "${LIB}/lib/networkmanager" "${LIB}/lib/http" "${LIB}/lib/readiness" "${LIB}/config"
install -m 0644 "${ROOT}/lib/config.mjs" "${LIB}/lib/config.mjs"
install -m 0644 "${ROOT}/lib/version.mjs" "${LIB}/lib/version.mjs"
install -m 0644 "${ROOT}/lib/api-revision.mjs" "${LIB}/lib/api-revision.mjs"
install -m 0644 "${ROOT}/lib/http/request-gate.mjs" "${LIB}/lib/http/request-gate.mjs"
install -m 0644 "${ROOT}/lib/readiness/index.mjs" "${LIB}/lib/readiness/index.mjs"
install -m 0644 "${ROOT}/lib/tray/autostart.mjs" "${LIB}/lib/tray/autostart.mjs"
install -m 0644 "${ROOT}/lib/tray/shell.mjs" "${LIB}/lib/tray/shell.mjs"
install -m 0644 "${ROOT}/lib/warp/status.mjs" "${LIB}/lib/warp/status.mjs"
install -m 0644 "${ROOT}/lib/warp/settings.mjs" "${LIB}/lib/warp/settings.mjs"
install -m 0644 "${ROOT}/lib/warp/split-tunnel.mjs" "${LIB}/lib/warp/split-tunnel.mjs"
install -m 0644 "${ROOT}/lib/warp/status-listener.mjs" "${LIB}/lib/warp/status-listener.mjs"
install -m 0644 "${ROOT}/lib/warp/command-log.mjs" "${LIB}/lib/warp/command-log.mjs"
install -m 0644 "${ROOT}/lib/apps/proxy-launcher.mjs" "${LIB}/lib/apps/proxy-launcher.mjs"
install -m 0644 "${ROOT}/lib/networkmanager/profiles.mjs" "${LIB}/lib/networkmanager/profiles.mjs"
install -m 0644 "${ROOT}/lib/networkmanager/sync.mjs" "${LIB}/lib/networkmanager/sync.mjs"
install -m 0644 "${ROOT}/lib/warp/registration.mjs" "${LIB}/lib/warp/registration.mjs"
install -m 0644 "${ROOT}/lib/killswitch/rules.mjs" "${LIB}/lib/killswitch/rules.mjs"
install -m 0644 "${ROOT}/lib/killswitch/apply.mjs" "${LIB}/lib/killswitch/apply.mjs"
install -m 0644 "${ROOT}/lib/killswitch/enroll-pause.mjs" "${LIB}/lib/killswitch/enroll-pause.mjs"
install -m 0644 "${ROOT}/lib/killswitch/index.mjs" "${LIB}/lib/killswitch/index.mjs"
install -m 0644 "${ROOT}/lib/killswitch/nft-script-validate.mjs" "${LIB}/lib/killswitch/nft-script-validate.mjs"
install -m 0644 "${ROOT}/lib/notify/desktop.mjs" "${LIB}/lib/notify/desktop.mjs"
install -m 0644 "${ROOT}/lib/notify/status-watcher.mjs" "${LIB}/lib/notify/status-watcher.mjs"
install -m 0644 "${ROOT}/lib/update/semver.mjs" "${LIB}/lib/update/semver.mjs"
install -m 0644 "${ROOT}/lib/update/github.mjs" "${LIB}/lib/update/github.mjs"
install -m 0644 "${ROOT}/lib/update/manifest.mjs" "${LIB}/lib/update/manifest.mjs"
install -m 0644 "${ROOT}/lib/update/detect-format.mjs" "${LIB}/lib/update/detect-format.mjs"
install -m 0644 "${ROOT}/lib/update/confirm.mjs" "${LIB}/lib/update/confirm.mjs"
install -m 0644 "${ROOT}/lib/update/apply-appimage.mjs" "${LIB}/lib/update/apply-appimage.mjs"
install -m 0644 "${ROOT}/lib/update/verify-signature.mjs" "${LIB}/lib/update/verify-signature.mjs"
install -m 0644 "${ROOT}/lib/update/trusted-keys.mjs" "${LIB}/lib/update/trusted-keys.mjs"
install -m 0644 "${ROOT}/lib/update/index.mjs" "${LIB}/lib/update/index.mjs"
install -m 0644 "${ROOT}/config/config.example.json" "${PAYLOAD}/etc/cloudflare-one-warp/config.json.example"
install -m 0644 "${ROOT}/config/update-manifest.json" "${LIB}/config/update-manifest.json"
install -m 0644 "${ROOT}/packaging/cloudflare-one-warp.default" "${PAYLOAD}/etc/default/cloudflare-one-warp"
install -m 0644 "${ROOT}/README.md" "${PAYLOAD}/usr/share/doc/cloudflare-one-warp/README.md"
install -m 0644 "${ROOT}/LICENSE" "${PAYLOAD}/usr/share/licenses/cloudflare-one-warp/LICENSE"
install -m 0644 "${ROOT}/CHANGELOG.md" "${PAYLOAD}/usr/share/doc/cloudflare-one-warp/CHANGELOG.md"

cp -a "${ROOT}/public" "${LIB}/public"
cp -a "${ROOT}/assets" "${LIB}/assets"
mkdir -p "${LIB}/scripts" "${LIB}/bin"
install -m 0755 "${ROOT}/scripts/health-check.mjs" "${LIB}/scripts/health-check.mjs"
install -m 0755 "${ROOT}/scripts/daemon-ready.mjs" "${LIB}/scripts/daemon-ready.mjs"
install -m 0755 "${ROOT}/scripts/port-open.mjs" "${LIB}/scripts/port-open.mjs"
install -m 0755 "${ROOT}/scripts/cloudflare-one-warp-nft-apply" "${LIB}/scripts/cloudflare-one-warp-nft-apply"
install -m 0755 "${ROOT}/scripts/health-webui-check.mjs" "${LIB}/scripts/health-webui-check.mjs"
install -m 0755 "${ROOT}/scripts/tray-settings.py" "${LIB}/scripts/tray-settings.py"
install -m 0755 "${ROOT}/scripts/tray-qt.py" "${LIB}/scripts/tray-qt.py"
install -m 0755 "${ROOT}/scripts/tray-sni.py" "${LIB}/scripts/tray-sni.py"
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
  "${PAYLOAD}/etc/sysctl.d" \
  "${PAYLOAD}/usr/lib/NetworkManager/VPN"
install -m 0755 "${ROOT}/packaging/networkmanager/99-cloudflare-one-warp" \
  "${PAYLOAD}/etc/NetworkManager/dispatcher.d/99-cloudflare-one-warp"
install -m 0644 "${ROOT}/packaging/sysctl/99-cloudflare-one-warp.conf" \
  "${PAYLOAD}/etc/sysctl.d/99-cloudflare-one-warp.conf"
install -m 0644 "${ROOT}/packaging/networkmanager/nm-cloudflare-one-warp-service.name" \
  "${PAYLOAD}/usr/lib/NetworkManager/VPN/nm-cloudflare-one-warp-service.name"
CLOUDFLARE_ONE_WARP_NM_SHARE="${PAYLOAD}/usr/share/cloudflare-one-warp/networkmanager/profiles" \
CLOUDFLARE_ONE_WARP_NM_USER="${PAYLOAD}/usr/share/cloudflare-one-warp/networkmanager/profiles" \
  node "${ROOT}/scripts/sync-nm-profiles.mjs"

printf '%s\n' "$VERSION" > "${DIST}/VERSION"
echo "Staged payload at ${PAYLOAD} (version ${VERSION})"
