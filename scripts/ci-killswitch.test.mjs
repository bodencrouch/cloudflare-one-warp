import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BOOTSTRAP_V4,
  BOOTSTRAP_V6,
  KILLSWITCH_TABLE,
  WARP_INTERFACE,
  buildDisableScript,
  buildEnableScript
} from "../lib/killswitch/rules.mjs";
import {
  clearSessionOverrides,
  getConfig,
  persistUserKillSwitch,
  reloadConfig,
  setSessionKillSwitch
} from "../lib/config.mjs";
import {
  beginEnrollmentPause,
  ENROLLMENT_PAUSE_ACTIONS,
  getEnrollmentPauseState,
  endEnrollmentPause,
  cancelEnrollmentPause
} from "../lib/killswitch/enroll-pause.mjs";
import { probeKillSwitchActive, applyKillSwitch } from "../lib/killswitch/apply.mjs";

test("enable script drops by default and allows lo + WARP + bootstrap", () => {
  const script = buildEnableScript({ allowLan: false, useDestroy: true });
  assert.match(script, new RegExp(`destroy table inet ${KILLSWITCH_TABLE}`));
  assert.match(script, /policy drop/);
  assert.match(script, /oifname "lo" accept/);
  assert.match(script, new RegExp(`oifname "${WARP_INTERFACE}" accept`));
  for (const cidr of BOOTSTRAP_V4) {
    assert.match(script, new RegExp(cidr.replace(/\./g, "\\.")));
  }
  for (const cidr of BOOTSTRAP_V6) {
    assert.ok(script.includes(cidr), `missing bootstrap v6 ${cidr}`);
  }
  assert.doesNotMatch(script, /10\.0\.0\.0\/8/);
});

test("enable script can allow LAN ranges", () => {
  const script = buildEnableScript({ allowLan: true, useDestroy: false });
  assert.match(script, /delete table inet/);
  assert.match(script, /10\.0\.0\.0\/8/);
  assert.match(script, /192\.168\.0\.0\/16/);
  assert.match(script, /fc00::\/7/);
});

test("disable script destroys or deletes the table", () => {
  assert.match(buildDisableScript({ useDestroy: true }), /destroy table inet/);
  assert.match(buildDisableScript({ useDestroy: false }), /delete table inet/);
});

