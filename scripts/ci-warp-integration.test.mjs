import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createHttpJson } from "./ci-http-client.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockWarp = join(root, "scripts/mock-warp-cli.mjs");
const port = Number(process.env.CI_TEST_PORT || 14733);
const baseUrl = `http://127.0.0.1:${port}`;
const integTempDir = mkdtempSync(join(tmpdir(), "tf-integ-"));
const stateFile = join(integTempDir, "state.json");
const configHome = join(integTempDir, "home");

/** @type {import('node:child_process').ChildProcess | null} */
let serverProc = null;

const MODES = ["warp", "doh", "warp+doh", "dot", "warp+dot", "proxy", "tunnel_only"];
const PROTOCOLS = ["MASQUE", "WireGuard"];
const FAMILIES = ["full", "malware", "off"];
const MASQUE_OPTIONS = ["h3-only", "h2-only", "h3-with-h2-fallback"];

const SIMPLE_ACTIONS = [
  "connect",
  "disconnect",
  "register",
  "deleteRegistration",
  "resetSettings",
  "rotateKeys",
  "resetProtocol",
  "resetSplitIps",
  "resetSplitHosts",
  "dnsLogEnable",
  "dnsLogDisable",
  "accessReauth",
  "resetGatewayId",
  "resetEndpoint",
  "resetMasqueOptions",
  "environmentNormal",
  "environmentFedramp",
  "environmentReset",
  "trustedWifiEnable",
  "trustedWifiDisable",
  "trustedEthernetEnable",
  "trustedEthernetDisable",
  "resetTrustedSsids",
  "allowLocalNetwork",
  "stopLocalNetworkOverride"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const httpJson = createHttpJson(baseUrl);

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await httpJson("GET", "/api/health");
      if (res.status === 200 && res.json?.ok === true && res.json?.app === "thirdflare") {
        return;
      }
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error("Server did not become healthy in time");
}

/** Raw POST with caller-supplied headers, for the cross-site guard tests. */
function httpRaw(method, path, { headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      `${baseUrl}${path}`,
      { method, headers: { "content-length": Buffer.byteLength(body), ...headers } },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function action(name, value, secondary) {
  const body = { action: name };
  if (value !== undefined) body.value = value;
  if (secondary !== undefined) body.secondary = secondary;
  return httpJson("POST", "/api/action", body);
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
      THIRDFLARE_NOTIFICATIONS: "0",
      THIRDFLARE_NFT_NO_PKEXEC: "1",
      THIRDFLARE_WEBUI: "1",
      THIRDFLARE_TRAY_SKIP_SYSTEMD: "1",
      THIRDFLARE_TRAY_LIVE: "0"
    },
    stdio: "pipe"
  });

  serverProc.stderr?.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  await waitForHealth();
  await action("register");
  await action("disconnect");
});

