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
      INSTALL_DIR="${2:?--install-dir requires a path}"
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
    2|cloudflare-one-warp|"Cloudflare One WARP")
      TRAY_SHELL=cloudflare-one-warp
      ;;
    *)
      TRAY_SHELL=cloudflare
      ;;
  esac
  # An answered prompt is a choice, so apply it even on a re-install.
  TRAY_SHELL_EXPLICIT=1
fi

cloudflare_one_warp_require_command node
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "Cloudflare One WARP requires Node.js 22 or newer" >&2; exit 1
fi
cloudflare_one_warp_validate_install_dir "$INSTALL_DIR"
INSTALL_DIR="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$INSTALL_DIR")"
# Detect command collisions before stopping or replacing a working app.
if [[ "$WITH_BIN_LINKS" -eq 1 ]]; then
  cloudflare_one_warp_validate_command_link "$INSTALL_DIR/bin/cloudflare-one-warp" "$LOCAL_BIN/cloudflare-one-warp"
  cloudflare_one_warp_validate_command_link "$INSTALL_DIR/bin/cloudflare-one-warp-tray" "$LOCAL_BIN/cloudflare-one-warp-tray"
fi
mkdir -p "$(dirname "$INSTALL_DIR")"
# Build completely before stopping or replacing a working installation.
install_lock="${INSTALL_DIR}.install-lock"
if ! mkdir "$install_lock" 2>/dev/null; then
  echo "Another installation is in progress: $install_lock" >&2; exit 1
fi
trap 'rmdir "$install_lock"' EXIT
stage_dir="$(mktemp -d "${INSTALL_DIR}.stage.XXXXXX")"
backup_dir=""
cleanup_install() {
  rm -rf "$stage_dir"
  rmdir "$install_lock"
  if [[ -n "$backup_dir" && -d "$backup_dir" && ! -e "$INSTALL_DIR" ]]; then mv "$backup_dir" "$INSTALL_DIR"; fi
}
trap cleanup_install EXIT
bash "${ROOT}/packaging/scripts/stage-source.sh" "$stage_dir"
# The default app directory also holds routing shortcut metadata. Preserve that
# user state across a source upgrade; all application code is replaced.
if [[ -d "$INSTALL_DIR/proxy-launchers" && ! -L "$INSTALL_DIR/proxy-launchers" ]]; then
  cp -a "$INSTALL_DIR/proxy-launchers" "$stage_dir/proxy-launchers"
fi
printf '%s\n' 'Cloudflare One WARP local install' > "$stage_dir/.cloudflare-one-warp-install"
node --check "$stage_dir/server.js"
if [[ -x "${INSTALL_DIR}/bin/cloudflare-one-warp" ]]; then
  "${INSTALL_DIR}/bin/cloudflare-one-warp" --stop >/dev/null 2>&1 || true
fi
if [[ -d "$INSTALL_DIR" ]]; then
  backup_dir="$(mktemp -d "${INSTALL_DIR}.backup.XXXXXX")"
  rmdir "$backup_dir"
  mv "$INSTALL_DIR" "$backup_dir"
fi
mv "$stage_dir" "$INSTALL_DIR"
if [[ -n "$backup_dir" ]]; then rm -rf "$backup_dir"; backup_dir=""; fi
DESKTOP_EXEC="$(cloudflare_one_warp_desktop_exec_path "$INSTALL_DIR/bin/cloudflare-one-warp")"
SETTINGS_EXEC="$(cloudflare_one_warp_desktop_exec_path "$INSTALL_DIR/bin/cloudflare-one-warp-tray")"
SYSTEMD_ROOT="$(cloudflare_one_warp_systemd_path "$INSTALL_DIR")"
SYSTEMD_SERVER="$(cloudflare_one_warp_systemd_path "$INSTALL_DIR/server.js")"

ICON_THEME_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
mkdir -p "${ICON_THEME_ROOT}/scalable/apps"
install -m 0644 "${INSTALL_DIR}/assets/cloudflare-one-warp.svg" "${ICON_THEME_ROOT}/scalable/apps/cloudflare-one-warp.svg"
_tray_icon="${INSTALL_DIR}/assets/cloudflare-one-warp-tray.svg"
[[ -f "$_tray_icon" ]] || _tray_icon="${INSTALL_DIR}/assets/cloudflare-one-warp.svg"
for _size in 16 22 24 32 48; do
  _png_dir="${ICON_THEME_ROOT}/${_size}x${_size}/apps"
  mkdir -p "$_png_dir"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$_size" -h "$_size" "$_tray_icon" -o "${_png_dir}/cloudflare-one-warp.png" || echo "Optional ${_size}px tray icon conversion failed; using SVG icon." >&2
  elif command -v convert >/dev/null 2>&1; then
    convert -background none "$_tray_icon" -resize "${_size}x${_size}" "${_png_dir}/cloudflare-one-warp.png" || echo "Optional ${_size}px tray icon conversion failed; using SVG icon." >&2
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

  cloudflare_one_warp_atomic_text_file "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Cloudflare One WARP