test("persistUserKillSwitch writes user config and survives reload via HOME", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-one-warp-ks-persist-"));
  const userPath = join(root, ".config", "cloudflare-one-warp", "config.json");
  mkdirSync(join(root, ".config", "cloudflare-one-warp"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ ui: { locale: "en" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config"), CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0" };

  try {
    clearSessionOverrides();
    setSessionKillSwitch({ enabled: true, allowLan: true });
    const cfg = persistUserKillSwitch({ enabled: true, allowLan: true }, { env });
    assert.equal(cfg.warp.killSwitch, true);
    assert.equal(cfg.warp.killSwitchAllowLan, true);

    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.ui.locale, "en");
    assert.equal(onDisk.warp.killSwitch, true);
    assert.equal(onDisk.warp.killSwitchAllowLan, true);

    clearSessionOverrides();
    const reloaded = reloadConfig(env);
    assert.equal(reloaded.warp.killSwitch, true);
    assert.equal(reloaded.warp.killSwitchAllowLan, true);
    assert.equal(getConfig().warp.killSwitch, true);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserKillSwitch ignores non-boolean enabled", () => {
  const before = getConfig().warp.killSwitch;
  persistUserKillSwitch({ enabled: "yes", allowLan: false });
  assert.equal(getConfig().warp.killSwitch, before);
});

test("enrollment pause actions cover Zero Trust flows", () => {
  assert.ok(ENROLLMENT_PAUSE_ACTIONS.has("registerOrganization"));
  assert.ok(ENROLLMENT_PAUSE_ACTIONS.has("registrationToken"));
  assert.equal(getEnrollmentPauseState().paused, false);
});

test("probeKillSwitchActive is read-only and does not escalate to pkexec", async () => {
  const env = { ...process.env, DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" };
  const probe = await probeKillSwitchActive(env);
  assert.equal(probe.method, "nft");
  assert.ok(probe.active === true || probe.active === false || probe.active === null);
});

test("beginEnrollmentPause is no-op when kill switch not desired", async () => {
  const env = { ...process.env, CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: "1" };

  try {
    clearSessionOverrides();
    setSessionKillSwitch({ enabled: false, allowLan: false });
    assert.equal(getConfig().warp.killSwitch, false);

    const first = await beginEnrollmentPause({ env });
    assert.equal(first.ok, true);
    assert.equal(first.paused, false);
    assert.equal(first.wasDesired, false);
    assert.match(first.detail, /not desired/i);
    assert.equal(getEnrollmentPauseState().paused, false);

    const second = await beginEnrollmentPause({ env });
    assert.equal(second.ok, true);
    assert.equal(second.paused, false);
    assert.equal(getEnrollmentPauseState().paused, false);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
  }
});

function fakeFirewall() {
  const root = mkdtempSync(join(tmpdir(), "warp-firewall-test-"));
  const state = join(root, "active");
  const failure = join(root, "fail");
  const events = join(root, "events");
  const nft = join(root, "nft");
  writeFileSync(nft, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)}, failure = ${JSON.stringify(failure)}, events = ${JSON.stringify(events)};
if (args[0] === 'list') {
  if (fs.existsSync(state)) process.exit(0);
  console.error('No such file'); process.exit(1);
}
const script = fs.readFileSync(args[1], 'utf8');
const enabled = script.includes('chain output');
fs.appendFileSync(events, 'start ' + enabled + '\\n');
setTimeout(() => {
  if (enabled && fs.existsSync(failure)) {
    fs.appendFileSync(events, 'failed\\n');
    console.error('simulated restore failure'); process.exit(1);
  }
  if (enabled) fs.writeFileSync(state, script);
  else fs.rmSync(state, {force:true});
  fs.appendFileSync(events, 'end ' + enabled + '\\n');
}, 30);
`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, DISPLAY: "", WAYLAND_DISPLAY: "", PKEXEC_UID: "", CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: "0" };
  return { root, state, failure, events, env };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("kill switch queue serializes nft and persistence, including after failure", { skip: process.platform === "win32" }, async () => {
  const fake = fakeFirewall();
  try {
    const persist = [];
    const first = applyKillSwitch({ enabled: true, env: fake.env, onSuccess: async () => {
      await delay(30); persist.push("on");
    } });
    const second = applyKillSwitch({ enabled: false, env: fake.env, onSuccess: () => persist.push("off") });
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
    assert.equal(readFileSync(fake.events, "utf8"), "start true\nend true\nstart false\nend false\n");
    assert.deepEqual(persist, ["on", "off"]);
    assert.throws(() => readFileSync(fake.state), { code: "ENOENT" });
    writeFileSync(fake.failure, "1");
    assert.equal((await applyKillSwitch({ enabled: true, env: fake.env })).ok, false);
    rmSync(fake.failure);
    assert.equal((await applyKillSwitch({ enabled: true, env: fake.env })).ok, true);
  } finally { rmSync(fake.root, { recursive: true, force: true }); }
});

test("failed enrollment restore retains warning and retries until protection returns", { skip: process.platform === "win32" }, async () => {
  const fake = fakeFirewall();
  try {
    clearSessionOverrides();
    setSessionKillSwitch({ enabled: true, allowLan: false });
    await applyKillSwitch({ enabled: true, env: fake.env });
    assert.equal((await beginEnrollmentPause({ env: fake.env })).ok, true);
    writeFileSync(fake.failure, "1");
    const result = await endEnrollmentPause({ env: fake.env, retryMs: 10 });
    assert.equal(result.ok, false);
    assert.equal(result.resumed, false);
    assert.equal(getEnrollmentPauseState().paused, true);
    assert.equal(getEnrollmentPauseState().restorationPending, true);
    assert.match(getEnrollmentPauseState().error, /simulated restore failure/);
    assert.throws(() => readFileSync(fake.state), { code: "ENOENT" });
    rmSync(fake.failure);
    const deadline = Date.now() + 4000;
    while (getEnrollmentPauseState().paused && Date.now() < deadline) await delay(20);
    assert.equal(getEnrollmentPauseState().paused, false);
    assert.match(readFileSync(fake.state, "utf8"), /policy drop/);
  } finally {
    cancelEnrollmentPause(); clearSessionOverrides(); reloadConfig(process.env);
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("enrollment restoration obeys current off preference and current LAN setting", { skip: process.platform === "win32" }, async () => {
  const fake = fakeFirewall();
  try {
    clearSessionOverrides();
    setSessionKillSwitch({ enabled: true, allowLan: false });
    await applyKillSwitch({ enabled: true, env: fake.env });
    await beginEnrollmentPause({ env: fake.env });
    setSessionKillSwitch({ enabled: false, allowLan: true });
    assert.equal((await endEnrollmentPause({ env: fake.env })).resumed, false);
    assert.equal(getEnrollmentPauseState().paused, false);
    assert.throws(() => readFileSync(fake.state), { code: "ENOENT" });
    setSessionKillSwitch({ enabled: true, allowLan: false });
    await beginEnrollmentPause({ env: fake.env });
    setSessionKillSwitch({ enabled: true, allowLan: true });
    assert.equal((await endEnrollmentPause({ env: fake.env })).resumed, true);
    assert.match(readFileSync(fake.state, "utf8"), /10\.0\.0\.0\/8/);
  } finally {
    cancelEnrollmentPause(); clearSessionOverrides(); reloadConfig(process.env);
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("queued restore reads preference only after an explicit off operation persists", { skip: process.platform === "win32" }, async () => {
  const fake = fakeFirewall();
  try {
    clearSessionOverrides(); setSessionKillSwitch({ enabled: true, allowLan: false });
    await applyKillSwitch({ enabled: true, env: fake.env });
    await beginEnrollmentPause({ env: fake.env });
    const off = applyKillSwitch({ enabled: false, env: fake.env, onSuccess: async () => {
      await delay(40); setSessionKillSwitch({ enabled: false });
    } });
    const restore = endEnrollmentPause({ env: fake.env });
    assert.equal((await off).ok, true);
    const result = await restore;
    assert.equal(result.resumed, false);
    assert.equal(getEnrollmentPauseState().paused, false);
    assert.throws(() => readFileSync(fake.state), { code: "ENOENT" });
  } finally {
    cancelEnrollmentPause(); clearSessionOverrides(); reloadConfig(process.env);
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("privileged fallback receives only structured fixed options, never an nft filename", { skip: process.platform === "win32" }, async () => {
  const fake = fakeFirewall();
  const recorded = join(fake.root, "pkexec-args");
  try {
    writeFileSync(join(fake.root, "nft"), `#!${process.execPath}\nconsole.error('Operation not permitted'); process.exit(1);\n`, { mode: 0o700 });
    writeFileSync(join(fake.root, "pkexec"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(recorded)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
    const env = { ...fake.env, DISPLAY: ":0", CLOUDFLARE_ONE_WARP_NFT_HELPER: "/usr/lib/cloudflare-one-warp/scripts/cloudflare-one-warp-nft-apply" };
    const result = await applyKillSwitch({ enabled: true, allowLan: true, env });
    assert.equal(result.ok, true);
    assert.equal(result.method, "pkexec");
    assert.deepEqual(JSON.parse(readFileSync(recorded, "utf8")), [env.CLOUDFLARE_ONE_WARP_NFT_HELPER, "enable", "true", "destroy"]);
  } finally { rmSync(fake.root, { recursive: true, force: true }); }
});

test("explicit off cancels a queued restore generation even after protection is re-enabled", { skip: process.platform === "win32" }, async () => {
  const fake = fakeFirewall();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  try {
    clearSessionOverrides(); setSessionKillSwitch({ enabled: true, allowLan: false });
    await applyKillSwitch({ enabled: true, env: fake.env });
    await beginEnrollmentPause({ env: fake.env });
    const blocker = applyKillSwitch({ enabled: false, env: fake.env, onSuccess: () => blocked });
    const off = applyKillSwitch({ enabled: false, env: fake.env, onSuccess: () => {
      setSessionKillSwitch({ enabled: false }); cancelEnrollmentPause();
    } });
    const on = applyKillSwitch({ enabled: true, env: fake.env, onSuccess: () => {
      setSessionKillSwitch({ enabled: true }); writeFileSync(fake.failure, "1");
    } });
    const obsoleteRestore = endEnrollmentPause({ env: fake.env, retryMs: 10 });
    await delay(60); release();
    await blocker; await off; await on;
    const result = await obsoleteRestore;
    assert.equal(result.ok, true);
    assert.equal(result.cancelled, true);
    assert.equal(result.resumed, false);
    assert.equal(getEnrollmentPauseState().paused, false);
    const before = readFileSync(fake.events, "utf8");
    assert.equal(before.match(/start true/g)?.length, 2, "obsolete generation must not invoke nft");
    await delay(80);
    assert.equal(readFileSync(fake.events, "utf8"), before, "canceled generation must not schedule a retry");
  } finally {
    release(); cancelEnrollmentPause(); clearSessionOverrides(); reloadConfig(process.env);
    rmSync(fake.root, { recursive: true, force: true });
  }
});
