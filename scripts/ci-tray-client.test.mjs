/**
 * Exercises the Python tray client against a live daemon so the session
 * credential wiring is covered outside the Web UI.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.CI_TRAY_PORT || 14743);
// The tray only ships for XDG desktops, and `python3` on Windows is often a
// Store stub, so keep this suite off that platform entirely.
const python =
  process.platform !== "win32" && spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0
    ? "python3"
    : null;

// The tray resolves the credential from $HOME/.config/cloudflare-one-warp, so give the
// daemon and the client a throwaway home instead of the developer's own config.
const home = mkdtempSync(join(tmpdir(), "cf-one-warp-tray-home-"));

function startDaemon() {
  return spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PORT: String(port),
      CLOUDFLARE_ONE_WARP_PORT: String(port),
      WARP_CLI: join(root, "scripts/mock-warp-cli.mjs"),
      CLOUDFLARE_ONE_WARP_WEBUI: "0",
      CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0",
      CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: "1",
      MOCK_WARP_STATE: join(home, "mock-warp.json")
    },
    stdio: "ignore"
  });
}

async function waitHealth() {
  for (let i = 0; i < 75; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("daemon did not become healthy");
}

const trayScript = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(root, "scripts"))})
from tray_api import CloudflareOneWarpClient, session_token_path

client = CloudflareOneWarpClient()
out = {"port": client.base_port, "token_file": session_token_path(client.base_port)}
out["session"] = bool(client.load_session())
out["action"] = client.action("disconnect").get("ok")

# A POST with no body must still satisfy the daemon's JSON requirement; only the
# route handler may object.
try:
  client.post("/api/action")
  out["bodyless"] = "allowed"
except Exception as exc:
  out["bodyless"] = "json_required" if "json_required" in str(exc) else "handler_rejected"

# A restarted daemon mints a new credential, so a cached one must be refreshed.
client.session = "0" * 64
out["stale_recovered"] = client.action("disconnect").get("ok")
client.session = "0" * 64
out["stale_read_recovered"] = isinstance(client.get("/api/snapshot"), dict)
print(json.dumps(out))
`;

test("tray client authenticates mutations and recovers from a stale credential", async (t) => {
  if (!python) {
    t.skip("python3 is unavailable");
    return;
  }
  const daemon = startDaemon();
  t.after(() => {
    daemon.kill("SIGTERM");
    rmSync(home, { recursive: true, force: true });
  });
  await waitHealth();

  const result = spawnSync(python, ["-c", trayScript], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CLOUDFLARE_ONE_WARP_PORT: String(port) }
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim().split("\n").pop());

  assert.equal(payload.port, port);
  assert.equal(payload.token_file, join(home, ".config/cloudflare-one-warp", `session-${port}.token`));
  assert.equal(payload.session, true, "tray could not read the session credential");
  assert.equal(payload.action, true, "tray mutation was refused");
  assert.notEqual(payload.bodyless, "json_required", "tray sent a mutation the daemon rejected as non-JSON");
  assert.equal(payload.stale_recovered, true, "tray did not refresh a stale credential");
  assert.equal(payload.stale_read_recovered, true, "tray did not refresh a stale credential for reads");
});

test("tray stop rejects a reused PID and runtime symlinks without signaling unrelated processes", { skip: process.platform === "win32" }, async () => {
  const { mkdirSync, writeFileSync, symlinkSync } = await import("node:fs");
  const directory = mkdtempSync(join(tmpdir(), "warp-tray-lifecycle-"));
  const runtime = join(directory, "runtime");
  const config = join(directory, "config");
  const fakeBins = join(directory, "bin");
  mkdirSync(join(runtime, "cloudflare-one-warp"), { recursive: true });
  mkdirSync(join(config, "cloudflare-one-warp"), { recursive: true });
  mkdirSync(fakeBins);
  // Prevent process discovery from finding any developer tray during this fixture.
  writeFileSync(join(fakeBins, "pgrep"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(fakeBins, "pkill"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(config, "cloudflare-one-warp", "config.json"), JSON.stringify({ tray: { shell: "cloudflare-one-warp" } }));
  const unrelated = spawn("sleep", ["30"]);
  writeFileSync(join(runtime, "cloudflare-one-warp", "tray.pid"), String(unrelated.pid));
  const env = { ...process.env, HOME: directory, XDG_CONFIG_HOME: config, XDG_RUNTIME_DIR: runtime,
    XDG_CACHE_HOME: join(directory, "cache"), PATH: `${fakeBins}:${process.env.PATH}` };
  try {
    const stopped = spawnSync("bash", [join(root, "bin", "cloudflare-one-warp-tray"), "--stop"], { env, encoding: "utf8" });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    rmSync(join(runtime, "cloudflare-one-warp"), { recursive: true });
    symlinkSync(join(directory, "cache"), join(runtime, "cloudflare-one-warp"));
    const unsafe = spawnSync("bash", [join(root, "bin", "cloudflare-one-warp-tray"), "--stop"], { env, encoding: "utf8" });
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /Unsafe runtime directory/);
  } finally {
    unrelated.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native client keeps credentials on loopback and rejects redirects and oversized responses", { skip: !python }, async () => {
  const { promisify } = await import("node:util");
  const { execFile } = await import("node:child_process");
  const script = `
import faulthandler, io, socket, sys, threading, urllib.error, urllib.request
faulthandler.dump_traceback_later(8)
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer

class LocalFixtureServer(ThreadingHTTPServer):
  # HTTPServer.server_bind calls socket.getfqdn, which can block on macOS
  # runner reverse DNS before any client request is made. This fixture only
  # serves numeric loopback addresses and needs no DNS-derived identity.
  def server_bind(self):
    TCPServer.server_bind(self)
    self.server_name = "localhost"
    self.server_port = self.server_address[1]

sys.path.insert(0, ${JSON.stringify(join(root, "scripts"))})
from tray_api import CloudflareOneWarpClient, _LOCAL_HTTP, _read_response, MAX_RESPONSE_BYTES
leaked = []
# Fail immediately if a future fixture change accidentally reintroduces DNS.
def forbidden_fqdn(*args, **kwargs):
  raise AssertionError("Loopback HTTP fixture must not perform reverse DNS")
socket.getfqdn = forbidden_fqdn
class Target(BaseHTTPRequestHandler):
  def do_GET(self):
    leaked.append(self.headers.get("X-Cloudflare-One-Warp-Session"))
    self.send_response(200); self.send_header("Content-Length", "2"); self.send_header("Connection", "close"); self.end_headers(); self.wfile.write(b"{}")
    self.close_connection = True
  def log_message(self, *args): pass
target = LocalFixtureServer(("127.0.0.1", 0), Target)
class Redirect(BaseHTTPRequestHandler):
  def do_POST(self):
    self.rfile.read(int(self.headers.get("Content-Length", "0")))
    self.send_response(302)
    self.send_header("Location", "http://127.0.0.1:%d/target" % target.server_port)
    self.send_header("Content-Length", "0")
    self.send_header("Connection", "close")
    self.end_headers()
    self.close_connection = True
  def log_message(self, *args): pass
source = LocalFixtureServer(("127.0.0.1", 0), Redirect)
for server in (source, target):
  server.daemon_threads = True
  threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
try:
  client = CloudflareOneWarpClient.__new__(CloudflareOneWarpClient)
  client.base_url = "http://127.0.0.1:%d" % source.server_port
  client.session = "isolated-fixture-secret"
  try: client._send("POST", "/api/action", {})
  except urllib.error.HTTPError as error:
    try: assert error.code == 302
    finally: error.close()
  else: raise AssertionError("redirect followed")
  assert not leaked
  assert not any(isinstance(handler, urllib.request.ProxyHandler) and handler.proxies for handler in _LOCAL_HTTP.handlers)
  try: CloudflareOneWarpClient("example.com")
  except ValueError: pass
  else: raise AssertionError("remote host accepted")
  try: _read_response(io.BytesIO(b"x" * (MAX_RESPONSE_BYTES + 1)))
  except ValueError: pass
  else: raise AssertionError("unbounded response accepted")
finally:
  source.shutdown(); target.shutdown()
  source.server_close(); target.server_close()
  faulthandler.cancel_dump_traceback_later()
`;
  await promisify(execFile)(python, ["-c", script], { timeout: 10000 });
});