Comment=Unofficial cross-platform Cloudflare One client
Exec=${DESKTOP_EXEC}
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
  cloudflare_one_warp_atomic_text_file "$SETTINGS_DESKTOP" <<SETTINGS
[Desktop Entry]
Type=Application
Name=Cloudflare One WARP Settings
Comment=Configure Cloudflare One WARP Web UI, port, and tray preferences
Exec=${SETTINGS_EXEC} --settings
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
  if CLOUDFLARE_ONE_WARP_HOME="${INSTALL_DIR}" "${INSTALL_DIR}/scripts/cloudflare-one-warp-nm" --user --no-reload >/dev/null 2>&1; then
    echo "NetworkManager WARP marker profiles installed (MASQUE, WireGuard, local proxy)."
    echo "  Optional: ${INSTALL_DIR}/scripts/cloudflare-one-warp-nm --system  (dispatcher + sysctl, needs pkexec)"
  else
    echo "Optional NetworkManager profile installation failed; the app remains installed." >&2
  fi
fi

if [[ "$WITH_SERVICE" -eq 1 ]]; then
  CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
  DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
  mkdir -p "$SYSTEMD_USER_DIR" "$APPLICATIONS_DIR" "$CONFIG_HOME/autostart" "$DATA_HOME/cloudflare-one-warp/proxy-launchers"
  rm -f "${SYSTEMD_USER_DIR}/cloudflare-one-warp.service" "${SYSTEMD_USER_DIR}/cloudflare-one-gui.service"

  CONFIG_PATH="$(cloudflare_one_warp_systemd_path "$CONFIG_HOME")"
  CONFIG_ENV="$(cloudflare_one_warp_systemd_path "XDG_CONFIG_HOME=$CONFIG_HOME")"
  DATA_ENV="$(cloudflare_one_warp_systemd_path "XDG_DATA_HOME=$DATA_HOME")"
  ENV_PATH="$(cloudflare_one_warp_systemd_path "$CONFIG_HOME/cloudflare-one-warp/env")"
  AUTOSTART_PATH="$(cloudflare_one_warp_systemd_path "$CONFIG_HOME/autostart")"
  APPLICATIONS_PATH="$(cloudflare_one_warp_systemd_path "$APPLICATIONS_DIR")"
  PROXY_PATH="$(cloudflare_one_warp_systemd_path "$DATA_HOME/cloudflare-one-warp/proxy-launchers")"
  DATA_PATH="$(cloudflare_one_warp_systemd_path "$DATA_HOME/cloudflare-one-warp")"
  UNIT_PATH="$(cloudflare_one_warp_systemd_path "$SYSTEMD_USER_DIR")"

  cloudflare_one_warp_atomic_text_file "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Cloudflare One WARP daemon
Documentation=file://${INSTALL_DIR}/README.md
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${SYSTEMD_ROOT}
EnvironmentFile=-${ENV_PATH}
Environment=${CONFIG_ENV}
Environment=${DATA_ENV}
Environment=CLOUDFLARE_ONE_WARP_WEBUI=0
ExecStartPre=+/usr/bin/mkdir -p ${APPLICATIONS_PATH} ${PROXY_PATH} ${AUTOSTART_PATH} ${UNIT_PATH}
ExecStart=/usr/bin/env node ${SYSTEMD_SERVER}
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
RuntimeDirectory=cloudflare-one-warp
RuntimeDirectoryMode=0700
StateDirectory=cloudflare-one-warp
StateDirectoryMode=0700
Environment=TMPDIR=%t/cloudflare-one-warp
ReadWritePaths=-${AUTOSTART_PATH} -${APPLICATIONS_PATH}
ReadWritePaths=-%t/cloudflare-one-warp -/run/cloudflare-warp
ReadWritePaths=-${DATA_PATH} -${UNIT_PATH}
# KDE uses sibling temporary files for atomic replacement of kioslaverc.
ReadWritePaths=-${CONFIG_PATH}
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