after(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
    await sleep(300);
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
  try {
    rmSync(integTempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("host DNS resolution works", async () => {
  const result = await lookup("one.one.one.one");
  assert.ok(result.address, "expected DNS A/AAAA record for one.one.one.one");
});

test("/api/health returns app identity", async () => {
  const res = await httpJson("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.app, "thirdflare");
  assert.ok(res.json.version, "health should include semver");
  assert.equal(typeof res.json.apiRevision, "number");
});

test("/api/version returns channel and source", async () => {
  const res = await httpJson("GET", "/api/version");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.version);
  assert.equal(res.json.channel, "stable");
  assert.equal(res.json.source.owner, "bodencrouch");
});

test("/api/snapshot reports warp daemon and network debug", async () => {
  const res = await httpJson("GET", "/api/snapshot");
  assert.equal(res.status, 200);
  assert.equal(res.json.daemon.available, true);
  assert.equal(res.json.status.disconnected, true);
  assert.equal(typeof res.json.readiness, "object");
  assert.equal(res.json.readiness.hardBlocked, false);
  assert.ok(Array.isArray(res.json.readiness.items));
  assert.match(res.json.commands.network.stdout, /DNS servers:/);
  assert.match(res.json.commands.network.stdout, /1\.1\.1\.1/);
  assert.equal(typeof res.json.splitTunnel, "object");
  assert.equal(res.json.splitTunnel.mode, "exclude");
  assert.ok(Array.isArray(res.json.splitTunnel.ips));
  assert.ok(Array.isArray(res.json.splitTunnel.hosts));
});

test("GET /api/readiness reports items and kill-switch mode", async () => {
  const res = await httpJson("GET", "/api/readiness");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(typeof res.json.hardBlocked, "boolean");
  assert.ok(["off", "always_on", "paused"].includes(res.json.killSwitchMode));
  assert.ok(res.json.items.some((item) => item.id === "warp_cli"));
});

test("GET /api/diagnostics returns clipboard text without account fields", async () => {
  const res = await httpJson("GET", "/api/diagnostics");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.match(res.json.text, /ThirdFlare One diagnostics/);
  // Command names may say "registration organization"; account values must not appear.
  assert.doesNotMatch(res.json.text, /Organization:\s+\S+/i);
  assert.doesNotMatch(res.json.text, /License:\s+\S+/i);
  assert.doesNotMatch(res.json.text, /Account ID:\s+\S+/i);
});

test("connect then disconnect updates snapshot status", async () => {
  let res = await action("connect");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  let snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.status.connected, true);

  res = await action("disconnect");
  assert.equal(res.status, 200);
  snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.status.disconnected, true);
});

test("every simple ACTIONS key succeeds", async () => {
  await action("register");
  for (const name of SIMPLE_ACTIONS) {
    const res = await action(name);
    assert.equal(res.status, 200, `${name} should return 200`);
    assert.equal(res.json.ok, true, `${name} should be ok`);
  }
});

test("every mode value sticks in settings", async () => {
  for (const mode of MODES) {
    const res = await action("setMode", mode);
    assert.equal(res.status, 200, `setMode ${mode}`);
    const snap = await httpJson("GET", "/api/snapshot");
    assert.equal(snap.json.settings.Mode, mode, `normalized Mode for ${mode}`);
    if (mode === "proxy") {
      assert.match(snap.json.commands.settings.stdout, /Mode:\s*WarpProxy on port/i);
    } else {
      assert.match(snap.json.commands.settings.stdout, new RegExp(`Mode:\\s*${mode.replace("+", "\\+")}`));
    }
  }
});

test("every protocol value sticks", async () => {
  for (const protocol of PROTOCOLS) {
    const res = await action("setProtocol", protocol);
    assert.equal(res.status, 200, `setProtocol ${protocol}`);
    const snap = await httpJson("GET", "/api/snapshot");
    assert.match(snap.json.commands.settings.stdout, new RegExp(`Protocol:\\s*${protocol}`));
  }
  await action("resetProtocol");
});

test("every DNS families value sticks", async () => {
  for (const families of FAMILIES) {
    const res = await action("setFamilies", families);
    assert.equal(res.status, 200, `setFamilies ${families}`);
    const snap = await httpJson("GET", "/api/snapshot");
    assert.match(snap.json.commands.settings.stdout, new RegExp(`DNS Families:\\s*${families}`));
    assert.equal(snap.json.settings["DNS Families"], families);
  }
});

test("DNS log enable and disable update snapshot settings", async () => {
  assert.equal((await action("dnsLogEnable")).status, 200);
  let snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.settings["DNS logging"], "enabled");

  assert.equal((await action("dnsLogDisable")).status, 200);
  snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.settings["DNS logging"], "disabled");
});

test("every MASQUE option sticks", async () => {
  for (const opt of MASQUE_OPTIONS) {
    const res = await action("setMasqueOptions", opt);
    assert.equal(res.status, 200, `setMasqueOptions ${opt}`);
    const snap = await httpJson("GET", "/api/snapshot");
    assert.match(snap.json.commands.settings.stdout, new RegExp(`MASQUE options:\\s*${opt}`));
  }
  await action("resetMasqueOptions");
});

