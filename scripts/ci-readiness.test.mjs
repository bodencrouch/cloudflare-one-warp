import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildReadinessReport,
  formatDiagnosticsClipboard,
  probeWarpCliPresent,
  probeWarpCli,
  probeTrayToolkit,
  assessReadiness
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
  const self = fileURLToPath(import.meta.url);
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


test("Windows discovery honors PATHEXT and executable candidates", () => {
  const result = probeWarpCliPresent("warp-cli", {
    platform: "win32", env: { PATH: "C:\\WARP", PATHEXT: ".EXE;.CMD" },
    access(path) { if (path !== "C:\\WARP\\warp-cli.EXE") throw new Error("missing"); }
  });
  assert.equal(result.present, true);
  assert.equal(result.path, "C:\\WARP\\warp-cli.EXE");
});

test("Flatpak readiness probes the host CLI instead of sandbox PATH", async () => {
  const result = await probeWarpCli({ env: { FLATPAK_ID: "test" }, executeCommand: async (cmd, args) => {
    assert.equal(cmd, "flatpak-spawn");
    assert.deepEqual(args, ["--host", "--", "warp-cli", "--version"]);
    return { status: 0 };
  } });
  assert.equal(result.present, true);
  assert.equal(result.host, true);
});

test("slow toolkit probing yields to the event loop", async () => {
  let timerRan = false;
  const timer = new Promise(resolve => setTimeout(() => { timerRan = true; resolve(); }, 5));
  const pending = probeTrayToolkit({ platform: "linux", spawn: async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return { status: 0 };
  } });
  await timer;
  assert.equal(timerRan, true);
  assert.equal((await pending).backend, "qt");
});

test("failed status is not ready even with unfamiliar stderr", async () => {
  const report = await assessReadiness({
    warpCliPath: "warp-cli", whichSync: () => "/mock/warp-cli",
    runStatus: async () => ({ ok: false, code: 1, stderr: "IPC connection refused" }),
    trayProbe: async () => ({ available: true }), killSwitchDesired: true,
    probeKillSwitch: async () => ({ active: null })
  });
  assert.equal(report.hardBlocked, true);
  assert.match(report.items.find(i => i.id === "warp_service").detail, /IPC connection refused/);
  assert.match(report.items.find(i => i.id === "kill_switch").detail, /unknown/i);
});

test("requested protection with absent rules never promises protection", () => {
  const report = buildReadinessReport({ warpCli: { present: true }, warpService: { available: true },
    trayToolkit: { available: true }, killSwitch: { desired: true, active: false } });
  const protection = report.items.find(i => i.id === "kill_switch");
  assert.match(protection.nextStep, /rules are absent/);
  assert.doesNotMatch(protection.nextStep, /will be blocked/);
  assert.equal(protection.hardBlocker, false);
});

test("failed enrollment restoration is a persistent protection warning", () => {
  const report = buildReadinessReport({ warpCli: { present: true }, warpService: { available: true },
    trayToolkit: { available: true }, killSwitch: { desired: true, active: false,
      enrollmentPause: { restorationPending: true, error: "nft restore failed" } } });
  const protection = report.items.find(i => i.id === "kill_switch");
  assert.equal(protection.state, "needs_attention");
  assert.match(protection.nextStep, /restoration failed/);
  assert.equal(protection.detail, "nft restore failed");
});

test("empty successful status does not establish service readiness", async () => {
  const common = { warpCliPath: "warp-cli", whichSync: () => "/mock/warp-cli", trayProbe: () => ({ available: true }) };
  const empty = await assessReadiness({ ...common, runStatus: async () => ({ ok: true, code: 0, stdout: "" }) });
  assert.equal(empty.hardBlocked, true);
  const disconnected = await assessReadiness({ ...common, runStatus: async () => ({ ok: true, code: 0, stdout: "Status update: Disconnected" }) });
  assert.equal(disconnected.hardBlocked, false);
});

test("tray readiness requires WebEngine and uses the selected tray Python", async () => {
  const calls = [];
  const result = await probeTrayToolkit({ env: { CLOUDFLARE_ONE_WARP_TRAY_PYTHON: "/selected/python" },
    spawn: async (command, args) => {
      calls.push([command, args]);
      return { status: args[1]?.includes("AppIndicator3") ? 0 : 1 };
    } });
  assert.equal(calls[0][0], "/selected/python");
  assert.match(calls[0][1][1], /QtWebEngineWidgets/);
  assert.match(calls[1][1][1], /AyatanaAppIndicator3/);
  assert.equal(result.backend, "sni");
});
