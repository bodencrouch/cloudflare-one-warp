import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  appendFromRunWarp,
  getCommandLogCapacity,
  listEntries,
  resetCommandLogForTests,
  setCommandLogCapacity
} from "../lib/warp/command-log.mjs";
import { createHttpJson } from "./ci-http-client.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockWarp = join(root, "scripts/mock-warp-cli.mjs");
const port = Number(process.env.CI_LOGS_PORT || 14736);
const baseUrl = `http://127.0.0.1:${port}`;
const logsTempDir = mkdtempSync(join(tmpdir(), "tf-logs-"));
const stateFile = join(logsTempDir, "state.json");
// Keep the daemon's startup tray sync off the developer's real config.
const logsConfigHome = join(logsTempDir, "home");

/** @type {import('node:child_process').ChildProcess | null} */
let serverProc = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const httpJson = createHttpJson(baseUrl);

before(async () => {
  serverProc = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOME: logsConfigHome,
      XDG_CONFIG_HOME: join(logsConfigHome, ".config"),
      PORT: String(port),
      WARP_CLI: mockWarp,
      MOCK_WARP_STATE: stateFile,
      THIRDFLARE_NOTIFICATIONS: "0",
      THIRDFLARE_NFT_NO_PKEXEC: "1",
      THIRDFLARE_TRAY_SKIP_SYSTEMD: "1",
      THIRDFLARE_TRAY_LIVE: "0"
    },
    stdio: "pipe"
  });
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await httpJson("GET", "/api/health");
      if (res.status === 200) break;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
});

after(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
    await sleep(200);
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
  try {
    rmSync(logsTempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("command log ring buffer evicts oldest entries", () => {
  resetCommandLogForTests();
  setCommandLogCapacity(10);
  for (let i = 0; i < 11; i += 1) {
    appendFromRunWarp({
      command: `warp-cli cmd-${i}`,
      code: 0,
      ok: true,
      stdout: String(i),
      stderr: "",
      durationMs: 1
    });
  }
  const all = listEntries();
  assert.equal(all.length, 10);
  assert.equal(all[0].command, "warp-cli cmd-1");
  assert.equal(all[9].command, "warp-cli cmd-10");
  resetCommandLogForTests();
});

test("GET /api/logs returns entries after connect action", async () => {
  const before = await httpJson("GET", "/api/logs");
  assert.equal(before.status, 200);
  assert.equal(before.json.ok, true);
  assert.ok(Array.isArray(before.json.entries));
  assert.equal(typeof before.json.capacity, "number");

  const connect = await httpJson("POST", "/api/action", { action: "connect" });
  assert.equal(connect.status, 200);
  assert.equal(connect.json.ok, true);

  const after = await httpJson("GET", "/api/logs");
  assert.equal(after.status, 200);
  const match = after.json.entries.find((entry) => /connect/.test(entry.command));
  assert.ok(match, "expected connect command in log");
  assert.equal(match.ok, true);
});

test("failed action appends entry with ok false and stderr", async () => {
  const res = await httpJson("POST", "/api/action", { action: "setMode", value: "not-a-mode" });
  assert.equal(res.status, 400);

  const logs = await httpJson("GET", "/api/logs");
  const failed = logs.json.entries.filter((entry) => entry.ok === false);
  assert.ok(failed.length >= 0);
});

test("GET /api/logs?since returns incremental entries", async () => {
  const full = await httpJson("GET", "/api/logs");
  const lastId = full.json.entries.at(-1)?.id || 0;
  await httpJson("POST", "/api/action", { action: "disconnect" });
  const incremental = await httpJson("GET", `/api/logs?since=${lastId}`);
  assert.equal(incremental.status, 200);
  assert.ok(incremental.json.entries.every((entry) => entry.id > lastId));
});

test("enableLocalProxy sets MASQUE and proxy mode", async () => {
  await httpJson("POST", "/api/action", { action: "setProtocol", value: "WireGuard" });
  await httpJson("POST", "/api/action", { action: "setMode", value: "warp" });

  const res = await httpJson("POST", "/api/action", { action: "enableLocalProxy" });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.ok(Array.isArray(res.json.steps));
  assert.equal(res.json.steps.length, 2);

  const snap = await httpJson("GET", "/api/snapshot");
  const settings = snap.json.settings || {};
  assert.equal(String(settings.Mode).toLowerCase(), "proxy");
  assert.ok(res.json.settings);
  assert.equal(res.json.settings.Mode, "proxy");
});

test("enableLocalProxy while disconnected sets MASQUE and proxy mode", async () => {
  await httpJson("POST", "/api/action", { action: "disconnect" });
  await httpJson("POST", "/api/action", { action: "setProtocol", value: "WireGuard" });
  await httpJson("POST", "/api/action", { action: "setMode", value: "warp" });

  const res = await httpJson("POST", "/api/action", { action: "enableLocalProxy" });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);

  const snap = await httpJson("GET", "/api/snapshot");
  const settings = snap.json.settings || {};
  assert.equal(String(settings.Mode).toLowerCase(), "proxy");
  assert.ok(res.json.settings);
  assert.equal(res.json.settings.Mode, "proxy");
  const protocol = settings["Tunnel protocol"] || settings.Protocol || "";
  assert.match(String(protocol), /masque/i);
});
