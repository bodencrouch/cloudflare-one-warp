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
  getEnrollmentPauseState
} from "../lib/killswitch/enroll-pause.mjs";
import { probeKillSwitchActive } from "../lib/killswitch/apply.mjs";

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
  const env = { ...process.env, HOME: root, CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0" };

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
