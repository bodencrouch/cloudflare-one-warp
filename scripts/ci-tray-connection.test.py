#!/usr/bin/env python3
"""Unit tests for tray connection_control (mirrors Web UI connectionToggle)."""

from __future__ import annotations

import unittest
import json
import os
import tempfile
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tray_api import CloudflareOneWarpClient, session_token_path
import queue
import threading
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

from tray_api import connection_control


class ConnectionControlTest(unittest.TestCase):
  def test_disconnected_offers_connect(self) -> None:
    ctrl = connection_control({
      "daemon": {"available": True},
      "status": {"connected": False, "connecting": False, "disconnected": True},
    })
    self.assertEqual(ctrl["action"], "connect")
    self.assertEqual(ctrl["label"], "Connect")
    self.assertTrue(ctrl["enabled"])

  def test_connected_offers_disconnect(self) -> None:
    ctrl = connection_control({
      "daemon": {"available": True},
      "status": {"connected": True, "connecting": False},
    })
    self.assertEqual(ctrl["action"], "disconnect")
    self.assertEqual(ctrl["label"], "Disconnect")
    self.assertTrue(ctrl["enabled"])

  def test_connecting_is_disabled(self) -> None:
    ctrl = connection_control({
      "daemon": {"available": True},
      "status": {"connected": False, "connecting": True},
    })
    self.assertIsNone(ctrl["action"])
    self.assertEqual(ctrl["label"], "Connecting…")
    self.assertFalse(ctrl["enabled"])

  def test_daemon_missing_disables_connect(self) -> None:
    ctrl = connection_control({
      "daemon": {"available": False},
      "status": {},
    })
    self.assertIsNone(ctrl["action"])
    self.assertEqual(ctrl["label"], "Connect")
    self.assertFalse(ctrl["enabled"])



class SniWorkerTest(unittest.TestCase):
  def test_refresh_coalesces_slow_io_and_dispatches_callback_to_gui_thread(self):
    spec = spec_from_file_location("tray_sni", Path(__file__).with_name("tray-sni.py"))
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    dispatched = queue.Queue()
    runner = module.BackgroundRefresh(dispatched.put)
    outcomes = []
    main_thread = threading.get_ident()
    release = threading.Event()
    def slow():
      release.wait(2)
      return threading.get_ident()
    try:
      self.assertTrue(runner.submit(slow, lambda value, error: outcomes.append((value, error, threading.get_ident()))))
      self.assertFalse(runner.submit(slow, lambda *_args: self.fail("duplicate refresh")))
      self.assertEqual(outcomes, [])
      release.set()
      dispatched.get(timeout=2)()
      self.assertEqual(len(outcomes), 1)
      self.assertNotEqual(outcomes[0][0], main_thread)
      self.assertIsNone(outcomes[0][1])
      self.assertEqual(outcomes[0][2], main_thread)
    finally:
      release.set()
      runner.close()


class ClientRecoveryTest(unittest.TestCase):
  def test_reads_rediscover_restarted_daemon_and_reload_owner_token(self):
    token = "a" * 64
    snapshots = []
    class Handler(BaseHTTPRequestHandler):
      def do_GET(self):
        if self.path == "/api/health":
          payload = {"ok": True, "app": "cloudflare-one-warp"}
        else:
          snapshots.append(self.headers.get("X-Cloudflare-One-Warp-Session"))
          payload = {"ok": self.headers.get("X-Cloudflare-One-Warp-Session") == token}
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())
      def log_message(self, *_args): pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
      with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {"HOME": home, "XDG_CONFIG_HOME": os.path.join(home, "config"), "XDG_RUNTIME_DIR": os.path.join(home, "runtime")}):
        path = session_token_path(server.server_port)
        os.makedirs(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as handle: handle.write(token)
        os.chmod(path, 0o600)
        client = CloudflareOneWarpClient.__new__(CloudflareOneWarpClient)
        client.host = "127.0.0.1"
        client.base_port = server.server_port
        client.base_url = "http://127.0.0.1:0"
        client.session = "stale-credential"
        self.assertTrue(client.snapshot()["ok"])
        self.assertEqual(snapshots, [token])
        self.assertEqual(client.base_url, "http://127.0.0.1:%d" % server.server_port)
    finally:
      server.shutdown()
      server.server_close()

  def test_opening_native_panel_does_not_persist_webui_or_stop_unmanaged_service(self):
    client = CloudflareOneWarpClient.__new__(CloudflareOneWarpClient)
    checks = iter((False, True))
    client.webui_enabled = lambda: next(checks)
    client.discover = lambda: True
    client.post = lambda *_args: self.fail("panel opening must not persist a user preference")
    with patch("tray_api.subprocess.run") as run:
      client.ensure_daemon_webui("/fixture/launcher")
      self.assertEqual(run.call_count, 1)
      self.assertEqual(run.call_args.args[0], ["/fixture/launcher", "--daemon"])
      self.assertTrue(run.call_args.kwargs["check"])

  def test_transport_failed_mutations_are_never_replayed(self):
    client = CloudflareOneWarpClient.__new__(CloudflareOneWarpClient)
    client.base_url = "http://127.0.0.1:4173"
    calls = []
    def failed(*args):
      calls.append(args)
      raise OSError("connection closed after sending the request")
    client._send = failed
    client.discover = lambda: self.fail("must not rediscover and replay a write")
    with self.assertRaises(OSError): client.action("connect")
    self.assertEqual(len(calls), 1)


if __name__ == "__main__":
  raise SystemExit(unittest.main())
