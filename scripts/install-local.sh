#!/usr/bin/env bash
# Idempotent user install to a stable path (~/.local/share/cloudflare-one-warp by default).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT}/scripts/lib/common.sh"

INSTALL_DIR="$(cloudflare_one_warp_default_install_dir)"
LOCAL_BIN="$(cloudflare_one_warp_local_bin_dir)"
APPLICATIONS_DIR="$(cloudflare_one_warp_applications_dir)"
SYSTEMD_USER_DIR="$(cloudflare_one_warp_systemd_user_dir)"
DESKTOP_FILE="${APPLICATIONS_DIR}/cloudflare-one-warp.desktop"
SERVICE_FILE="${SYSTEMD_USER_DIR}/cloudflare-one-warp.service"
WITH_DESKTOP=1
WITH_SERVICE=0
WITH_BIN_LINKS=1
TRAY_SHELL=cloudflare
TRAY_SHELL_EXPLICIT=0

usage() {
  cat <<USAGE
Install Cloudflare One WARP for the current user (idempotent).

Default layout:
  App tree:  \$CLOUDFLARE_ONE_WARP_HOME or ~/.local/share/cloudflare-one-warp
  CLI links: ~/.local/bin/{cloudflare-one-warp,cloudflare-one-warp,cloudflare-one-warp-tray}
  Desktop:   ~/.local/share/applications/cloudflare-one-warp.desktop
  Service:   ~/.config/systemd/user/cloudflare-one-warp.service (optional)

Usage:
  $(basename "$0") [options]

Options:
  --install-dir PATH   Override install root (also CLOUDFLARE_ONE_WARP_HOME)
  --desktop            Install desktop entry (default)
  --no-desktop         Skip desktop entry
  --service            Install/refresh user systemd unit
  --no-bin-links       Skip ~/.local/bin symlinks
  --shell cloudflare|cloudflare-one-warp
                       Desktop app at login (default: cloudflare). Cloudflare One
                       Client comes with WARP; Cloudflare One WARP is this project's tray.
  -h, --help           Show this help

Examples:
  $(basename "$0")
  $(basename "$0") --service
  CLOUDFLARE_ONE_WARP_HOME=\$HOME/apps/cloudflare-one-warp $(basename "$0")
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --desktop)
      WITH_DESKTOP=1
      shift
      ;;
    --no-desktop)
      WITH_DESKTOP=0
      shift
      ;;
    --service)
      WITH_SERVICE=1
      shift
      ;;
    --no-bin-links)
      WITH_BIN_LINKS=0
      shift
      ;;
    --shell)
      case "${2:-}" in
        cloudflare|cloudflare-one-warp)
          TRAY_SHELL="$2"
          TRAY_SHELL_EXPLICIT=1
          shift 2
          ;;
        *)
          echo "Unknown desktop app: ${2:-}" >&2
          echo "Use --shell cloudflare or --shell cloudflare-one-warp." >&2
          exit 2
          ;;
      esac
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

if [[ "$TRAY_SHELL_EXPLICIT" -eq 0 && -t 0 ]]; then
  echo
  echo "Which desktop app should start at login?"
  echo "  1) Cloudflare One Client (default) — comes with WARP"
  echo "  2) Cloudflare One WARP — this project's tray and control panel"
  choice=""
  read -r -p "Choice [1]: " choice || true
  case "${choice:-1}" in
    2|cloudflare-one-warp|Cloudflare One WARP)
      TRAY_SHELL=cloudflare-one-warp
      ;;
    *)
      TRAY_SHELL=cloudflare
      ;;
  esac
  # An answered prompt is a choice, so apply it even on a re-install.
  TRAY_SHELL_EXPLICIT=1
fi

cloudflare_one_warp_require_command rsync
cloudflare_one_warp_require_command node

RSYNC_EXCLUDES=(
  --exclude '.git/'
  --exclude 'node_modules/'
  --exclude 'dist/'
  --exclude 'agentdecompile_projects/'
  --exclude '.cursor/'
  --exclude '.tmp-*'
)

echo "Installing Cloudflare One WARP $(cloudflare_one_warp_version) to ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
rsync -a --delete "${RSYNC_EXCLUDES[@]}" "${ROOT}/" "${INSTALL_DIR}/"

if [[ -x "${INSTALL_DIR}/bin/cloudflare-one-warp" ]]; then
  "${INSTALL_DIR}/bin/cloudflare-one-warp" --stop >/dev/null 2>&1 || true
fi

