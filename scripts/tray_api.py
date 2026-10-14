#!/usr/bin/env python3
"""Shared daemon API client and WARP connection control for tray/native shells."""

from __future__ import annotations

import json
import os
import subprocess
import stat
import urllib.error
import urllib.request
from typing import Any


DEFAULT_PORT = 4173
PORT_SCAN = 31
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self, req, fp, code, msg, headers, newurl):
    return None


# Local credentials must never follow HTTP redirects or desktop proxy settings.
_LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _read_response(response) -> str:
  content = response.read(MAX_RESPONSE_BYTES + 1)
  if len(content) > MAX_RESPONSE_BYTES:
    raise ValueError("Daemon response exceeds size limit")
  return content.decode("utf-8")


def session_token_path(port: int) -> str:
  """Mirror lib/http/request-gate.mjs sessionTokenPath()."""
  home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or os.path.expanduser("~")
  config_home = os.environ.get("XDG_CONFIG_HOME")
  if not config_home or not os.path.isabs(config_home):
    config_home = os.path.join(home, ".config")
  return os.path.join(config_home, "cloudflare-one-warp", f"session-{port}.token")


def configured_port() -> int:
  """Resolve the same system/legacy/user/env port layers as the Node daemon."""
  home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or os.path.expanduser("~")
  config_home = os.environ.get("XDG_CONFIG_HOME")
  if not config_home or not os.path.isabs(config_home):
    config_home = os.path.join(home, ".config")
  port = DEFAULT_PORT
  paths = ["/etc/cloudflare-one-warp/config.json",
           os.path.join(home, ".config", "cloudflare-one-gui", "config.json"),
           os.path.join(home, ".config", "cloudflare-one-warp", "config.json"),
           os.path.join(config_home, "cloudflare-one-warp", "config.json")]
  for path in paths:
    try:
      with open(path, encoding="utf-8") as handle:
        value = json.load(handle).get("server", {}).get("port")
      if isinstance(value, int) and not isinstance(value, bool) and 1024 <= value <= 65535:
        port = value
    except (OSError, ValueError, AttributeError):
      pass
  value = os.environ.get("CLOUDFLARE_ONE_WARP_PORT") or os.environ.get("CLOUDFLARE_ONE_GUI_PORT") or os.environ.get("PORT")
  if value:
    try:
      parsed = int(value)
      if 1024 <= parsed <= 65535:
        port = parsed
    except ValueError:
      pass
  return port


def configured_host() -> str:
  """Mirror effectiveBind and its system/user/environment configuration layers."""
  home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or os.path.expanduser("~")
  config_home = os.environ.get("XDG_CONFIG_HOME")
  if not config_home or not os.path.isabs(config_home):
    config_home = os.path.join(home, ".config")
  bind = "127.0.0.1"
  for path in ("/etc/cloudflare-one-warp/config.json",
    os.path.join(home, ".config", "cloudflare-one-gui", "config.json"),
    os.path.join(home, ".config", "cloudflare-one-warp", "config.json"),
    os.path.join(config_home, "cloudflare-one-warp", "config.json")):
    try:
      with open(path, encoding="utf-8") as handle:
        server = json.load(handle).get("server", {})
      if isinstance(server, dict) and "bind" in server:
        bind = server["bind"]
    except (OSError, ValueError, AttributeError):
      pass
  bind = os.environ.get("CLOUDFLARE_ONE_WARP_BIND") or os.environ.get("CLOUDFLARE_ONE_GUI_BIND") or bind
  bind = str(bind or "127.0.0.1").strip().lower()
  return "::1" if bind == "::1" else "127.0.0.1"


def app_dir() -> str:
  env = os.environ.get("CLOUDFLARE_ONE_WARP_APP_DIR")
  if env:
    return env
  return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def launcher_path(root: str | None = None) -> str:
  root = root or app_dir()
  return os.path.join(root, "bin", "cloudflare-one-warp")


def ensure_daemon(launcher: str | None = None, *, webui: bool = True) -> None:
  """Start or reuse the daemon. Desktop shells request Web UI capability."""
  launcher = launcher or launcher_path()
  env = os.environ.copy()
  args = [launcher, "--daemon"] if webui else [launcher, "--no-open"]
  if webui:
    env["CLOUDFLARE_ONE_WARP_WEBUI"] = "1"
  subprocess.run(
    args,
    check=False,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    timeout=20,
    env=env,
  )


def connection_control(snapshot: dict[str, Any] | None) -> dict[str, Any]:
  """
  Single connect/disconnect control — mirrors public/app.js connectionToggle().
  Returns action (connect|disconnect|None), label, and enabled flag.
  """
  snap = snapshot or {}
  readiness = snap.get("readiness") or {}
  status = snap.get("status") or {}
  hard_blocked = bool(readiness.get("hardBlocked"))
  if hard_blocked or (not readiness and not (snap.get("daemon") or {}).get("available", True)):
    return {"action": None, "label": "Connect", "enabled": False}
  connected = bool(status.get("connected"))
  connecting = bool(status.get("connecting"))
  if connecting:
    return {"action": None, "label": "Connecting…", "enabled": False}
  if connected:
    return {"action": "disconnect", "label": "Disconnect", "enabled": True}
  return {"action": "connect", "label": "Connect", "enabled": True}


