#!/usr/bin/env bash
# Copy only the distributable source surface; never copy an entire working tree.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${1:?Usage: stage-source.sh DEST}"
mkdir -p "$DEST"
tar -C "$ROOT" \
  --exclude='.git' --exclude='node_modules' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.env' --exclude='.env.*' --exclude='.npmrc' --exclude='.netrc' --exclude='.ssh' --exclude='*.pem' --exclude='*.key' --exclude='*.p12' \
  --exclude='*.pfx' --exclude='id_rsa*' --exclude='id_ed25519*' --exclude='*.AppImage' \
  --exclude='.flatpak-builder' --exclude='packaging/flatpak/repo' --exclude='packaging/flatpak/build' \
  -cf - server.js package.json package-lock.json LICENSE README.md CHANGELOG.md SECURITY.md AGENTS.md \
  lib public assets bin scripts packaging docs openapi cloudflare-one-warp \
  config/config.example.json config/update-manifest.json | tar -C "$DEST" -xf -
