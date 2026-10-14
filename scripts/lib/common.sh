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
  node -e 'process.stdout.write(require(process.argv[1]).version)' "$(cloudflare_one_warp_repo_root)/package.json"
}

cloudflare_one_warp_require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    return 1
  fi
}

cloudflare_one_warp_validate_command_link() {
  local src="$1" dst="$2"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "Refusing to replace an existing command: $dst" >&2; return 1
  fi
  if [[ -L "$dst" && "$(readlink "$dst")" != "$src" ]]; then
    echo "Refusing to replace an unrelated command link: $dst" >&2; return 1
  fi
}

cloudflare_one_warp_link_or_copy() {
  local src="$1" dst="$2"
  cloudflare_one_warp_validate_command_link "$src" "$dst"
  mkdir -p "$(dirname "$dst")"
  ln -sf "$src" "$dst"
}

# Replace the directory entry rather than following an existing file symlink.
cloudflare_one_warp_atomic_text_file() {
  local destination="$1" temporary
  if [[ -d "$destination" && ! -L "$destination" ]]; then
    echo "Integration path is a directory: $destination" >&2; return 1
  fi
  temporary="$(mktemp "${destination}.XXXXXX")"
  if cat > "$temporary" && chmod 0644 "$temporary" && node -e 'require("fs").renameSync(process.argv[1], process.argv[2])' "$temporary" "$destination"; then return 0; fi
  rm -f "$temporary"
  return 1
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

# Reject destructive targets and unrelated trees before install or purge.
cloudflare_one_warp_validate_install_dir() {
  local target="$1" mode="${2:-install}" resolved
  resolved="$(node -e 'const p=require("path"); if(/[\r\n]/.test(process.argv[1])) process.exit(2); process.stdout.write(p.resolve(process.argv[1]))' "$target")"
  case "$resolved" in /|"$HOME"|/usr|/usr/local|/etc|/var|/tmp|/opt)
    echo "Unsafe install directory: $resolved" >&2; return 1 ;;
  esac
  case "$resolved/" in "$(cloudflare_one_warp_repo_root)/"*)
    if [[ "$mode" != remove || "$resolved" != "$(cloudflare_one_warp_repo_root)" ||
          ! -f "$target/.cloudflare-one-warp-install" || -L "$target/.cloudflare-one-warp-install" ]] ||
      [[ "$(cat "$target/.cloudflare-one-warp-install" 2>/dev/null)" != 'Cloudflare One WARP local install' ]]; then
      echo "Install directory must be outside the source tree" >&2; return 1
    fi ;;
  esac
  if [[ -L "$target" ]]; then echo "Install directory must not be a symbolic link" >&2; return 1; fi
  if [[ -e "$target" && ! -d "$target" ]]; then echo "Install directory is not a directory" >&2; return 1; fi
  if [[ -d "$target" && ! -f "$target/.cloudflare-one-warp-install" ]]; then
    # Permit upgrades of earlier local installs, only when their manifest identifies us.
    if ! node -e 'const fs=require("fs"); try { process.exit(JSON.parse(fs.readFileSync(process.argv[1])).name === "cloudflare-one-warp" ? 0 : 1); } catch { process.exit(1); }' "$target/package.json"; then
      local entries
      entries="$(ls -A "$target")"
      if [[ -n "$entries" && ! ( "$resolved" == "${XDG_DATA_HOME:-$HOME/.local/share}/cloudflare-one-warp" && "$entries" == proxy-launchers && -d "$target/proxy-launchers" && ! -L "$target/proxy-launchers" ) ]]; then
        echo "Refusing to replace an unrelated directory: $target" >&2; return 1
      fi
    fi
  fi
}

cloudflare_one_warp_desktop_exec_path() {
  node -e 'const s=process.argv[1]; if(/[\r\n]/.test(s)) process.exit(2); process.stdout.write("\""+s.replace(/([\\\"`$])/g,"\\$1").replace(/%/g,"%%")+"\"");' "$1"
}
cloudflare_one_warp_systemd_path() {
  node -e 'const s=process.argv[1]; if(/[\r\n]/.test(s)) process.exit(2); process.stdout.write("\""+s.replace(/\\/g,"\\\\").replace(/\"/g,"\\\"").replace(/%/g,"%%")+"\"");' "$1"
}

# Keep publishing tokens out of git URLs, argv, and repository configuration.
cloudflare_one_warp_setup_git_credentials() {
  local directory="$1"
  export CLOUDFLARE_ONE_WARP_PUBLISH_TOKEN="$2"
  export GIT_ASKPASS="$directory/git-askpass"
  export GIT_TERMINAL_PROMPT=0
  # Disable credential helpers so git cannot persist the publishing token.
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=credential.helper
  export GIT_CONFIG_VALUE_0=""
  cat > "$GIT_ASKPASS" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "$CLOUDFLARE_ONE_WARP_PUBLISH_TOKEN" ;;
  *) exit 1 ;;
esac
ASKPASS
  chmod 0700 "$GIT_ASKPASS"
}
