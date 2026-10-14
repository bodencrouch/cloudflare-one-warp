#!/usr/bin/env python3
"""Exercise Qt background IO dispatch without a desktop or real daemon."""
import importlib.util
import pathlib
import threading
import time
import unittest

try:
  from PyQt6.QtCore import QCoreApplication, QEventLoop, QTimer
  from tray_workers import AsyncRunner
except ImportError:
  QCoreApplication = None


@unittest.skipUnless(QCoreApplication, "PyQt6 is optional")
class WorkerTests(unittest.TestCase):
  def test_slow_operations_leave_event_loop_responsive_and_callback_on_ui_thread(self):
    app = QCoreApplication.instance() or QCoreApplication([])
    loop = QEventLoop()
    runner = AsyncRunner(app)
    ui_thread = threading.get_ident()
    ticks = []
    outcomes = []
    timer = QTimer()
    timer.timeout.connect(lambda: ticks.append(threading.get_ident()))
    timer.start(5)

    def slow():
      time.sleep(0.08)
      return threading.get_ident()

    def delivered(value, error):
      outcomes.append((value, error, threading.get_ident()))
      loop.quit()

    runner.submit(slow, delivered)
    QTimer.singleShot(2000, loop.quit)
    loop.exec()
    timer.stop()
    runner.close()
    self.assertGreater(len(ticks), 3)
    self.assertEqual(len(outcomes), 1)
    worker_thread, error, callback_thread = outcomes[0]
    self.assertIsNone(error)
    self.assertNotEqual(worker_thread, ui_thread)
    self.assertEqual(callback_thread, ui_thread)
    self.assertTrue(all(thread == ui_thread for thread in ticks))

  def test_closed_runner_discards_late_results(self):
    app = QCoreApplication.instance() or QCoreApplication([])
    runner = AsyncRunner(app)
    outcomes = []
    runner.submit(lambda: time.sleep(0.02), lambda *args: outcomes.append(args))
    runner.close()
    loop = QEventLoop()
    QTimer.singleShot(60, loop.quit)
    loop.exec()
    self.assertEqual(outcomes, [])


if __name__ == "__main__":
  unittest.main()
