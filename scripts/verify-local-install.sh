#!/usr/bin/env bash
# Verify a local Cloudflare One WARP install serves current UI assets (log widget, proxy action).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT}/scripts/lib/common.sh"

INSTALL_DIR="${CLOUDFLARE_ONE_WARP_HOME:-$(cloudflare_one_warp_default_install_dir)}"
PORT="${CLOUDFLARE_ONE_WARP_PORT:-4173}"
BASE_URL="http://127.0.0.1:${PORT}"

fail() {
  echo "verify-local-install: $*" >&2
  exit 1
}

echo "Verifying install at ${INSTALL_DIR}"

test -f "${INSTALL_DIR}/public/log-widget.js" || fail "missing public/log-widget.js"
test -f "${INSTALL_DIR}/server.js" || fail "missing server.js"

APP_DOCK_COUNT="$(grep -c appendLogDock "${INSTALL_DIR}/public/app.js" || true)"
if [[ "${APP_DOCK_COUNT}" -lt 3 ]]; then
  fail "public/app.js appendLogDock count=${APP_DOCK_COUNT} (expected >= 3)"
fi

grep -q enableLocalProxy "${INSTALL_DIR}/server.js" || fail "server.js missing enableLocalProxy action"

# Daemon health (start via launcher if needed)
if ! curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
  echo "Daemon not responding; starting via ${INSTALL_DIR}/bin/cloudflare-one-warp ..."
  CLOUDFLARE_ONE_WARP_WEBUI=1 "${INSTALL_DIR}/bin/cloudflare-one-warp" --no-open >/dev/null 2>&1 &
  for _ in $(seq 1 40); do
    if curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

curl -sf "${BASE_URL}/api/health" >/dev/null || fail "daemon /api/health unreachable at ${BASE_URL}"

HEALTH="$(curl -sf "${BASE_URL}/api/health")"
echo "${HEALTH}" | grep -q '"app"[[:space:]]*:[[:space:]]*"cloudflare-one-warp"' || fail "unexpected /api/health body"

curl -sf "${BASE_URL}/log-widget.js" | head -1 | grep -qE 'import|export' || fail "/log-widget.js not served"

SERVED_DOCK="$(curl -sf "${BASE_URL}/app.js" | grep -c appendLogDock || true)"
if [[ "${SERVED_DOCK}" -lt 3 ]]; then
  fail "served app.js appendLogDock count=${SERVED_DOCK} (daemon may be running stale tree)"
fi

echo "OK: log widget assets present locally and served by daemon at ${BASE_URL}"
