import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReadinessReport,
  formatDiagnosticsClipboard,
  probeWarpCliPresent
} from "../lib/readiness/index.mjs";

test("all ready report has no blockers or soft warnings", () => {
  const report = buildReadinessReport({
    warpCli: { present: true, path: "/usr/bin/warp-cli" },
    warpService: { available: true, message: "ok" },
    trayToolkit: { available: true, backend: "qt" },
    killSwitch: { desired: false, active: false, enrollmentPause: { paused: false } }
  });
  assert.equal(report.ready, true);
  assert.equal(report.hardBlocked, false);
  assert.equal(report.softWarnings, false);
  assert.equal(report.killSwitchMode, "off");
  assert.deepEqual(report.connectBlockedBy, []);
});

test("missing warp-cli is a hard blocker", () => {
  const report = buildReadinessReport({
    warpCli: { present: false, path: "warp-cli" },
    warpService: { available: false },
    trayToolkit: { available: true, backend: "qt" },
    killSwitch: { desired: false, active: false, enrollmentPause: { paused: false } }
  });
  assert.equal(report.hardBlocked, true);
  assert.ok(report.connectBlockedBy.includes("warp_cli"));
  const cli = report.items.find((i) => i.id === "warp_cli");
  assert.equal(cli.hardBlocker, true);
  assert.match(cli.nextStep, /Install the Cloudflare One Client/i);
});

test("unreachable WARP service is a hard blocker", () => {
  const report = buildReadinessReport({
    warpCli: { present: true, path: "warp-cli" },
    warpService: { available: false, message: "Unable to connect to the CloudflareWARP daemon." },
    trayToolkit: { available: true, backend: "qt" },
    killSwitch: { desired: false, active: false, enrollmentPause: { paused: false } }
  });
  assert.equal(report.hardBlocked, true);
  assert.ok(report.connectBlockedBy.includes("warp_service"));
});

test("Always On desired is a soft warning, not a hard blocker", () => {
  const report = buildReadinessReport({
    warpCli: { present: true, path: "warp-cli" },
    warpService: { available: true },
    trayToolkit: { available: true, backend: "qt" },
    killSwitch: { desired: true, active: true, enrollmentPause: { paused: false } }
  });
  assert.equal(report.hardBlocked, false);
  assert.equal(report.softWarnings, true);
  assert.equal(report.killSwitchMode, "always_on");
  assert.deepEqual(report.connectBlockedBy, []);
  const ks = report.items.find((i) => i.id === "kill_switch");
  assert.equal(ks.hardBlocker, false);
  assert.equal(ks.state, "needs_attention");
  assert.match(ks.nextStep, /turn Always On off/i);
});

test("enrollment pause maps to paused mode and soft warning", () => {
  const report = buildReadinessReport({
    warpCli: { present: true, path: "warp-cli" },
    warpService: { available: true },
    trayToolkit: { available: true, backend: "qt" },
    killSwitch: { desired: true, active: false, enrollmentPause: { paused: true } }
  });
  assert.equal(report.killSwitchMode, "paused");
  assert.equal(report.hardBlocked, false);
  assert.equal(report.softWarnings, true);
});

test("missing tray toolkit is a soft warning so Connect stays available", () => {
  const report = buildReadinessReport({
    warpCli: { present: true, path: "warp-cli" },
    warpService: { available: true },
    trayToolkit: { available: false, reason: "no_backend" },
    killSwitch: { desired: false, active: false, enrollmentPause: { paused: false } }
  });
  assert.equal(report.hardBlocked, false);
  assert.equal(report.softWarnings, true);
  const tray = report.items.find((i) => i.id === "tray_toolkit");
  assert.equal(tray.hardBlocker, false);
  assert.match(tray.nextStep, /Web UI still works/i);
});

test("probeWarpCliPresent finds an absolute script path", () => {
  const self = new URL(import.meta.url).pathname;
  const result = probeWarpCliPresent(self);
  assert.equal(result.present, true);
});

test("diagnostics clipboard excludes account-looking fields and includes readiness", () => {
  const report = buildReadinessReport({
    warpCli: { present: false, path: "warp-cli" },
    warpService: { available: false },
    trayToolkit: { available: false },
    killSwitch: { desired: true, active: true, enrollmentPause: { paused: false } }
  });
  const text = formatDiagnosticsClipboard({
    readiness: report,
    version: "0.2.7",
    installFormat: "dev",
    logs: ["status ok", "registration id=secret-should-not-matter-here"]
  });
  assert.match(text, /Hard blocked: yes/);
  assert.match(text, /Always On mode: always_on/);
  assert.match(text, /Install the Cloudflare One Client/);
  assert.doesNotMatch(text, /Organization:\s+\S+/i);
  assert.doesNotMatch(text, /License:\s+\S+/i);
  assert.doesNotMatch(text, /Account ID:\s+\S+/i);
});
