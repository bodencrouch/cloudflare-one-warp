#!/usr/bin/env python3
"""Shared daemon API client and WARP connection control for tray/native shells."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from typing import Any


DEFAULT_PORT = 4173
PORT_SCAN = 31


def session_token_path(port: int) -> str:
  """Mirror lib/http/request-gate.mjs sessionTokenPath()."""
  home = os.environ.get("HOME") or os.path.expanduser("~")
  return os.path.join(home, ".config", "thirdflare", f"session-{port}.token")


def app_dir() -> str:
  env = os.environ.get("THIRDFLARE_APP_DIR")
  if env:
    return env
  return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def launcher_path(root: str | None = None) -> str:
  root = root or app_dir()
  return os.path.join(root, "bin", "thirdflare")


def ensure_daemon(launcher: str | None = None, *, webui: bool = True) -> None:
  """Start or reuse the daemon. Desktop shells request Web UI capability."""
  launcher = launcher or launcher_path()
  env = os.environ.copy()
  args = [launcher, "--daemon"] if webui else [launcher, "--no-open"]
  if webui:
    env["THIRDFLARE_WEBUI"] = "1"
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


class ThirdFlareClient:
  """Minimal HTTP client for the local ThirdFlare One daemon."""

  def __init__(self, host: str = "127.0.0.1") -> None:
    self.host = host
    env_port = os.environ.get("THIRDFLARE_PORT") or os.environ.get("CLOUDFLARE_ONE_GUI_PORT")
    self.base_port = int(env_port) if env_port else DEFAULT_PORT
    self.base_url: str | None = None
    self.session: str | None = None
    self.discover()

  def discover(self) -> bool:
    self.session = None
    for port in range(self.base_port, self.base_port + PORT_SCAN):
      url = f"http://{self.host}:{port}/api/health"
      try:
        with urllib.request.urlopen(url, timeout=1.5) as response:
          payload = json.loads(response.read().decode("utf-8"))
      except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        continue
      app_id = payload.get("app")
      if payload.get("ok") and app_id in ("thirdflare", "thirdflare-one", "cloudflare-one-gui"):
        self.base_url = f"http://{self.host}:{port}"
        self.base_port = port
        return True
    self.base_url = None
    return False

  def load_session(self, refresh: bool = False) -> str | None:
    """Read this daemon's session credential from disk, or ask the daemon for it."""
    if self.session and not refresh:
      return self.session
    try:
      with open(session_token_path(self.base_port), encoding="utf-8") as handle:
        token = handle.read().strip()
      if token:
        self.session = token
        return token
    except OSError:
      pass
    if self.base_url:
      try:
        request = urllib.request.Request(
          f"{self.base_url}/api/session",
          headers={"Accept": "application/json"},
          method="GET",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
          payload = json.loads(response.read().decode("utf-8"))
        token = str(payload.get("session") or "")
        if token:
          self.session = token
          return token
      except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        pass
    self.session = None
    return None

  def _send(self, method: str, path: str, body: dict[str, Any] | None) -> str:
    assert self.base_url
    data = None
    headers = {"Accept": "application/json"}
    if method.upper() == "GET":
      if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    else:
      # The daemon only accepts JSON for anything that changes state, so send an
      # empty object rather than no body at all.
      data = json.dumps(body if body is not None else {}).encode("utf-8")
      headers["Content-Type"] = "application/json"
      token = self.load_session()
      if token:
        headers["X-Thirdflare-Session"] = token
    request = urllib.request.Request(
      f"{self.base_url}{path}",
      data=data,
      headers=headers,
      method=method,
    )
    with urllib.request.urlopen(request, timeout=20) as response:
      return response.read().decode("utf-8")

  def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    if not self.base_url and not self.discover():
      raise RuntimeError("ThirdFlare One daemon is not running.")
    try:
      raw = self._send(method, path, body)
    except urllib.error.HTTPError as exc:
      # A restarted daemon has a new credential; refresh once before giving up.
      if exc.code == 403 and method.upper() != "GET" and self.load_session(refresh=True):
        try:
          raw = self._send(method, path, body)
        except urllib.error.HTTPError as retry_exc:
          detail = retry_exc.read().decode("utf-8", errors="replace")
          raise RuntimeError(detail or str(retry_exc)) from retry_exc
      else:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(detail or str(exc)) from exc
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
    """Ensure daemon serves the Web UI; persist enable and restart if needed."""
    launcher = launcher or launcher_path()
    if self.webui_enabled():
      return
    try:
      self.post("/api/config/webui", {"enabled": True})
    except Exception:
      pass
    subprocess.run(
      [launcher, "--stop"],
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      timeout=10,
    )
    env = os.environ.copy()
    env["THIRDFLARE_WEBUI"] = "1"
    subprocess.run(
      [launcher, "--daemon"],
      check=False,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      timeout=20,
      env=env,
    )
    self.discover()

  def restart_daemon(self, launcher: str | None = None, *, webui: bool | None = None) -> None:
    launcher = launcher or launcher_path()
    env = os.environ.copy()
    if webui is True:
      env["THIRDFLARE_WEBUI"] = "1"
    elif webui is False:
      env["THIRDFLARE_WEBUI"] = "0"
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
      raise RuntimeError("ThirdFlare One daemon is not running.")
    base = self.base_url or f"http://{self.host}:{self.base_port}"
    return f"{base}/?shell=1"

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
  return str(status.get("label") or "ThirdFlare One")