def tray_icon_state(snapshot: dict[str, Any] | None) -> str:
  """Map snapshot readiness + connection to a tray icon variant name."""
  snap = snapshot or {}
  readiness = snap.get("readiness") or {}
  status = snap.get("status") or {}
  if readiness.get("needsAttention") or readiness.get("hardBlocked"):
    return "needs-attention"
  if status.get("connecting"):
    return "connecting"
  if status.get("connected"):
    return "connected"
  return "disconnected"


class CloudflareOneWarpClient:
  """Minimal HTTP client for the local Cloudflare One WARP daemon."""

  def __init__(self, host: str | None = None) -> None:
    host = host or configured_host()
    if host not in ("127.0.0.1", "localhost", "::1"):
      raise ValueError("Daemon host must be loopback")
    self.host = "[::1]" if host == "::1" else host
    self.base_port = configured_port()
    self.base_url: str | None = None
    self.session: str | None = None
    self.discover()

  def discover(self) -> bool:
    self.session = None
    ports = list(range(self.base_port, min(65536, self.base_port + PORT_SCAN)))
    runtime = os.environ.get("XDG_RUNTIME_DIR")
    runtime_app = os.path.join(runtime, "cloudflare-one-warp") if runtime else os.path.join(
      os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "cloudflare-one-warp", "runtime")
    try:
      with open(os.path.join(runtime_app, "server.port"), encoding="utf-8") as handle:
        selected = int(handle.read().strip())
      if 1024 <= selected <= 65535:
        ports.insert(0, selected)
    except (OSError, ValueError):
      pass
    for port in dict.fromkeys(ports):
      url = f"http://{self.host}:{port}/api/health"
      try:
        with _LOCAL_HTTP.open(url, timeout=1.5) as response:
          payload = json.loads(_read_response(response))
      except (OSError, urllib.error.URLError, ValueError, TimeoutError):
        continue
      if not isinstance(payload, dict):
        continue
      app_id = payload.get("app")
      if payload.get("ok") and app_id in ("cloudflare-one-warp", "cloudflare-one-gui"):
        self.base_url = f"http://{self.host}:{port}"
        self.base_port = port
        return True
    self.base_url = None
    return False

  def load_session(self, refresh: bool = False) -> str | None:
    """Read this owner's private daemon credential; never bootstrap over HTTP."""
    if self.session and not refresh:
      return self.session
    try:
      if os.name == "nt":
        # NTFS privacy is an ACL property, not POSIX mode bits. Use the same
        # SID/DACL validation as the daemon; the secret travels only in a pipe.
        root = app_dir()
        bundled = os.path.join(root, "runtime", "node", "bin", "node")
        node = bundled if os.path.isfile(bundled) and os.access(bundled, os.X_OK) else (
          os.environ.get("CLOUDFLARE_ONE_WARP_NODE") or os.environ.get("CLOUDFLARE_ONE_GUI_NODE") or "node")
        program = """import {pathToFileURL} from 'node:url';
import {openSync,closeSync,constants,readSync} from 'node:fs';
const {assertPrivateFile}=await import(pathToFileURL(process.argv[1]));
assertPrivateFile(process.argv[2]);
const fd=openSync(process.argv[2],constants.O_RDONLY|(constants.O_NOFOLLOW||0));
try { const bytes=Buffer.alloc(129); const count=readSync(fd,bytes,0,bytes.length,0); process.stdout.write(bytes.subarray(0,count)); }
finally { closeSync(fd); }"""
        checked = subprocess.run([node, "--input-type=module", "-e", program,
          os.path.join(root, "lib", "security", "private-files.mjs"), session_token_path(self.base_port)],
          check=True, capture_output=True, text=True, timeout=20)
        token = checked.stdout.strip()
      else:
        descriptor = os.open(session_token_path(self.base_port), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
          info = os.fstat(handle.fileno())
          if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or (hasattr(os, "getuid") and info.st_uid != os.getuid()):
            raise OSError("Session credential is not private")
          token = handle.read(129).strip()
      if len(token) == 64 and all(char in "0123456789abcdefABCDEF" for char in token):
        self.session = token
        return token
    except (OSError, UnicodeError, subprocess.SubprocessError):
      pass
    self.session = None
    return None

  def _send(self, method: str, path: str, body: dict[str, Any] | None) -> str:
    assert self.base_url
    data = None
    headers = {"Accept": "application/json"}
    token = self.load_session()
    if token:
      headers["X-Cloudflare-One-Warp-Session"] = token
    elif path.split("?", 1)[0] not in ("/api/health", "/api/version"):
      raise RuntimeError("Daemon session credential is unavailable. Restart the daemon as this user.")
    if method.upper() == "GET":
      if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    else:
      # The daemon only accepts JSON for anything that changes state, so send an
      # empty object rather than no body at all.
      data = json.dumps(body if body is not None else {}).encode("utf-8")
      headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
      f"{self.base_url}{path}",
      data=data,
      headers=headers,
      method=method,
    )
    with _LOCAL_HTTP.open(request, timeout=20) as response:
      return _read_response(response)

  def _request(self, method: str, path: str, body: dict[str, Any] | None = None, *, _retry_transport: bool = True) -> dict[str, Any]:
    if not self.base_url and not self.discover():
      raise RuntimeError("Cloudflare One WARP daemon is not running.")
    try:
      raw = self._send(method, path, body)
    except urllib.error.HTTPError as exc:
      # Retry only a pre-handler credential rejection, never an action failure.
      detail = exc.read(MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
      try:
        rejection = json.loads(detail)
      except (ValueError, TypeError):
        rejection = {}
      auth_rejected = exc.code == 401 and isinstance(rejection, dict) and rejection.get("reason") == "session_required"
      if auth_rejected and self.load_session(refresh=True):
        try:
          raw = self._send(method, path, body)
        except urllib.error.HTTPError as retry_exc:
          detail = retry_exc.read(MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
          raise RuntimeError(detail or str(retry_exc)) from retry_exc
      else:
        raise RuntimeError(detail or str(exc)) from exc
    except (OSError, urllib.error.URLError, TimeoutError):
      # A service restart may select another port. Reads may rediscover once;
      # writes are never replayed after an ambiguous transport failure.
      if method.upper() != "GET" or not _retry_transport:
        raise
      self.base_url = None
      self.session = None
      if not self.discover():
        raise RuntimeError("Cloudflare One WARP daemon is not running.")
      return self._request(method, path, body, _retry_transport=False)
    if not raw.strip():
      return {}
    return json.loads(raw)

  def get(self, path: str) -> dict[str, Any]:
    return self._request("GET", path)

  def post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return self._request("POST", path, body)

  def health(self) -> dict[str, Any]:
    return self.get("/api/health")

  def snapshot(self) -> dict[str, Any]:
    return self.get("/api/snapshot")

  def action(self, name: str) -> dict[str, Any]:
    return self.post("/api/action", {"action": name})

  def webui_enabled(self) -> bool:
    try:
      return bool(self.health().get("webuiEnabled"))
    except Exception:
      return False

  def ensure_daemon_webui(self, launcher: str | None = None) -> None:
    """Request UI capability for this session without changing saved preferences."""
    launcher = launcher or launcher_path()
    if self.webui_enabled():
      return
    env = os.environ.copy()
    env["CLOUDFLARE_ONE_WARP_WEBUI"] = "1"
    # The launcher reuses/restarts only its managed process, or creates an
    # additional UI-capable daemon beside an unmanaged API-only service.
    subprocess.run(
      [launcher, "--daemon"],
      check=True,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      timeout=20,
      env=env,
    )
    if not self.discover() or not self.webui_enabled():
      raise RuntimeError("Cloudflare One WARP Web UI could not be started.")

  def restart_daemon(self, launcher: str | None = None, *, webui: bool | None = None) -> None:
    launcher = launcher or launcher_path()
    env = os.environ.copy()
    if webui is True:
      env["CLOUDFLARE_ONE_WARP_WEBUI"] = "1"
    elif webui is False:
      env["CLOUDFLARE_ONE_WARP_WEBUI"] = "0"
    subprocess.run(
      [launcher, "--stop"],
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      timeout=10,
    )
    args = [launcher, "--daemon"] if (webui is not False) else [launcher, "--no-open"]
    subprocess.run(
      args,
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      timeout=20,
      env=env,
    )
    self.discover()

  def app_url(self) -> str:
    if not self.base_url and not self.discover():
      raise RuntimeError("Cloudflare One WARP daemon is not running.")
    base = self.base_url or f"http://{self.host}:{self.base_port}"
    root = app_dir()
    bundled = os.path.join(root, "runtime", "node", "bin", "node")
    node = bundled if os.path.isfile(bundled) and os.access(bundled, os.X_OK) else (
      os.environ.get("CLOUDFLARE_ONE_WARP_NODE") or os.environ.get("CLOUDFLARE_ONE_GUI_NODE") or "node")
    result = subprocess.run([node, os.path.join(root, "scripts", "webui-handoff.mjs"), base, "--shell"],
      check=True, capture_output=True, text=True, timeout=90 if os.name == "nt" else 5)
    return result.stdout.strip()

  def run_connection_action(self) -> dict[str, Any]:
    """Perform the authoritative connect or disconnect for the current snapshot."""
    snap = self.snapshot()
    ctrl = connection_control(snap)
    if not ctrl["enabled"] or not ctrl["action"]:
      return {"ok": False, "skipped": True, "control": ctrl, "snapshot": snap}
    result = self.action(str(ctrl["action"]))
    return {"ok": True, "control": ctrl, "result": result, "snapshot": snap}


def snapshot_label(snapshot: dict[str, Any]) -> str:
  daemon = snapshot.get("daemon") or {}
  status = snapshot.get("status") or {}
  if not daemon.get("available", True):
    return "daemon unavailable"
  return str(status.get("label") or "Cloudflare One WARP")
