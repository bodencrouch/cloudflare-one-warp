#!/usr/bin/env python3
"""Cloudflare One WARP StatusNotifierItem tray (KDE Plasma / Wayland compatible)."""

from __future__ import annotations

import os
import subprocess
import sys

ICON_NAME = "cloudflare-one-warp"
TRAY_ICON_SIZES = (16, 22, 24, 32, 48)
SNI_OBJECT_PATH = "/org/ayatana/NotificationItem/cloudflare_one_warp"


def _require_gi():
  import gi

  gi.require_version("Gtk", "3.0")
  from gi.repository import GLib, Gtk

  try:
    gi.require_version("AppIndicator3", "0.1")
    from gi.repository import AppIndicator3
  except ValueError:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as AppIndicator3

  return AppIndicator3, GLib, Gtk


def app_dir() -> str:
  env = os.environ.get("CLOUDFLARE_ONE_WARP_APP_DIR")
  if env:
    return env
  return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def launcher_path(root: str) -> str:
  return os.path.join(root, "bin", "cloudflare-one-warp")


def icon_source_path(root: str) -> str:
  tray_icon = os.path.join(root, "assets", "cloudflare-one-warp-tray.svg")
  if os.path.isfile(tray_icon):
    return tray_icon
  return os.path.join(root, "assets", "cloudflare-one-warp.svg")


def icon_theme_root() -> str:
  data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(
    os.path.expanduser("~"),
    ".local",
    "share",
  )
  return os.path.join(data_home, "icons", "hicolor")


def user_icon_theme_dir() -> str:
  return os.path.join(icon_theme_root(), "scalable", "apps")


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
  """Install raster icons for KDE Plasma (SVG-only tray icons often stay invisible)."""
  source = icon_source_path(root)
  theme_root = icon_theme_root()
  scalable_target = os.path.join(user_icon_theme_dir(), f"{ICON_NAME}.svg")
  os.makedirs(os.path.dirname(scalable_target), exist_ok=True)
  created = False

  if not os.path.isfile(scalable_target):
    with open(source, "rb") as src, open(scalable_target, "wb") as dst:
      dst.write(src.read())
    created = True

  for size in TRAY_ICON_SIZES:
    png_dir = os.path.join(theme_root, f"{size}x{size}", "apps")
    png_target = os.path.join(png_dir, f"{ICON_NAME}.png")
    os.makedirs(png_dir, exist_ok=True)
    if not os.path.isfile(png_target):
      _write_png_icon(source, png_target, size)
      if os.path.isfile(png_target):
        created = True

  if created:
    try:
      subprocess.run(
        ["gtk-update-icon-cache", "-f", "-t", theme_root],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=3,
      )
    except (OSError, subprocess.TimeoutExpired):
      pass
  return ICON_NAME


def apply_kde_icon_pixmap() -> None:
  """Push a raster IconPixmap over D-Bus for Plasma when theme lookup fails."""
  png = tray_icon_png(22)
  if not os.path.isfile(png):
    png = tray_icon_png(24)
  if not os.path.isfile(png):
    return

  import gi

  gi.require_version("GdkPixbuf", "2.0")
  gi.require_version("GLib", "2.0")
  from gi.repository import Gio, GLib, GdkPixbuf

  pixbuf = GdkPixbuf.Pixbuf.new_from_file(png)
  width = pixbuf.get_width()
  height = pixbuf.get_height()
  ok, data = pixbuf.save_to_bufferv("png", [], [])
  if not ok:
    return

  bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
  watcher = Gio.DBusProxy.new_sync(
    bus,
    Gio.DBusProxyFlags.NONE,
    None,
    "org.kde.StatusNotifierWatcher",
    "/StatusNotifierWatcher",
    "org.kde.StatusNotifierWatcher",
    None,
  )
  items = watcher.get_cached_property("RegisteredStatusNotifierItems")
  if items is None:
    return

  service_name = None
  for entry in items.unpack():
    if entry.endswith(SNI_OBJECT_PATH):
      service_name = entry.split("/", 1)[0]
      break
  if not service_name:
    return

  pixmaps = GLib.Variant("a(iiay)", [(width, height, data)])
  try:
    bus.call_sync(
      service_name,
      SNI_OBJECT_PATH,
      "org.freedesktop.DBus.Properties",
      "Set",
      GLib.Variant("(ssv)", ("org.kde.StatusNotifierItem", "IconPixmap", pixmaps)),
      None,
      Gio.DBusCallFlags.NONE,
      2000,
      None,
    )
  except GLib.Error:
    pass


