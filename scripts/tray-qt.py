#!/usr/bin/env python3
"""ThirdFlare One — native KDE/Plasma tray + embedded Web UI shell (PyQt6)."""

from __future__ import annotations

import os
import signal
import subprocess
import sys

from tray_api import (
  ThirdFlareClient,
  connection_control,
  ensure_daemon,
  launcher_path,
  snapshot_label,
  tray_icon_state,
)


WINDOW_WIDTH = 1120
WINDOW_HEIGHT = 780

ICON_NAME = "thirdflare-one"
TRAY_ICON_SIZES = (16, 22, 24, 32, 48)


def app_dir() -> str:
  env = os.environ.get("THIRDFLARE_APP_DIR")
  if env:
    return env
  return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def icon_source_path(root: str) -> str:
  tray_icon = os.path.join(root, "assets", "thirdflare-tray.svg")
  if os.path.isfile(tray_icon):
    return tray_icon
  return os.path.join(root, "assets", "thirdflare.svg")


def tray_state_icon_path(root: str, state: str) -> str:
  """Prefer state-specific SVG; fall back to the classic tray icon."""
  name = {
    "connected": "tray-connected.svg",
    "connecting": "tray-connecting.svg",
    "disconnected": "tray-disconnected.svg",
    "needs-attention": "tray-needs-attention.svg",
  }.get(state, "tray-disconnected.svg")
  path = os.path.join(root, "assets", name)
  if os.path.isfile(path):
    return path
  return icon_source_path(root)


def icon_theme_root() -> str:
  data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(
    os.path.expanduser("~"),
    ".local",
    "share",
  )
  return os.path.join(data_home, "icons", "hicolor")


def tray_icon_png(size: int = 22) -> str:
  return os.path.join(icon_theme_root(), f"{size}x{size}", "apps", f"{ICON_NAME}.png")


def _write_png_icon(source: str, target: str, size: int) -> None:
  for cmd in (
    ["rsvg-convert", "-w", str(size), "-h", str(size), source, "-o", target],
    [
      "convert",
      "-background",
      "none",
      source,
      "-resize",
      f"{size}x{size}",
      target,
    ],
  ):
    try:
      completed = subprocess.run(
        cmd,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
      )
    except OSError:
      continue
    if completed.returncode == 0 and os.path.isfile(target):
      return


def ensure_tray_icon(root: str) -> str:
  source = icon_source_path(root)
  theme_root = icon_theme_root()
  scalable_target = os.path.join(theme_root, "scalable", "apps", f"{ICON_NAME}.svg")
  os.makedirs(os.path.dirname(scalable_target), exist_ok=True)

  if not os.path.isfile(scalable_target):
    with open(source, "rb") as src, open(scalable_target, "wb") as dst:
      dst.write(src.read())

  for size in TRAY_ICON_SIZES:
    png_dir = os.path.join(theme_root, f"{size}x{size}", "apps")
    png_target = os.path.join(png_dir, f"{ICON_NAME}.png")
    os.makedirs(png_dir, exist_ok=True)
    _write_png_icon(source, png_target, size)

  for size in (22, 24, 32, 48):
    candidate = tray_icon_png(size)
    if os.path.isfile(candidate):
      return candidate
  return icon_source_path(root)


def run_cmd(command: list[str]) -> None:
  subprocess.Popen(
    command,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
  )


def capture_text(command: list[str]) -> str:
  try:
    completed = subprocess.run(
      command,
      check=False,
      capture_output=True,
      text=True,
      timeout=10,
    )
  except (OSError, subprocess.TimeoutExpired):
    return ""
  text = (completed.stdout or "") + (completed.stderr or "")
  return " ".join(text.split())


def status_text(launcher: str) -> str:
  return capture_text([launcher, "--warp-status"]) or "ThirdFlare One"


def tray_tooltip(status: str) -> str:
  return f"ThirdFlare One\nStatus: {status}\nLeft-click: panel · Right-click: menu"


