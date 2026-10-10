import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createHttpJson } from "./ci-http-client.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockWarp = join(root, "scripts/mock-warp-cli.mjs");
const port = Number(process.env.CI_OPENAPI_PORT || 14735);
const baseUrl = `http://127.0.0.1:${port}`;
const openapiTempDir = mkdtempSync(join(tmpdir(), "cf-one-warp-openapi-"));
const stateFile = join(openapiTempDir, "state.json");
// Pin both: configPaths() keys off HOME, while the autostart and unit paths key
// off XDG_CONFIG_HOME. Without both, POST /api/config/tray-shell rewrites the
// developer's real config and deletes their real autostart entry.
const configHome = join(openapiTempDir, "home");
const spec = JSON.parse(readFileSync(join(root, "openapi/cloudflare-one-warp-api.json"), "utf8"));

/** @type {import('node:child_process').ChildProcess | null} */
let serverProc = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const httpJson = createHttpJson(baseUrl);

function assertRequired(obj, required, label) {
  for (const key of required) {
    assert.ok(key in obj, `${label} missing required property "${key}"`);
  }
}

function schemaRequired(path, method = "get") {
  const op = spec.paths[path]?.[method];
  const schema = op?.responses?.["200"]?.content?.["application/json"]?.schema;
  return schema?.required || [];
}

before(async () => {
  serverProc = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOME: configHome,
      XDG_CONFIG_HOME: join(configHome, ".config"),
      PORT: String(port),
      WARP_CLI: mockWarp,
      MOCK_WARP_STATE: stateFile,
      CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0",
      CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: "1",
      CLOUDFLARE_ONE_WARP_TRAY_SKIP_SYSTEMD: "1",
      CLOUDFLARE_ONE_WARP_TRAY_LIVE: "0"
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
    rmSync(openapiTempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("OpenAPI /api/health response shape", async () => {
  const res = await httpJson("GET", "/api/health");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/health"), "health");
  assert.equal(res.json.app, "cloudflare-one-warp");
});

test("OpenAPI /api/readiness response shape", async () => {
  const res = await httpJson("GET", "/api/readiness");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/readiness"), "readiness");
});

test("OpenAPI /api/diagnostics response shape", async () => {
  const res = await httpJson("GET", "/api/diagnostics");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/diagnostics"), "diagnostics");
});

test("OpenAPI /api/version response shape", async () => {
  const res = await httpJson("GET", "/api/version");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/version"), "version");
});

test("OpenAPI /api/account response shape", async () => {
  const res = await httpJson("GET", "/api/account");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/account"), "account");
});

test("OpenAPI /api/snapshot response shape", async () => {
  const res = await httpJson("GET", "/api/snapshot");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/snapshot"), "snapshot");
});

test("OpenAPI /api/killswitch response shape", async () => {
  const res = await httpJson("GET", "/api/killswitch");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/killswitch"), "killswitch");
});

test("OpenAPI /api/config response shape", async () => {
  const res = await httpJson("GET", "/api/config");
  assert.equal(res.status, 200);
  assertRequired(res.json, ["ok", "config"], "config");
  assert.equal(res.json.config?.tray?.shell === "cloudflare" || res.json.config?.tray?.shell === "cloudflare-one-warp", true);
  assert.equal(typeof res.json.config?.tray?.cloudflareAvailable, "boolean");
});

test("OpenAPI POST /api/config/tray-shell response shape", async () => {
  const res = await httpJson("POST", "/api/config/tray-shell", { shell: "cloudflare" });
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/config/tray-shell", "post"), "tray-shell");
});

test("OpenAPI /api/action connect response shape", async () => {
  const res = await httpJson("POST", "/api/action", { action: "connect" });
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/action", "post"), "action");
});

test("OpenAPI /api/logs response shape", async () => {
  const res = await httpJson("GET", "/api/logs");
  assert.equal(res.status, 200);
  assertRequired(res.json, schemaRequired("/api/logs"), "logs");
});
