"""Serial background IO with results delivered on the Qt application thread."""
from concurrent.futures import ThreadPoolExecutor
from PyQt6.QtCore import QObject, pyqtSignal, pyqtSlot


class AsyncRunner(QObject):
  completed = pyqtSignal(int, object, object)

  def __init__(self, parent=None):
    super().__init__(parent)
    self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="warp-tray-io")
    self._callbacks = {}
    self._sequence = 0
    self._closed = False
    self.completed.connect(self._deliver)

  def submit(self, operation, callback):
    if self._closed:
      return
    self._sequence += 1
    ident = self._sequence
    self._callbacks[ident] = callback
    future = self._pool.submit(operation)

    def finished(result):
      try:
        value, error = result.result(), None
      except Exception as exc:
        value, error = None, exc
      if not self._closed:
        self.completed.emit(ident, value, error)

    future.add_done_callback(finished)

  @pyqtSlot(int, object, object)
  def _deliver(self, ident, value, error):
    callback = self._callbacks.pop(ident, None)
    if callback and not self._closed:
      callback(value, error)

  def close(self):
    self._closed = True
    self._callbacks.clear()
    self._pool.shutdown(wait=False, cancel_futures=True)
