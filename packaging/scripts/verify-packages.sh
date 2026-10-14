#!/usr/bin/env bash
# Verify built Linux packages exist and have expected contents.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ROOT}/dist/packages"
VERSION="${PACKAGE_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${ROOT}/package.json")}"
SCOPE="${1:-all}"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing artifact: $path" >&2
    exit 1
  fi
  echo "OK $path ($(du -h "$path" | awk '{print $1}'))"
}

verify_deb_rpm() {
  local deb="${OUT}/cloudflare-one-warp_${VERSION}_all.deb"
  local rpm="${OUT}/cloudflare-one-warp-${VERSION}-1.noarch.rpm"
  local arch="${OUT}/cloudflare-one-warp-${VERSION}-1-any.pkg.tar.zst"

  require_file "$deb"
  require_file "$rpm"
  require_file "$arch"

  dpkg-deb -I "$deb" >/dev/null
  deb_contents="$(dpkg-deb -c "$deb")"
  grep -q '/usr/lib/cloudflare-one-warp/server.js' <<<"$deb_contents"
  grep -q '/usr/bin/cloudflare-one-warp' <<<"$deb_contents"
  grep -q '/usr/bin/cloudflare-one-warp-tray' <<<"$deb_contents"
  grep -q '/usr/lib/cloudflare-one-warp/scripts/tray-qt.py' <<<"$deb_contents"
  grep -q '/usr/lib/cloudflare-one-warp/scripts/cloudflare-one-warp-nft-apply' <<<"$deb_contents"
  grep -q '/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy' <<<"$deb_contents"

  rpm -qip "$rpm" >/dev/null
  rpm_list="$(rpm -qlp "$rpm")"
  grep -q '/usr/lib/cloudflare-one-warp/server.js' <<<"$rpm_list"
  grep -q '/usr/bin/cloudflare-one-warp-tray' <<<"$rpm_list"
  grep -q '/usr/lib/cloudflare-one-warp/scripts/tray-qt.py' <<<"$rpm_list"

  if command -v tar >/dev/null 2>&1; then
    arch_contents="$(tar -tf "$arch")"
    grep -q 'cloudflare-one-warp' <<<"$arch_contents"
  fi

  if command -v docker >/dev/null 2>&1; then
    echo "Smoke installing .deb in container with Node 24..."
    docker run --rm -v "${deb}:/pkg.deb:ro" node:24-bookworm-slim bash -euxo pipefail -c '
      apt-get update
      apt-get install -y --no-install-recommends ca-certificates curl
      dpkg --force-depends -i /pkg.deb
      test -x /usr/bin/cloudflare-one-warp
      test -f /usr/lib/cloudflare-one-warp/server.js
      PORT=4173 node /usr/lib/cloudflare-one-warp/server.js &
      pid=$!
      sleep 2
      curl -fsS http://127.0.0.1:4173/api/health | grep -q cloudflare-one-warp
      kill $pid
    '
  else
    echo "docker not available; skipping deb install smoke"
  fi
}

verify_extracted_tree() {
  local app="$1" helper
  for helper in server.js package.json scripts/tray-qt.py scripts/webui-handoff.mjs scripts/proxy-launcher-cleanup.mjs scripts/cloudflare-one-warp-nft-apply lib/tray/autostart.mjs; do
    test -f "$app/$helper" || { echo "Missing package payload: $helper" >&2; return 1; }
  done
  node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1])); if(p.name!=="cloudflare-one-warp" || p.version!==process.argv[2]) process.exit(1)' "$app/package.json" "$VERSION"
}

verify_appimage() (
  local appimage="${OUT}/cloudflare-one-warp-${VERSION}-x86_64.AppImage" extracted
  require_file "$appimage"
  file "$appimage" | grep -Eiq 'ELF.*executable'
  chmod +x "$appimage"
  extracted="$(mktemp -d)"
  trap 'rm -rf "$extracted"' EXIT
  # --appimage-extract never needs FUSE. Failure indicates an invalid bundle.
  (cd "$extracted" && "$appimage" --appimage-extract >/dev/null)
  verify_extracted_tree "$extracted/squashfs-root/usr/lib/cloudflare-one-warp"
  test -f "$extracted/squashfs-root/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy"
)

verify_flatpak() (
  local bundle="${OUT}/cloudflare-one-warp-${VERSION}-x86_64.flatpak" extracted repo ref helper
  require_file "$bundle"
  command -v flatpak >/dev/null || { echo "flatpak is required for bundle verification" >&2; exit 1; }
  command -v ostree >/dev/null || { echo "ostree is required for bundle verification" >&2; exit 1; }
  extracted="$(mktemp -d)"
  trap 'rm -rf "$extracted"' EXIT
  repo="$extracted/repo"
  ostree --repo="$repo" init --mode=archive-z2
  flatpak build-import-bundle "$repo" "$bundle"
  ref="$(ostree --repo="$repo" refs)"
  [[ "$ref" =~ ^app/io\.github\.bodencrouch\.CloudflareOneWarp/x86_64/(stable|master)$ ]]
  for helper in server.js package.json scripts/tray-qt.py scripts/webui-handoff.mjs scripts/proxy-launcher-cleanup.mjs scripts/cloudflare-one-warp-nft-apply lib/tray/autostart.mjs; do
    ostree --repo="$repo" ls "$ref" "/files/lib/cloudflare-one-warp/$helper" >/dev/null
  done
  ostree --repo="$repo" cat "$ref" /files/lib/cloudflare-one-warp/package.json > "$extracted/package.json"
  node -e 'const p=require(process.argv[1]); if(p.name!=="cloudflare-one-warp" || p.version!==process.argv[2]) process.exit(1)' "$extracted/package.json" "$VERSION"
)

verify_snap() (
  local snap="${OUT}/cloudflare-one-warp_${VERSION}_amd64.snap" extracted
  require_file "$snap"
  command -v unsquashfs >/dev/null || { echo "squashfs-tools is required for snap verification" >&2; exit 1; }
  extracted="$(mktemp -d)"
  trap 'rm -rf "$extracted"' EXIT
  unsquashfs -no-progress -d "$extracted/tree" "$snap" >/dev/null
  verify_extracted_tree "$extracted/tree/usr/lib/cloudflare-one-warp"
  test -x "$extracted/tree/node-runtime/bin/node"
  test -x "$extracted/tree/bin/cloudflare-one-warp"
)

case "$SCOPE" in
  deb-rpm|deb|rpm)
    verify_deb_rpm
    ;;
  appimage)
    verify_appimage
    ;;
  flatpak)
    verify_flatpak
    ;;
  snap)
    verify_snap
    ;;
  all)
    verify_deb_rpm
    verify_appimage
    verify_flatpak
    verify_snap
    ;;
  *)
    echo "Usage: $0 [all|deb-rpm|appimage|flatpak|snap]" >&2
    exit 2
    ;;
esac

echo "Package verification passed for scope: $SCOPE"
