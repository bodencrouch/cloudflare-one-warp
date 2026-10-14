"""Native browser navigation boundaries against the production WebEngine page."""
import importlib.util
import os
import pathlib
import tempfile
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")
try:
  from PyQt6.QtCore import QUrl
  from PyQt6.QtWidgets import QApplication
  from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
  AVAILABLE = True
except ImportError:
  AVAILABLE = False

@unittest.skipUnless(AVAILABLE, "PyQt6-WebEngine is unavailable")
class NativePageBoundary(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    cls.app = QApplication.instance() or QApplication(["native-page-regression"])
    path = pathlib.Path(__file__).with_name("tray-qt.py")
    spec = importlib.util.spec_from_file_location("warp_tray_qt", path)
    cls.module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cls.module)

  def test_private_handoff_and_navigation_boundaries(self):
    with tempfile.TemporaryDirectory() as home:
      old_home = os.environ.get("XDG_CONFIG_HOME")
      os.environ["XDG_CONFIG_HOME"] = home
      try:
        directory = pathlib.Path(home) / "cloudflare-one-warp" / "webui-handoff"
        directory.mkdir(parents=True, mode=0o700)
        handoff = directory / "handoff-14885-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.html"
        handoff.write_text("<!doctype html><title>Owner handoff</title>")
        handoff.chmod(0o600)
        external = []
        page = self.module.create_native_page(open_external=lambda url: external.append(url.toString()))
        self.assertTrue(page.profile().isOffTheRecord())
        remote = QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls
        self.assertFalse(page.settings().testAttribute(remote))
        uri = QUrl.fromLocalFile(str(handoff)).toString()
        page.set_authenticated_target(uri, "http://127.0.0.1:14885")
        self.assertTrue(page.settings().testAttribute(remote))
        other = QWebEnginePage.NavigationType.NavigationTypeOther
        clicked = QWebEnginePage.NavigationType.NavigationTypeLinkClicked
        self.assertTrue(page.acceptNavigationRequest(QUrl(uri), other, True))
        self.assertTrue(page.acceptNavigationRequest(QUrl("http://127.0.0.1:14885/?shell=1"), other, True))
        for url in ["file:///etc/passwd", "http://127.0.0.1:14886/", "http://127.0.0.1:14885/api/account", "https://example.com/"]:
          self.assertFalse(page.acceptNavigationRequest(QUrl(url), other, True))
        self.assertEqual(external, [])
        self.assertFalse(page.acceptNavigationRequest(QUrl("http://127.0.0.1:14885/"), other, False))
        self.assertFalse(page.acceptNavigationRequest(QUrl("https://example.com/"), clicked, True))
        self.assertEqual(external, ["https://example.com/"])
        handoff.chmod(0o644)
        with self.assertRaises(ValueError):
          page.set_authenticated_target(uri, "http://127.0.0.1:14885")
        page.deleteLater()
      finally:
        if old_home is None:
          os.environ.pop("XDG_CONFIG_HOME", None)
        else:
          os.environ["XDG_CONFIG_HOME"] = old_home

if __name__ == "__main__":
  unittest.main()