test("split tunnel ip/host add remove reset", async () => {
  await action("resetSplitIps");
  await action("resetSplitHosts");
  assert.equal((await action("addSplitIp", "172.16.0.0/12")).status, 200);
  assert.equal((await action("addSplitHost", "intranet.example")).status, 200);
  let snap = await httpJson("GET", "/api/snapshot");
  assert.match(snap.json.commands.splitTunnelIps.stdout, /172\.16\.0\.0\/12/);
  assert.match(snap.json.commands.splitTunnelHosts.stdout, /intranet\.example/);
  assert.ok(snap.json.splitTunnel.ips.includes("172.16.0.0/12"));
  assert.ok(snap.json.splitTunnel.hosts.includes("intranet.example"));
  assert.equal((await action("removeSplitIp", "172.16.0.0/12")).status, 200);
  assert.equal((await action("removeSplitHost", "intranet.example")).status, 200);
  snap = await httpJson("GET", "/api/snapshot");
  assert.doesNotMatch(snap.json.commands.splitTunnelIps.stdout, /172\.16\.0\.0\/12/);
  assert.doesNotMatch(snap.json.commands.splitTunnelHosts.stdout, /intranet\.example/);
  assert.ok(!snap.json.splitTunnel.ips.includes("172.16.0.0/12"));
  assert.ok(!snap.json.splitTunnel.hosts.includes("intranet.example"));
  await action("resetSplitIps");
  await action("resetSplitHosts");
});

test("trusted SSID and DNS fallback add/remove", async () => {
  assert.equal((await action("addTrustedSsid", "CafeWifi")).status, 200);
  assert.equal((await action("addDnsFallback", "8.8.8.8")).status, 200);
  let snap = await httpJson("GET", "/api/snapshot");
  assert.match(snap.json.commands.trustedSsids.stdout, /CafeWifi/);
  assert.match(snap.json.commands.dnsFallback.stdout, /8\.8\.8\.8/);
  assert.equal((await action("removeTrustedSsid", "CafeWifi")).status, 200);
  assert.equal((await action("removeDnsFallback", "8.8.8.8")).status, 200);
  snap = await httpJson("GET", "/api/snapshot");
  assert.doesNotMatch(snap.json.commands.trustedSsids.stdout, /CafeWifi/);
  assert.doesNotMatch(snap.json.commands.dnsFallback.stdout, /8\.8\.8\.8/);
  await action("resetTrustedSsids");
});

test("invalid mode protocol families MASQUE are rejected", async () => {
  assert.equal((await action("setMode", "nope")).status, 400);
  assert.equal((await action("setProtocol", "BAD")).status, 400);
  assert.equal((await action("setFamilies", "evil")).status, 400);
  assert.equal((await action("setMasqueOptions", "x")).status, 400);
});

test("proxy port gateway endpoint vnet", async () => {
  assert.equal((await action("setProxyPort", "41000")).status, 200);
  assert.equal((await action("setGatewayId", "gw-ci-test")).status, 200);
  assert.equal((await action("setEndpoint", "engage.cloudflareclient.com:2408")).status, 200);
  assert.equal((await action("setVnet", "vnet-ci")).status, 200);
  await action("resetGatewayId");
  await action("resetEndpoint");
});

test("GET /api/account returns structured free registration", async () => {
  await action("register");
  const res = await httpJson("GET", "/api/account");
  assert.equal(res.status, 200);
  assert.equal(res.json.registered, true);
  assert.equal(res.json.consumer, true);
  assert.equal(res.json.license, "MOCKKEY1-MOCKKEY2-MOCKKEY3");
  assert.ok(Array.isArray(res.json.devices));
  assert.equal(res.json.devices[0].deviceId, "mock-device-id");
  const raw = res.json.commands?.registration?.stdout || "";
  assert.match(raw, /"public_key"\s*:\s*"\[redacted\]"/i);
  assert.match(raw, /"license"\s*:\s*"\[redacted\]"/i);
  assert.doesNotMatch(raw, /mock-public-key/);
  assert.doesNotMatch(raw, /MOCKKEY1/);
});

