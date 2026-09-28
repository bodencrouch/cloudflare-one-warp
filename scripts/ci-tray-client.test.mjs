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

// The tray resolves the credential from $HOME/.config/thirdflare, so give the
// daemon and the client a throwaway home instead of the developer's own config.
const home = mkdtempSync(join(tmpdir(), "tf-tray-home-"));

function startDaemon() {
  return spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      PORT: String(port),
      THIRDFLARE_PORT: String(port),
      WARP_CLI: join(root, "scripts/mock-warp-cli.mjs"),
      THIRDFLARE_WEBUI: "0",
      THIRDFLARE_NOTIFICATIONS: "0",
      THIRDFLARE_NFT_NO_PKEXEC: "1",
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
from tray_api import ThirdFlareClient, session_token_path

client = ThirdFlareClient()
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
    env: { ...process.env, HOME: home, THIRDFLARE_PORT: String(port) }
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim().split("\n").pop());

  assert.equal(payload.port, port);
  assert.equal(payload.token_file, join(home, ".config/thirdflare", `session-${port}.token`));
  assert.equal(payload.session, true, "tray could not read the session credential");
  assert.equal(payload.action, true, "tray mutation was refused");
  assert.notEqual(payload.bodyless, "json_required", "tray sent a mutation the daemon rejected as non-JSON");
  assert.equal(payload.stale_recovered, true, "tray did not refresh a stale credential");
});