ICON_THEME_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
mkdir -p "${ICON_THEME_ROOT}/scalable/apps"
install -m 0644 "${INSTALL_DIR}/assets/cloudflare-one-warp.svg" "${ICON_THEME_ROOT}/scalable/apps/cloudflare-one-warp.svg"
_tray_icon="${INSTALL_DIR}/assets/cloudflare-one-warp-tray.svg"
[[ -f "$_tray_icon" ]] || _tray_icon="${INSTALL_DIR}/assets/cloudflare-one-warp.svg"
for _size in 16 22 24 32 48; do
  _png_dir="${ICON_THEME_ROOT}/${_size}x${_size}/apps"
  mkdir -p "$_png_dir"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$_size" -h "$_size" "$_tray_icon" -o "${_png_dir}/cloudflare-one-warp.png"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none "$_tray_icon" -resize "${_size}x${_size}" "${_png_dir}/cloudflare-one-warp.png"
  fi
done
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$ICON_THEME_ROOT" >/dev/null 2>&1 || true
fi

if [[ "$WITH_BIN_LINKS" -eq 1 ]]; then
  mkdir -p "$LOCAL_BIN"
  cloudflare_one_warp_link_or_copy "${INSTALL_DIR}/bin/cloudflare-one-warp" "${LOCAL_BIN}/cloudflare-one-warp"
  cloudflare_one_warp_link_or_copy "${INSTALL_DIR}/bin/cloudflare-one-warp-tray" "${LOCAL_BIN}/cloudflare-one-warp-tray"
  echo "Linked CLI commands in ${LOCAL_BIN}"
fi

if [[ "$WITH_DESKTOP" -eq 1 ]]; then
  mkdir -p "$APPLICATIONS_DIR"
  cloudflare_one_warp_remove_legacy_desktop_entries "$APPLICATIONS_DIR"

  cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Cloudflare One WARP
Comment=Unofficial cross-platform Cloudflare One client
Exec=${INSTALL_DIR}/bin/cloudflare-one-warp
Icon=${INSTALL_DIR}/assets/cloudflare-one-warp.svg
Terminal=false
Categories=Network;
Keywords=Cloudflare;WARP;Zero Trust;Cloudflare One WARP;VPN;DNS;
StartupNotify=true
DESKTOP
  chmod 0644 "$DESKTOP_FILE"

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
  fi
  echo "Installed desktop entry ${DESKTOP_FILE}"

  SETTINGS_DESKTOP="${APPLICATIONS_DIR}/cloudflare-one-warp-settings.desktop"
  cat > "$SETTINGS_DESKTOP" <<SETTINGS
[Desktop Entry]
Type=Application
Name=Cloudflare One WARP Settings
Comment=Configure Cloudflare One WARP Web UI, port, and tray preferences
Exec=${INSTALL_DIR}/bin/cloudflare-one-warp-tray --settings
Icon=cloudflare-one-warp
Terminal=false
Categories=Settings;Network;
Keywords=Cloudflare;WARP;Cloudflare One WARP;Settings;Preferences;
StartupNotify=true
SETTINGS
  chmod 0644 "$SETTINGS_DESKTOP"
  echo "Installed desktop entry ${SETTINGS_DESKTOP}"
fi

if [[ -f "${INSTALL_DIR}/scripts/sync-tray-autostart.mjs" ]]; then
  # Without --shell on the command line this is a default to seed, not a choice
  # to impose: a scripted re-install must not flip a user back to Cloudflare.
  TRAY_SHELL_ARGS=(--shell "$TRAY_SHELL")
  if [[ "$TRAY_SHELL_EXPLICIT" -eq 0 ]]; then
    TRAY_SHELL_ARGS+=(--if-unset)
  fi
  CLOUDFLARE_ONE_WARP_HOME="${INSTALL_DIR}" node "${INSTALL_DIR}/scripts/sync-tray-autostart.mjs" "${TRAY_SHELL_ARGS[@]}" >/dev/null 2>&1 || true
  echo "Desktop app: $(CLOUDFLARE_ONE_WARP_HOME="${INSTALL_DIR}" node "${INSTALL_DIR}/scripts/tray-shell-cli.mjs" active 2>/dev/null || echo "$TRAY_SHELL") (change later in Settings)."
fi

if [[ -x "${INSTALL_DIR}/scripts/cloudflare-one-warp-nm" ]] && command -v nmcli >/dev/null 2>&1; then
  CLOUDFLARE_ONE_WARP_HOME="${INSTALL_DIR}" "${INSTALL_DIR}/scripts/cloudflare-one-warp-nm" --user --no-reload >/dev/null 2>&1 || true
  echo "NetworkManager WARP profiles installed (MASQUE, WireGuard, local proxy)."
  echo "  Optional: ${INSTALL_DIR}/scripts/cloudflare-one-warp-nm --system  (dispatcher + sysctl, needs pkexec)"
fi

if [[ "$WITH_SERVICE" -eq 1 ]]; then
  mkdir -p "$SYSTEMD_USER_DIR"
  rm -f "${SYSTEMD_USER_DIR}/cloudflare-one-warp.service" "${SYSTEMD_USER_DIR}/cloudflare-one-gui.service"

  cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Cloudflare One WARP daemon