test("GET /api/killswitch reports desired/active state", async () => {
  const res = await httpJson("GET", "/api/killswitch");
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.desired, "boolean");
  assert.ok(res.json.active === true || res.json.active === false || res.json.active === null);
  assert.equal(res.json.interface, "CloudflareWARP");
});

test("POST /api/killswitch disable is idempotent when inactive", async () => {
  const res = await httpJson("POST", "/api/killswitch", { enabled: false, allowLan: false });
  // 502 when nft probe/apply is unavailable (unprivileged CI); desired must stay false.
  assert.ok(res.status === 200 || res.status === 502, `unexpected status ${res.status}`);
  assert.equal(res.json.desired, false);
});

test("POST /api/killswitch enable without privilege keeps desired false", async () => {
  const res = await httpJson("POST", "/api/killswitch", { enabled: true, allowLan: false });
  assert.equal(res.status, 502);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.desired, false);
});

test("POST /api/killswitch rejects non-boolean enabled", async () => {
  const res = await httpJson("POST", "/api/killswitch", { enabled: "yes" });
  assert.equal(res.status, 400);
});

test("POST /api/killswitch/enrollment-pause begin is safe when KS off", async () => {
  const res = await httpJson("POST", "/api/killswitch/enrollment-pause", { mode: "begin" });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.paused, false);
});

test("GET /api/killswitch includes enrollmentPause object", async () => {
  const res = await httpJson("GET", "/api/killswitch");
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.enrollmentPause, "object");
  assert.equal(typeof res.json.enrollmentPause.paused, "boolean");
});

