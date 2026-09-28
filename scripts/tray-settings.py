#!/usr/bin/env python3
"""Native PyQt6 preferences for ThirdFlare One (KDE Plasma)."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from tray_api import ThirdFlareClient, app_dir, ensure_daemon, launcher_path


def _node_bin() -> str:
  bundled = os.path.join(app_dir(), "runtime", "node", "bin", "node")
  if os.path.isfile(bundled) and os.access(bundled, os.X_OK):
    return bundled
  return os.environ.get("THIRDFLARE_NODE") or os.environ.get("CLOUDFLARE_ONE_GUI_NODE") or "node"


def _apply_live_shell() -> None:
  cli = os.path.join(app_dir(), "scripts", "tray-shell-cli.mjs")
  if not os.path.isfile(cli):
    return
  subprocess.Popen(
    [_node_bin(), cli, "start"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
  )


def run_settings_dialog(*, tray_active: bool = False) -> int:
  from PyQt6.QtCore import Qt
  from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QLabel,
    QMessageBox,
    QSpinBox,
    QVBoxLayout,
  )

  launcher = launcher_path()
  ensure_daemon(launcher, webui=True)
  client = ThirdFlareClient()

  try:
    config_payload = client.get("/api/config")
  except Exception as exc:
    print(f"ThirdFlare One settings: could not load config: {exc}", file=sys.stderr)
    return 1

  config = config_payload.get("config") or {}
  webui = config.get("webui") or {}
  server = config.get("server") or {}
  ui = config.get("ui") or {}
  tray = config.get("tray") or {}

  app = QApplication.instance() or QApplication(sys.argv)
  app.setApplicationName("ThirdFlare One Settings")

  dialog = QDialog()
  dialog.setWindowTitle("ThirdFlare One Settings")
  dialog.setMinimumWidth(420)

  root = QVBoxLayout(dialog)

  webui_group = QGroupBox("Web UI")
  webui_form = QFormLayout(webui_group)
  webui_check = QCheckBox("Enable Web UI")
  webui_check.setChecked(bool(webui.get("enabled")))
  if tray_active:
    webui_check.setEnabled(False)
    webui_check.setToolTip(
      "The desktop app requires the Web UI. Stop the tray and use API-only mode to disable."
    )
  webui_form.addRow(webui_check)
  webui_note = QLabel(
    "When enabled, the daemon serves the full control panel. Restart required after changes."
  )
  webui_note.setWordWrap(True)
  webui_form.addRow(webui_note)
  root.addWidget(webui_group)

  server_group = QGroupBox("Daemon")
  server_form = QFormLayout(server_group)
  port_spin = QSpinBox()
  port_spin.setRange(1024, 65535)
  port_spin.setValue(int(server.get("port") or 4173))
  server_form.addRow("HTTP port", port_spin)
  port_note = QLabel("Changing the port restarts the daemon.")
  port_note.setWordWrap(True)
  server_form.addRow(port_note)
  root.addWidget(server_group)

  session_group = QGroupBox("Desktop session")
  session_form = QFormLayout(session_group)
  shell_combo = QComboBox()
  shell_combo.addItem("Cloudflare One Client", "cloudflare")
  shell_combo.addItem("ThirdFlare One", "thirdflare")
  cloudflare_available = bool(tray.get("cloudflareAvailable"))
  if not cloudflare_available:
    cloudflare_item = shell_combo.model().item(0)
    if cloudflare_item is not None:
      cloudflare_item.setEnabled(False)
  current_shell = tray.get("shell") if tray.get("shell") in ("cloudflare", "thirdflare") else "cloudflare"
  if not cloudflare_available:
    current_shell = "thirdflare"
  shell_idx = shell_combo.findData(current_shell)
  shell_combo.setCurrentIndex(shell_idx if shell_idx >= 0 else 1)
  session_form.addRow("Desktop app", shell_combo)
  shell_hint = QLabel(
    "Choose which app sits in the system tray. Cloudflare One Client comes with WARP."
  )
  shell_hint.setWordWrap(True)
  session_form.addRow(shell_hint)
  if not cloudflare_available:
    missing = QLabel("Install the WARP app to use Cloudflare One Client in the tray.")
    missing.setWordWrap(True)
    session_form.addRow(missing)

  autostart_check = QCheckBox("Start tray at login")
  autostart_check.setChecked(bool(tray.get("autostart")))
  session_form.addRow(autostart_check)

  def refresh_autostart_enabled() -> None:
    autostart_check.setEnabled(shell_combo.currentData() == "thirdflare")

  shell_combo.currentIndexChanged.connect(refresh_autostart_enabled)
  refresh_autostart_enabled()
  notify_check = QCheckBox("Desktop notifications on connect/disconnect")
  notify_check.setChecked(ui.get("notifications", True) is not False)
  session_form.addRow(notify_check)
  root.addWidget(session_group)

  status = QLabel("")
  status.setWordWrap(True)
  root.addWidget(status)

  buttons = QDialogButtonBox(
    QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
  )
  root.addWidget(buttons)

  def save() -> None:
    desired_webui = webui_check.isChecked()
    desired_port = int(port_spin.value())
    desired_shell = shell_combo.currentData()
    desired_autostart = autostart_check.isChecked()
    desired_notify = notify_check.isChecked()

    if tray_active and not desired_webui:
      QMessageBox.warning(
        dialog,
        "ThirdFlare One",
        "The Web UI cannot be disabled while the tray app is running.",
      )
      return

    restart_needed = False
    try:
      current_webui = bool(webui.get("enabled"))
      current_port = int(server.get("port") or 4173)
      if desired_webui != current_webui:
        client.post("/api/config/webui", {"enabled": desired_webui})
        restart_needed = True
      if desired_port != current_port:
        client.post("/api/config/server", {"port": desired_port})
        restart_needed = True
      if desired_shell != (tray.get("shell") or "cloudflare"):
        applied = client.post("/api/config/tray-shell", {"shell": desired_shell}) or {}
        # The daemon swaps the running shell itself whenever it has a display.
        # Only swap from here when it did not, or the two passes race and
        # isWarpTaskbarRunning() misses a taskbar that is still exec'ing —
        # leaving two Cloudflare tray icons.
        if not (applied.get("liveSwap") or {}).get("attempted"):
          _apply_live_shell()
      if desired_autostart != bool(tray.get("autostart")) and desired_shell == "thirdflare":
        client.post("/api/config/tray-autostart", {"autostart": desired_autostart})
      if desired_notify != (ui.get("notifications", True) is not False):
        client.post("/api/config/ui", {"notifications": desired_notify})
    except Exception as exc:
      status.setText(f"Save failed: {exc}")
      return

    if restart_needed:
      try:
        client.restart_daemon(launcher, webui=desired_webui)
      except Exception as exc:
        status.setText(f"Saved, but daemon restart failed: {exc}")
        return

    status.setText("Settings saved.")
    dialog.accept()

  buttons.accepted.connect(save)
  buttons.rejected.connect(dialog.reject)

  return 0 if dialog.exec() == QDialog.DialogCode.Accepted else 0


def main() -> int:
  tray_active = "--tray-active" in sys.argv
  try:
    return run_settings_dialog(tray_active=tray_active)
  except ImportError as exc:
    print(f"ThirdFlare One settings requires PyQt6: {exc}", file=sys.stderr)
    return 1


if __name__ == "__main__":
  raise SystemExit(main())
