#!/usr/bin/env bash
set -euo pipefail

# Retire the earlier fake VPN plugin without deleting a replacement from another provider.
legacy_vpn=/usr/lib/NetworkManager/VPN/nm-cloudflare-one-warp-service.name
if [[ -f "$legacy_vpn" && ! -L "$legacy_vpn" ]] &&
  grep -Fxq 'name=Cloudflare One WARP' "$legacy_vpn" &&
  grep -Fxq 'service=org.cloudflare.one.warp' "$legacy_vpn"; then
  rm -f "$legacy_vpn"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

if [[ -f /usr/share/polkit-1/actions/com.cloudflare.one.warp.policy ]] && command -v pkaction >/dev/null 2>&1; then
  pkaction --version >/dev/null 2>&1 || true
fi

if [[ -f /etc/sysctl.d/99-cloudflare-one-warp.conf ]] && command -v sysctl >/dev/null 2>&1; then
  sysctl -p /etc/sysctl.d/99-cloudflare-one-warp.conf >/dev/null 2>&1 || true
fi

if command -v nmcli >/dev/null 2>&1; then
  nmcli connection reload >/dev/null 2>&1 || true
fi