test("GET /api/health reports webuiEnabled and effectivePort", async () => {
  const res = await httpJson("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.json.webuiEnabled, true);
  assert.equal(typeof res.json.effectivePort, "number");
});

test("POST /api/config/webui and /api/config/server validate input", async () => {
  const badWebui = await httpJson("POST", "/api/config/webui", { enabled: "yes" });
  assert.equal(badWebui.status, 400);

  const enable = await httpJson("POST", "/api/config/webui", { enabled: true });
  assert.equal(enable.status, 200);
  assert.equal(enable.json.config?.webui?.enabled, true);
  assert.equal(enable.json.restartRequired, true);

  const badPort = await httpJson("POST", "/api/config/server", { port: 80 });
  assert.equal(badPort.status, 400);

  const okPort = await httpJson("POST", "/api/config/server", { port: 4173 });
  assert.equal(okPort.status, 200);
  assert.equal(okPort.json.restartRequired, true);
  assert.ok(okPort.json.config?.server?.port);
});

test("POST /api/config/session ignores webui.enabled", async () => {
  const before = await httpJson("GET", "/api/health");
  const session = await httpJson("POST", "/api/config/session", {
    config: { webui: { enabled: false } }
  });
  assert.equal(session.status, 200);
  const after = await httpJson("GET", "/api/health");
  assert.equal(after.json.webuiEnabled, before.json.webuiEnabled);
});

test("POST /api/config/tray-autostart persists and syncs desktop entry", async () => {
  const bad = await httpJson("POST", "/api/config/tray-autostart", { autostart: "yes" });
  assert.equal(bad.status, 400);

  const thirdflare = await httpJson("POST", "/api/config/tray-shell", { shell: "thirdflare" });
  assert.equal(thirdflare.status, 200);
  assert.equal(thirdflare.json.config?.tray?.shell, "thirdflare");
  assert.equal(thirdflare.json.config?.tray?.active, "thirdflare");

  const enable = await httpJson("POST", "/api/config/tray-autostart", { autostart: true });
  assert.equal(enable.status, 200);
  assert.equal(enable.json.ok, true);
  assert.equal(enable.json.config?.tray?.autostart, true);
  if (process.platform === "linux") {
    assert.equal(enable.json.sync?.enabled, true);
  } else {
    assert.equal(enable.json.sync?.skipped, true);
  }

  const disable = await httpJson("POST", "/api/config/tray-autostart", { autostart: false });
  assert.equal(disable.status, 200);
  assert.equal(disable.json.config?.tray?.autostart, false);
  if (process.platform === "linux") {
    assert.equal(disable.json.sync?.removed, true);
  } else {
    assert.equal(disable.json.sync?.skipped, true);
  }
});

test("POST /api/config/tray-shell persists cloudflare or thirdflare", async () => {
  const bad = await httpJson("POST", "/api/config/tray-shell", { shell: "nope" });
  assert.equal(bad.status, 400);

  const missing = await httpJson("POST", "/api/config/tray-shell", {});
  assert.equal(missing.status, 400);

  const cloudflare = await httpJson("POST", "/api/config/tray-shell", { shell: "cloudflare" });
  assert.equal(cloudflare.status, 200);
  assert.equal(cloudflare.json.ok, true);
  assert.equal(cloudflare.json.config?.tray?.shell, "cloudflare");
  assert.equal(typeof cloudflare.json.config?.tray?.cloudflareAvailable, "boolean");
  assert.ok(cloudflare.json.config?.tray?.active === "cloudflare" || cloudflare.json.config?.tray?.active === "thirdflare");
  assert.ok(cloudflare.json.sync);
  assert.ok(cloudflare.json.liveSwap);
  assert.equal(cloudflare.json.liveSwap.attempted, false);

  const got = await httpJson("GET", "/api/config");
  assert.equal(got.status, 200);
  assert.equal(got.json.config?.tray?.shell, "cloudflare");
  assert.equal(typeof got.json.config?.tray?.cloudflareAvailable, "boolean");
  assert.ok(got.json.notes?.persistEndpoints?.includes("POST /api/config/tray-shell"));

  const thirdflare = await httpJson("POST", "/api/config/tray-shell", { shell: "thirdflare" });
  assert.equal(thirdflare.status, 200);
  assert.equal(thirdflare.json.config?.tray?.shell, "thirdflare");
  assert.equal(thirdflare.json.config?.tray?.active, "thirdflare");
});

test("POST /api/action applyLicense and registerOrganization validate input", async () => {
  const badLicense = await action("applyLicense", "bad;rm");
  assert.equal(badLicense.status, 400);

  const okLicense = await action("applyLicense", "MOCKKEY1-MOCKKEY2-MOCKKEY3");
  assert.equal(okLicense.status, 200);

  const badTeam = await action("registerOrganization", "bad team!");
  assert.equal(badTeam.status, 400);

  const okTeam = await action("registerOrganization", "acme-corp");
  assert.equal(okTeam.status, 200);
});

test("POST /api/action status via runCustom is rejected safely", async () => {
  const res = await action("runCustom", "status; rm -rf /");
  assert.equal(res.status, 400);
});

test("GET /api/session hands the credential to a local caller", async () => {
  const res = await httpJson("GET", "/api/session");
  assert.equal(res.status, 200);
  assert.match(res.json.session, /^[0-9a-f]{64}$/);
  assert.equal(res.json.header, "x-thirdflare-session");
});

test("API responses carry no-sniff and framing protections", async () => {
  const res = await httpJson("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.match(res.headers["content-security-policy"], /default-src 'none'/);
});

test("Web UI assets carry a restrictive content security policy", async () => {
  const res = await httpJson("GET", "/index.html");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-security-policy"], /connect-src 'self'/);
  assert.equal(res.headers["x-frame-options"], "DENY");
});

test("a request with a foreign Host header is refused", async () => {
  const res = await httpJson("GET", "/api/health", null, { headers: { host: "attacker.example" } });
  assert.equal(res.status, 403);
  assert.equal(res.json.reason, "host_not_allowed");
});

test("a cross-origin POST cannot change WARP state", async () => {
  await action("disconnect");
  const res = await httpJson(
    "POST",
    "/api/action",
    { action: "connect" },
    { headers: { origin: "http://attacker.example" } }
  );
  assert.equal(res.status, 403);
  assert.equal(res.json.reason, "cross_origin_denied");
  const snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.status.disconnected, true);
});

test("a form-style POST is refused before the body is read", async () => {
  const res = await httpJson(
    "POST",
    "/api/action",
    { action: "connect" },
    { headers: { "content-type": "text/plain;charset=UTF-8" } }
  );
  assert.equal(res.status, 415);
  assert.equal(res.json.reason, "json_required");
  const snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.status.disconnected, true);
});

