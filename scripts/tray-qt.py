#!/usr/bin/env python3
"""Cloudflare One WARP — native KDE/Plasma tray + embedded Web UI shell (PyQt6)."""

from __future__ import annotations

import os
import signal
import re
import stat
import subprocess
import sys

from tray_api import (
  CloudflareOneWarpClient,
  connection_control,
  ensure_daemon,
  launcher_path,
  snapshot_label,
  tray_icon_state,
  session_token_path,
)


WINDOW_WIDTH = 1120
WINDOW_HEIGHT = 780

ICON_NAME = "cloudflare-one-warp"
TRAY_ICON_SIZES = (16, 22, 24, 32, 48)


def app_dir() -> str:
  env = os.environ.get("CLOUDFLARE_ONE_WARP_APP_DIR")
  if env:
    return env
  return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def icon_source_path(root: str) -> str:
  tray_icon = os.path.join(root, "assets", "cloudflare-one-warp-tray.svg")
  if os.path.isfile(tray_icon):
    return tray_icon
  return os.path.join(root, "assets", "cloudflare-one-warp.svg")


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
        timeout=5,
      )
    except (OSError, subprocess.TimeoutExpired):
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
  return capture_text([launcher, "--warp-status"]) or "Cloudflare One WARP"


def tray_tooltip(status: str) -> str:
  return f"Cloudflare One WARP\nStatus: {status}\nLeft-click: panel · Right-click: menu"


def notify_status(root: str, launcher: str) -> None:
  text = status_text(launcher)
  print(text)
  icon = ensure_tray_icon(root)
  try:
    subprocess.run(
      ["notify-send", "Cloudflare One WARP", text, f"--icon={icon}"],
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
  except OSError:
    pass


def create_native_page(parent=None, open_external=None):
  """Restrict WebEngine navigation to one owner handoff and its daemon origin."""
  from PyQt6.QtCore import QUrl
  from PyQt6.QtGui import QDesktopServices
  from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings, QWebEngineProfile
  open_external = open_external or QDesktopServices.openUrl

  class OwnerPage(QWebEnginePage):
    def __init__(self):
      self._private_profile = QWebEngineProfile(parent)
      super().__init__(self._private_profile, parent)
      self._private_profile.setParent(self)
      self._handoff = None
      self._origin = None
      self.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, False)
      self.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False)
      self.newWindowRequested.connect(self._new_window)

    def set_authenticated_target(self, handoff_uri, daemon_base):
      handoff = QUrl(handoff_uri)
      daemon = QUrl(daemon_base)
      if daemon.scheme() != "http" or daemon.host() not in ("127.0.0.1", "localhost", "::1") or not 1024 <= daemon.port() <= 65535:
        raise ValueError("Native Web UI requires a loopback daemon")
      if daemon.userInfo() or daemon.path() not in ("", "/") or daemon.hasQuery() or daemon.hasFragment():
        raise ValueError("Invalid daemon origin")
      expected = os.path.join(os.path.dirname(session_token_path(daemon.port())), "webui-handoff")
      path = handoff.toLocalFile()
      if not handoff.isLocalFile() or handoff.host() or handoff.hasQuery() or handoff.hasFragment() or os.path.dirname(path) != expected:
        raise ValueError("Native Web UI requires its private browser handoff")
      if not re.fullmatch(r"handoff-%d-[a-f0-9-]+\.html" % daemon.port(), os.path.basename(path)):
        raise ValueError("Invalid browser handoff filename")
      for candidate, directory in ((expected, True), (path, False)):
        info = os.lstat(candidate)
        if stat.S_ISLNK(info.st_mode) or info.st_mode & 0o077 or (hasattr(os, "getuid") and info.st_uid != os.getuid()):
          raise ValueError("Browser handoff is not private")
        if directory and not stat.S_ISDIR(info.st_mode) or not directory and not stat.S_ISREG(info.st_mode):
          raise ValueError("Invalid browser handoff path")
      self._handoff = handoff.toString()
      self._origin = (daemon.scheme(), daemon.host(), daemon.port())
      # Only this verified, owner-written redirect file may navigate to HTTP.
      self.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

    def _external(self, url):
      if url.scheme() == "https" and url.host() and not url.userInfo():
        open_external(url)

    def _new_window(self, request):
      if request.isUserInitiated():
        self._external(request.requestedUrl())

    def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
      if not is_main_frame:
        return False
      if self._handoff and url.toString() == self._handoff:
        return True
      if self._origin and (url.scheme(), url.host(), url.port()) == self._origin and url.path() in ("", "/") and not url.userInfo():
        return True
      if navigation_type == QWebEnginePage.NavigationType.NavigationTypeLinkClicked:
        self._external(url)
      return False

  return OwnerPage()


