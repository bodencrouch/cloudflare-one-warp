#!/usr/bin/env python3
"""State-aware WARP connect/disconnect via the daemon API (no browser)."""

from __future__ import annotations

import sys

from tray_api import CloudflareOneWarpClient, connection_control, ensure_daemon, launcher_path


def main() -> int:
  launcher = launcher_path()
  ensure_daemon(launcher, webui=False)
  client = CloudflareOneWarpClient()
  try:
    outcome = client.run_connection_action()
  except Exception as exc:
    print(f"Cloudflare One WARP connection action failed: {exc}", file=sys.stderr)
    return 1
  ctrl = outcome.get("control") or {}
  if outcome.get("skipped"):
    print(ctrl.get("label") or "Unavailable", file=sys.stderr)
    return 1 if not ctrl.get("enabled") else 0
  print(ctrl.get("label") or "Done")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
