#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT}/scripts/lib/common.sh"

INSTALL_DIR="$(cloudflare_one_warp_default_install_dir)"
LOCAL_BIN="$(cloudflare_one_warp_local_bin_dir)"
APPLICATIONS_DIR="$(cloudflare_one_warp_applications_dir)"
SYSTEMD_USER_DIR="$(cloudflare_one_warp_systemd_user_dir)"
REMOVE_TREE=0

usage() {
  cat <<USAGE
Remove a local Cloudflare One WARP user install.

Usage:
  $(basename "$0") [options]

Options:
  --install-dir PATH   Install root to remove (default: ~/.local/share/cloudflare-one-warp)
  --purge              Also delete the install tree
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="${2:?--install-dir requires a path}"
      shift 2
      ;;
    --purge)
      REMOVE_TREE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cloudflare_one_warp_validate_install_dir "$INSTALL_DIR"
INSTALL_DIR="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$INSTALL_DIR")"

for unit in cloudflare-one-warp.service cloudflare-one-gui.service; do
  unit_file="${SYSTEMD_USER_DIR}/${unit}"
  if [[ ! -f "$unit_file" ]] || ! { grep -Fq -- "$INSTALL_DIR" "$unit_file" || grep -Fq -- "${INSTALL_DIR//%/%%}" "$unit_file"; }; then
    continue
  fi
  if systemctl --user --quiet is-active "$unit" >/dev/null 2>&1; then
    systemctl --user stop "$unit" || true
  fi
  if systemctl --user --quiet is-enabled "$unit" >/dev/null 2>&1; then
    systemctl --user disable "$unit" || true
  fi
  rm -f "${SYSTEMD_USER_DIR}/${unit}"
done

for desktop in cloudflare-one-warp.desktop cloudflare-one-gui.desktop cloudflare-one-warp-settings.desktop; do
  desktop_file="${APPLICATIONS_DIR}/${desktop}"
  if [[ -f "$desktop_file" ]] && { grep -Fq -- "$INSTALL_DIR" "$desktop_file" || grep -Fq -- "${INSTALL_DIR//%/%%}" "$desktop_file"; }; then
    rm -f "$desktop_file"
  fi
done

if [[ -f "${INSTALL_DIR}/scripts/tray-shell-cli.mjs" ]]; then
  node "${INSTALL_DIR}/scripts/tray-shell-cli.mjs" stop-cloudflare-one-warp >/dev/null 2>&1 || true
fi

AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
tray_autostart="${AUTOSTART_DIR}/cloudflare-one-warp-tray.desktop"
if [[ -f "$tray_autostart" ]] && grep -Fq -- "$INSTALL_DIR" "$tray_autostart"; then
  rm -f "$tray_autostart"
fi
# The Hidden override is the marker that Cloudflare One WARP took over the desktop app.
# It hid Cloudflare's autostart and disabled its service in the same step, so
# hand both back — otherwise Cloudflare One Client returns at next login with no
# background service and no sign of why.
CF_OVERRIDE="${AUTOSTART_DIR}/com.cloudflare.WarpTaskbar.desktop"
if [[ -f "$CF_OVERRIDE" ]] && grep -q "Managed by Cloudflare One WARP" "$CF_OVERRIDE"; then
  rm -f "$CF_OVERRIDE"
  if [[ -f /usr/lib/systemd/user/warp-desktop-svc.service ]]; then
    systemctl --user enable --now warp-desktop-svc.service >/dev/null 2>&1 || true
    echo "Restored Cloudflare One Client autostart and warp-desktop-svc.service."
  else
    echo "Restored Cloudflare One Client autostart."
  fi
fi

# Keep the fallback unit: it runs Cloudflare's own warp-desktop-svc, and on hosts
# whose WARP package ships no unit it is the only thing starting that service.
WARP_SVC_UNIT="${SYSTEMD_USER_DIR}/cloudflare-one-warp-desktop-svc.service"
if [[ -f "$WARP_SVC_UNIT" ]]; then
  echo "Left ${WARP_SVC_UNIT} in place — it starts Cloudflare One Client's background service."
  echo "  Remove it with: systemctl --user disable --now cloudflare-one-warp-desktop-svc.service && rm ${WARP_SVC_UNIT}"
fi

for link in cloudflare-one-warp cloudflare-one-warp-tray; do
  if [[ -L "${LOCAL_BIN}/${link}" && "$(readlink "${LOCAL_BIN}/${link}")" == "$INSTALL_DIR/bin/$link" ]]; then
    rm -f "${LOCAL_BIN}/${link}"
  fi
done

if [[ "$REMOVE_TREE" -eq 1 && -d "$INSTALL_DIR" ]]; then
  if [[ -f "$INSTALL_DIR/scripts/proxy-launcher-cleanup.mjs" ]]; then
    node "$INSTALL_DIR/scripts/proxy-launcher-cleanup.mjs"
  fi
  rm -rf "$INSTALL_DIR"
  echo "Removed install tree ${INSTALL_DIR}"
fi

if systemctl --user daemon-reload >/dev/null 2>&1; then
  echo "Reloaded user systemd manager."
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

echo "Removed Cloudflare One WARP user integration."
