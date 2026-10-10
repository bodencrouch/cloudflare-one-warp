#!/usr/bin/env bash
# Shared helpers for Cloudflare One WARP shell scripts.
set -euo pipefail

cloudflare_one_warp_repo_root() {
  local lib_dir
  lib_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  (cd -- "${lib_dir}/../.." && pwd)
}

cloudflare_one_warp_default_install_dir() {
  printf '%s\n' "${CLOUDFLARE_ONE_WARP_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/cloudflare-one-warp}"
}

cloudflare_one_warp_local_bin_dir() {
  printf '%s\n' "${CLOUDFLARE_ONE_WARP_BIN:-${HOME}/.local/bin}"
}

cloudflare_one_warp_applications_dir() {
  printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
}

cloudflare_one_warp_systemd_user_dir() {
  printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
}

cloudflare_one_warp_version() {
  node -p "require('$(cloudflare_one_warp_repo_root)/package.json').version"
}

cloudflare_one_warp_require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    return 1
  fi
}

cloudflare_one_warp_link_or_copy() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "$dst")"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    rm -rf "$dst"
  fi
  ln -sf "$src" "$dst"
}

cloudflare_one_warp_remove_legacy_desktop_entries() {
  local apps_dir="$1"
  local names=(
    cloudflare-one-gui.desktop
    cloudflare-one-warp.desktop
  )
  local name
  for name in "${names[@]}"; do
    rm -f "${apps_dir}/${name}"
  done
}