test("a POST without the session credential is refused", async () => {
  const res = await httpJson("POST", "/api/action", { action: "connect" }, { session: false });
  assert.equal(res.status, 403);
  assert.equal(res.json.reason, "session_required");
  const snap = await httpJson("GET", "/api/snapshot");
  assert.equal(snap.json.status.disconnected, true);
});

test("a POST with a wrong session credential is refused", async () => {
  const res = await httpJson(
    "POST",
    "/api/action",
    { action: "connect" },
    { headers: { "x-thirdflare-session": "0".repeat(64) } }
  );
  assert.equal(res.status, 403);
  assert.equal(res.json.reason, "session_required");
});

test("blocked requests are recorded in the console log", async () => {
  await httpJson("POST", "/api/action", { action: "connect" }, { session: false });
  const logs = await httpJson("GET", "/api/logs");
  const blocked = (logs.json.entries || []).filter((entry) => entry.source === "security");
  assert.ok(blocked.length > 0, "expected a security entry");
  const last = blocked.at(-1);
  assert.match(last.stderr, /blocked: session_required/);
  assert.equal(last.ok, false);
});

test("health-check script accepts this server", async () => {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/health-check.mjs"), `${baseUrl}/api/health`], {
      stdio: "inherit"
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`health-check exit ${code}`))));
    child.on("error", reject);
  });
});

test("cross-site writes are rejected on every mutating route", async () => {
  const jsonBody = JSON.stringify({ action: "disconnect" });

  // A hostile page's fetch() carries sec-fetch-site: cross-site.
  const crossSite = await httpRaw("POST", "/api/action", {
    headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    body: jsonBody
  });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.json?.ok, false);

  const foreignOrigin = await httpRaw("POST", "/api/action", {
    headers: { "content-type": "application/json", origin: "http://evil.example" },
    body: jsonBody
  });
  assert.equal(foreignOrigin.status, 403);

  // A cross-origin <form> cannot send application/json, so this is the shape a
  // no-preflight form post would arrive in.
  const formPost = await httpRaw("POST", "/api/action", {
    headers: { "content-type": "text/plain" },
    body: jsonBody
  });
  assert.equal(formPost.status, 403);

  const urlencoded = await httpRaw("POST", "/api/config/tray-shell", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "shell=thirdflare"
  });
  assert.equal(urlencoded.status, 403);
});

test("same-origin and non-browser writes still pass the guard", async () => {
  const sameOrigin = await httpRaw("POST", "/api/action", {
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: `http://127.0.0.1:${port}`,
      host: `127.0.0.1:${port}`
    },
    body: JSON.stringify({ action: "disconnect" })
  });
  assert.equal(sameOrigin.status, 200);

  // A direct address-bar navigation or a CLI client: sec-fetch-site: none.
  const direct = await httpRaw("POST", "/api/action", {
    headers: { "content-type": "application/json", "sec-fetch-site": "none" },
    body: JSON.stringify({ action: "disconnect" })
  });
  assert.equal(direct.status, 200);

  // curl / the tray CLI send no browser headers at all.
  const cli = await httpJson("POST", "/api/action", { action: "disconnect" });
  assert.equal(cli.status, 200);
});
