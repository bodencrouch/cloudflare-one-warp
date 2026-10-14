#!/usr/bin/env python3
"""Unit tests for tray connection_control (mirrors Web UI connectionToggle)."""

from __future__ import annotations

import unittest
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


if __name__ == "__main__":
  raise SystemExit(unittest.main())