Documentation=file://${INSTALL_DIR}/README.md
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=-${HOME}/.config/cloudflare-one-warp/env
Environment=CLOUDFLARE_ONE_WARP_WEBUI=0
Environment=CLOUDFLARE_ONE_WARP_PORT=4173
ExecStart=/usr/bin/env node ${INSTALL_DIR}/server.js
Restart=on-failure
RestartSec=3

# Confinement — keep in sync with packaging/cloudflare-one-warp.service.
# NoNewPrivileges, PrivateTmp, and MemoryDenyWriteExecute are deliberately
# absent; see docs/PACKAGING.md.
ProtectSystem=strict
ConfigurationDirectory=cloudflare-one-warp
ConfigurationDirectoryMode=0700
CacheDirectory=cloudflare-one-warp
CacheDirectoryMode=0700
ReadWritePaths=-%h/.config/autostart -%h/.local/share/applications
ReadWritePaths=-%t -/run/cloudflare-warp
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=default.target
SERVICE

  if systemctl --user daemon-reload >/dev/null 2>&1; then
    echo "Installed ${SERVICE_FILE}"
    echo "Enable with: systemctl --user enable --now cloudflare-one-warp.service"
  else
    echo "Installed ${SERVICE_FILE} (reload systemd later with: systemctl --user daemon-reload)"
  fi
fi

TRAY_HINT=""
if /usr/bin/python3 - <<'PY' >/dev/null 2>&1
from PyQt6.QtWidgets import QSystemTrayIcon
from PyQt6.QtWebEngineWidgets import QWebEngineView
PY
then
  TRAY_HINT="  Tray + app:  cloudflare-one-warp-tray   (PyQt6 native shell with full Web UI — left-click tray icon)"
elif [[ "${XDG_SESSION_TYPE:-}" == wayland || -n "${WAYLAND_DISPLAY:-}" ]]; then
  if /usr/bin/python3 - <<'PY' >/dev/null 2>&1
import gi
gi.require_version("Gtk", "3.0")
try:
    gi.require_version("AppIndicator3", "0.1")
    from gi.repository import AppIndicator3
except ValueError:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3
PY
  then
    TRAY_HINT="  Tray menu:   cloudflare-one-warp-tray   (StatusNotifierItem — install python3-pyqt6 for native panel)"
  else
    TRAY_HINT="  Tray menu:   cloudflare-one-warp-tray   (install python3-pyqt6 for KDE/Wayland tray + panel)"
  fi
elif command -v yad >/dev/null 2>&1; then
  TRAY_HINT="  Tray menu:   cloudflare-one-warp-tray   (yad found — left-click opens control panel when PyQt6 is installed)"
else
  TRAY_HINT="  Tray menu:   cloudflare-one-warp-tray   (install python3-pyqt6; see: cloudflare-one-warp-tray --check)"
fi

cat <<DONE

Cloudflare One WARP is installed.

  Launch GUI:  cloudflare-one-warp
  API daemon:  cloudflare-one-warp --no-open
${TRAY_HINT}
  AppImage:    ./cloudflare-one-warp build appimage

Install root: ${INSTALL_DIR}
DONE

if ! /usr/bin/python3 - <<'PY' >/dev/null 2>&1
import gi
gi.require_version("Gtk", "3.0")
try:
    gi.require_version("AppIndicator3", "0.1")
    from gi.repository import AppIndicator3
except ValueError:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3
PY
then
  if command -v dnf >/dev/null 2>&1; then
    echo "Optional KDE/Wayland tray: sudo dnf install python3-gobject libayatana-appindicator-gtk3"
  elif command -v apt-get >/dev/null 2>&1; then
    echo "Optional KDE/Wayland tray: sudo apt install python3-gi libayatana-appindicator3-1"
  elif command -v pacman >/dev/null 2>&1; then
    echo "Optional KDE/Wayland tray: sudo pacman -S python-gobject libayatana-appindicator-gtk3"
  fi
elif ! command -v yad >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    echo "Optional X11 tray dependency: sudo dnf install yad"
  elif command -v apt-get >/dev/null 2>&1; then
    echo "Optional X11 tray dependency: sudo apt install yad"
  elif command -v pacman >/dev/null 2>&1; then
    echo "Optional X11 tray dependency: sudo pacman -S yad"
  else
    echo "Optional tray dependency: install yad or python3-gobject + libayatana-appindicator-gtk3"
  fi
fi

if [[ ! -f /usr/share/polkit-1/actions/com.cloudflare.one.warp.policy ]]; then
  echo "Optional Always On (kill switch) polkit policy:"
  echo "  sudo install -m 0644 ${INSTALL_DIR}/packaging/polkit/com.cloudflare.one.warp.policy /usr/share/polkit-1/actions/"
  echo "  (deb/rpm installs include this automatically; local copy installs do not.)"
fi