def run_cmd(command: list[str], env: dict[str, str] | None = None) -> None:
  merged = os.environ.copy()
  if env:
    merged.update(env)
  subprocess.Popen(
    command,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
    env=merged,
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


def ensure_daemon(launcher: str) -> None:
  from tray_api import ensure_daemon as ensure_daemon_api

  ensure_daemon_api(launcher, webui=True)


def status_text(launcher: str) -> str:
  return capture_text([launcher, "--warp-status"]) or "Cloudflare One WARP"


def notify_status(root: str, launcher: str) -> None:
  text = status_text(launcher)
  print(text)
  icon = tray_icon_png(48) if os.path.isfile(tray_icon_png(48)) else icon_source_path(root)
  try:
    subprocess.run(
      ["notify-send", "Cloudflare One WARP", text, f"--icon={icon}"],
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
  except OSError:
    pass


def add_menu_item(menu, Gtk, label: str, callback) -> None:
  item = Gtk.MenuItem.new_with_label(label)
  item.connect("activate", lambda *_args: callback())
  menu.append(item)


def configure_indicator_icon(indicator, icon_name: str) -> None:
  indicator.set_icon(icon_name)


def main() -> int:
  if len(sys.argv) > 1 and sys.argv[1] == "--status":
    root = app_dir()
    notify_status(root, launcher_path(root))
    return 0

  AppIndicator3, GLib, Gtk = _require_gi()

  root = app_dir()
  launcher = launcher_path(root)
  icon_name = ensure_tray_icon(root)
  tray_script = os.path.join(root, "bin", "cloudflare-one-warp-tray")

  ensure_daemon(launcher)

  indicator = AppIndicator3.Indicator.new(
    "cloudflare-one-warp",
    icon_name,
    AppIndicator3.IndicatorCategory.APPLICATION_STATUS,
  )
  indicator.set_status(AppIndicator3.IndicatorStatus.ACTIVE)
  configure_indicator_icon(indicator, icon_name)
  indicator.set_title(f"Cloudflare One WARP - {status_text(launcher)}")

  menu = Gtk.Menu()
  menu.set_reserve_toggle_size(False)

  warp_script = os.path.join(root, "scripts", "tray-warp-action.py")

  add_menu_item(
    menu,
    Gtk,
    "Show Cloudflare One WARP",
    lambda: run_cmd([os.path.join(root, "bin", "cloudflare-one-warp-tray"), "--panel"]),
  )

  connection_item = Gtk.MenuItem.new_with_label("Connect")
  menu.append(connection_item)

  def refresh_connection_item() -> bool:
    try:
      from tray_api import CloudflareOneWarpClient, connection_control, ensure_daemon

      ensure_daemon(launcher)
      ctrl = connection_control(CloudflareOneWarpClient().snapshot())
      connection_item.set_label(str(ctrl["label"]))
      connection_item.set_sensitive(bool(ctrl["enabled"]))
    except Exception:
      connection_item.set_label("Connect")
      connection_item.set_sensitive(False)
    return True

  def on_connection(_item) -> None:
    run_cmd([sys.executable, "-u", warp_script], env={"CLOUDFLARE_ONE_WARP_APP_DIR": root})

  connection_item.connect("activate", on_connection)
  menu.connect("show", lambda *_args: refresh_connection_item())

  add_menu_item(
    menu,
    Gtk,
    "Show Status",
    lambda: run_cmd([tray_script, "--status"]),
  )
  add_menu_item(menu, Gtk, "Quit", Gtk.main_quit)

  menu.show_all()
  indicator.set_menu(menu)

  def refresh_title() -> bool:
    indicator.set_title(f"Cloudflare One WARP - {status_text(launcher)}")
    refresh_connection_item()
    return True

  def push_pixmap() -> bool:
    apply_kde_icon_pixmap()
    return False

  GLib.timeout_add_seconds(30, refresh_title)
  GLib.timeout_add(500, push_pixmap)

  print(
    "Cloudflare One WARP tray started (StatusNotifierItem). "
    "Look for the icon in your KDE system tray.",
    file=sys.stderr,
  )
  print(
    "If hidden, open System Settings → Plasma → System Tray → Entries and enable Cloudflare One WARP.",
    file=sys.stderr,
  )

  Gtk.main()
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