def notify_status(root: str, launcher: str) -> None:
  text = status_text(launcher)
  print(text)
  icon = ensure_tray_icon(root)
  try:
    subprocess.run(
      ["notify-send", "ThirdFlare One", text, f"--icon={icon}"],
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
  except OSError:
    pass


def run_tray_app(show_window_on_start: bool = False) -> int:
  from PyQt6.QtCore import Qt, QTimer, QUrl
  from PyQt6.QtGui import QAction, QCloseEvent, QIcon
  from PyQt6.QtWebEngineWidgets import QWebEngineView
  from PyQt6.QtWidgets import QApplication, QMainWindow, QMenu, QSystemTrayIcon

  QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)

  root = app_dir()
  launcher = launcher_path()
  icon_path = ensure_tray_icon(root)

  ensure_daemon(launcher)
  client = ThirdFlareClient()

  app = QApplication(sys.argv)
  app.setApplicationName("ThirdFlare One")
  app.setApplicationDisplayName("ThirdFlare One")
  app.setDesktopFileName("thirdflare-one")
  app.setQuitOnLastWindowClosed(False)

  class NativeShellWindow(QMainWindow):
    """Native KDE window embedding the full ThirdFlare One Web UI."""

    def __init__(self, tray_icon: QSystemTrayIcon, on_open_settings) -> None:
      super().__init__()
      self._tray = tray_icon
      self._loaded = False
      self.setWindowTitle("ThirdFlare One")
      self.setWindowIcon(QIcon(icon_path))
      self.resize(WINDOW_WIDTH, WINDOW_HEIGHT)

      self._view = QWebEngineView(self)
      self.setCentralWidget(self._view)

      from PyQt6.QtCore import QObject, pyqtSlot
      from PyQt6.QtWebChannel import QWebChannel

      class ShellBridge(QObject):
        def __init__(self, open_settings) -> None:
          super().__init__()
          self._open_settings = open_settings

        @pyqtSlot()
        def openSettings(self) -> None:
          self._open_settings()

      channel = QWebChannel(self)
      self._bridge = ShellBridge(on_open_settings)
      channel.registerObject("thirdflare", self._bridge)
      self._view.page().setWebChannel(channel)

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
      event.ignore()
      self.hide()

    def load_app(self, force_reload: bool = False) -> None:
      if not client.base_url and not client.discover():
        ensure_daemon(launcher)
        client.discover()
      client.ensure_daemon_webui(launcher)
      target = QUrl(client.app_url())
      if force_reload or not self._loaded:
        self._view.setUrl(target)
        self._loaded = True
      else:
        self._view.reload()

  if not QSystemTrayIcon.isSystemTrayAvailable():
    print("ThirdFlare One tray: system tray unavailable.", file=sys.stderr)
    return 1

  tray = QSystemTrayIcon(QIcon(icon_path))
  tray.setToolTip(tray_tooltip(status_text(launcher)))

  def show_settings() -> None:
    script = os.path.join(root, "scripts", "tray-settings.py")
    subprocess.Popen(
      [sys.executable, script, "--tray-active"],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      start_new_session=True,
    )

  window = NativeShellWindow(tray, show_settings)

  def show_window(force_reload: bool = False) -> None:
    window.load_app(force_reload=force_reload)
    window.show()
    window.raise_()
    window.activateWindow()

  def hide_window() -> None:
    window.hide()

  def toggle_window() -> None:
    if window.isVisible():
      hide_window()
    else:
      show_window()

  def run_connection_action() -> None:
    try:
      client.run_connection_action()
    except Exception as exc:
      print(f"ThirdFlare One action failed: {exc}", file=sys.stderr)
    QTimer.singleShot(900, refresh_tray_state)

  def refresh_connection_action() -> None:
    try:
      ctrl = connection_control(client.snapshot())
    except Exception:
      ctrl = {"label": "Connect", "enabled": False, "action": None}
    connection_action.setText(str(ctrl["label"]))
    connection_action.setEnabled(bool(ctrl["enabled"]))

  def refresh_tray_state() -> None:
    snap = None
    try:
      snap = client.snapshot()
      label = snapshot_label(snap)
      tray.setToolTip(tray_tooltip(label))
    except Exception:
      tray.setToolTip(tray_tooltip(status_text(launcher)))
    state_name = tray_icon_state(snap)
    tray.setIcon(QIcon(tray_state_icon_path(root, state_name)))
    refresh_connection_action()

  def refresh_tooltip() -> None:
    refresh_tray_state()

  menu = QMenu()
  menu.addAction("Show ThirdFlare One", show_window)
  menu.addSeparator()
  connection_action = QAction("Connect", menu)
  connection_action.triggered.connect(run_connection_action)
  menu.addAction(connection_action)
  menu.aboutToShow.connect(refresh_connection_action)
  menu.addSeparator()
  menu.addAction("Settings…", show_settings)
  menu.addAction("Reload window", lambda: show_window(force_reload=True))
  menu.addAction("Show status notification", lambda: notify_status(root, launcher))
  menu.addSeparator()
  menu.addAction("Quit tray", app.quit)
  tray.setContextMenu(menu)

  def on_tray_activated(reason: QSystemTrayIcon.ActivationReason) -> None:
    if reason == QSystemTrayIcon.ActivationReason.Trigger:
      toggle_window()
    elif reason == QSystemTrayIcon.ActivationReason.MiddleClick:
      run_connection_action()

  tray.activated.connect(on_tray_activated)

  def on_sigusr1(_signum: int, _frame: object) -> None:
    show_window()

  signal.signal(signal.SIGUSR1, on_sigusr1)

  tray.show()

  poll = QTimer()
  poll.timeout.connect(refresh_tray_state)
  poll.start(5000)
  refresh_tray_state()

  if show_window_on_start:
    show_window()

  print(
    "ThirdFlare One tray started (PyQt6 native shell). "
    "Left-click the tray icon for the full app.",
    file=sys.stderr,
  )
  return app.exec()


def main() -> int:
  args = sys.argv[1:]
  if args and args[0] == "--status":
    root = app_dir()
    notify_status(root, launcher_path())
    return 0
  if args and args[0] == "--settings":
    script = os.path.join(app_dir(), "scripts", "tray-settings.py")
    tray_active = "--tray-active" in args or os.environ.get("THIRDFLARE_TRAY_ACTIVE") == "1"
    extra = ["--tray-active"] if tray_active else []
    return subprocess.call([sys.executable, script, *extra])
  show_window = "--panel" in args or os.environ.get("THIRDFLARE_SHOW_PANEL") == "1"
  return run_tray_app(show_window_on_start=show_window)


if __name__ == "__main__":
  raise SystemExit(main())