def run_tray_app(show_window_on_start: bool = False) -> int:
  from PyQt6.QtCore import Qt, QTimer, QUrl
  from tray_workers import AsyncRunner
  from PyQt6.QtGui import QAction, QCloseEvent, QIcon
  from PyQt6.QtWebEngineWidgets import QWebEngineView
  from PyQt6.QtWidgets import QApplication, QMainWindow, QMenu, QSystemTrayIcon

  QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)

  root = app_dir()
  launcher = launcher_path()
  icon_path = ensure_tray_icon(root)

  ensure_daemon(launcher)
  client = CloudflareOneWarpClient()

  app = QApplication(sys.argv)
  app.setApplicationName("Cloudflare One WARP")
  app.setApplicationDisplayName("Cloudflare One WARP")
  app.setDesktopFileName("cloudflare-one-warp")
  app.setQuitOnLastWindowClosed(False)
  runner = AsyncRunner(app)
  app.aboutToQuit.connect(runner.close)
  window_loading = False
  poll_pending = False
  action_pending = False
  last_snapshot = None

  class NativeShellWindow(QMainWindow):
    """Native KDE window embedding the full Cloudflare One WARP Web UI."""

    def __init__(self, tray_icon: QSystemTrayIcon, on_open_settings) -> None:
      super().__init__()
      self._tray = tray_icon
      self._loaded = False
      self.setWindowTitle("Cloudflare One WARP")
      self.setWindowIcon(QIcon(icon_path))
      self.resize(WINDOW_WIDTH, WINDOW_HEIGHT)

      self._view = QWebEngineView(self)
      self._view.setPage(create_native_page(self._view))
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
      channel.registerObject("cloudflareOneWarp", self._bridge)
      self._view.page().setWebChannel(channel)

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
      event.ignore()
      self.hide()

    def load_app(self, force_reload: bool = False) -> None:
      nonlocal window_loading
      if window_loading:
        return
      window_loading = True

      def prepare():
        if not client.base_url and not client.discover():
          ensure_daemon(launcher)
          client.discover()
        client.ensure_daemon_webui(launcher)
        return client.app_url()

      def ready(target, error):
        nonlocal window_loading
        window_loading = False
        if error:
          print(f"Cloudflare One WARP window failed: {error}", file=sys.stderr)
          return
        try:
          self._view.page().set_authenticated_target(target, client.base_url)
        except (OSError, ValueError) as rejected:
          print(f"Native Web UI authentication failed: {rejected}", file=sys.stderr)
          return
        # A daemon restart rotates the credential; reload through the new private
        # handoff rather than reusing a stale sessionStorage credential.
        self._view.setUrl(QUrl(target))
        self._loaded = True

      runner.submit(prepare, ready)

  if not QSystemTrayIcon.isSystemTrayAvailable():
    print("Cloudflare One WARP tray: system tray unavailable.", file=sys.stderr)
    return 1

  tray = QSystemTrayIcon(QIcon(icon_path))
  tray.setToolTip(tray_tooltip("Checking WARP status…"))

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
    nonlocal action_pending
    if action_pending:
      return
    action_pending = True
    connection_action.setEnabled(False)

    def finished(_result, error):
      nonlocal action_pending
      action_pending = False
      if error:
        print(f"Cloudflare One WARP action failed: {error}", file=sys.stderr)
      refresh_connection_action()
      refresh_tray_state()

    runner.submit(client.run_connection_action, finished)

  def refresh_connection_action() -> None:
    ctrl = connection_control(last_snapshot) if last_snapshot else {"label": "Connect", "enabled": False}
    connection_action.setText(str(ctrl["label"]))
    connection_action.setEnabled(bool(ctrl["enabled"]) and not action_pending)

  def refresh_tray_state() -> None:
    nonlocal poll_pending
    if poll_pending or action_pending:
      return
    poll_pending = True

    def finished(snap, error):
      nonlocal poll_pending, last_snapshot
      poll_pending = False
      if error:
        last_snapshot = None
        tray.setToolTip(tray_tooltip("WARP status unavailable"))
      else:
        last_snapshot = snap
        tray.setToolTip(tray_tooltip(snapshot_label(snap)))
      tray.setIcon(QIcon(tray_state_icon_path(root, tray_icon_state(last_snapshot))))
      refresh_connection_action()

    runner.submit(client.snapshot, finished)

  def refresh_tooltip() -> None:
    refresh_tray_state()

  menu = QMenu()
  menu.addAction("Show Cloudflare One WARP", show_window)
  menu.addSeparator()
  connection_action = QAction("Connect", menu)
  connection_action.triggered.connect(run_connection_action)
  menu.addAction(connection_action)
  menu.aboutToShow.connect(refresh_connection_action)
  menu.addSeparator()
  menu.addAction("Settings…", show_settings)
  menu.addAction("Reload window", lambda: show_window(force_reload=True))
  menu.addAction("Show status notification", lambda: runner.submit(lambda: notify_status(root, launcher), lambda _value, _error: None))
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
    "Cloudflare One WARP tray started (PyQt6 native shell). "
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
    tray_active = "--tray-active" in args or os.environ.get("CLOUDFLARE_ONE_WARP_TRAY_ACTIVE") == "1"
    extra = ["--tray-active"] if tray_active else []
    return subprocess.call([sys.executable, script, *extra])
  show_window = "--panel" in args or os.environ.get("CLOUDFLARE_ONE_WARP_SHOW_PANEL") == "1"
  return run_tray_app(show_window_on_start=show_window)


if __name__ == "__main__":
  raise SystemExit(main())
