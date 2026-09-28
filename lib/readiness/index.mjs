/**
 * Authoritative readiness answer for tray, Web UI, and launcher.
 * Consumers must not recompute these checks independently.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter } from "node:path";

export const READINESS_STATES = Object.freeze(["ready", "needs_attention", "unavailable"]);

/** @typedef {"ready" | "needs_attention" | "unavailable"} ReadinessState */

/**
 * @typedef {object} ReadinessItem
 * @property {string} id
 * @property {ReadinessState} state
 * @property {boolean} hardBlocker
 * @property {string} title
 * @property {string} [nextStep]
 * @property {string} [detail]
 */

/**
 * @typedef {object} ReadinessReport
 * @property {string} generatedAt
 * @property {boolean} ready
 * @property {boolean} hardBlocked
 * @property {boolean} softWarnings
 * @property {boolean} needsAttention
 * @property {"off"|"always_on"|"paused"} killSwitchMode
 * @property {ReadinessItem[]} items
 * @property {string[]} [connectBlockedBy]
 */

function item(partial) {
  return {
    hardBlocker: false,
    ...partial
  };
}

/** Resolve whether the configured warp-cli binary exists on disk or PATH. */
export function probeWarpCliPresent(cliPath, { whichSync } = {}) {
  const cmd = String(cliPath || "warp-cli").trim() || "warp-cli";
  if (cmd.includes("/") || cmd.includes("\\") || /\.(mjs|cjs|js)$/i.test(cmd)) {
    try {
      accessSync(cmd, fsConstants.X_OK);
      return { present: true, path: cmd };
    } catch {
      try {
        accessSync(cmd, fsConstants.F_OK);
        return { present: true, path: cmd };
      } catch {
        return { present: false, path: cmd };
      }
    }
  }
  const finder = whichSync || ((name) => {
    const parts = (process.env.PATH || "").split(delimiter);
    for (const dir of parts) {
      if (!dir) continue;
      const candidate = `${dir.replace(/[/\\]$/, "")}/${name}`;
      try {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        /* continue */
      }
    }
    return null;
  });
  const found = finder(cmd);
  return { present: Boolean(found), path: found || cmd };
}

/**
 * Detect a usable tray backend without shelling the full tray script.
 * Soft warning only — Connect must still work from the Web UI.
 */
export function probeTrayToolkit({ spawn = spawnSync, env = process.env } = {}) {
  if (process.platform === "win32") {
    return { available: false, backend: null, reason: "windows" };
  }
  const py = env.THIRDFLARE_PYTHON || "python3";
  const qt = spawn(py, ["-c", "import PyQt6.QtWidgets"], {
    encoding: "utf8",
    timeout: 4000,
    env
  });
  if (qt.status === 0) {
    return { available: true, backend: "qt", reason: null };
  }
  const sni = spawn(py, ["-c", "import gi; gi.require_version('AyatanaAppIndicator3', '0.1')"], {
    encoding: "utf8",
    timeout: 4000,
    env
  });
  if (sni.status === 0) {
    return { available: true, backend: "sni", reason: null };
  }
  const yad = spawn("yad", ["--version"], { encoding: "utf8", timeout: 2000, env });
  if (yad.status === 0) {
    return { available: true, backend: "yad", reason: null };
  }
  return { available: false, backend: null, reason: "no_backend" };
}

/**
 * Build the readiness report from already-gathered probe results.
 * Pure — easy to unit test without spawning processes.
 */
export function buildReadinessReport({
  warpCli,
  warpService,
  trayToolkit,
  killSwitch,
  daemonListen = { listening: true },
  generatedAt = new Date().toISOString()
} = {}) {
  /** @type {ReadinessItem[]} */
  const items = [];

  if (warpCli?.present) {
    items.push(item({
      id: "warp_cli",
      state: "ready",
      hardBlocker: false,
      title: "Cloudflare One Client tools",
      detail: warpCli.path || "warp-cli"
    }));
  } else {
    items.push(item({
      id: "warp_cli",
      state: "unavailable",
      hardBlocker: true,
      title: "Cloudflare One Client tools",
      nextStep: "Install the Cloudflare One Client so ThirdFlare One can talk to WARP, then try again.",
      detail: warpCli?.path || "warp-cli"
    }));
  }

  if (!warpCli?.present) {
    items.push(item({
      id: "warp_service",
      state: "unavailable",
      hardBlocker: true,
      title: "WARP service",
      nextStep: "Install and start the Cloudflare One Client first.",
      detail: "Skipped — warp-cli is missing."
    }));
  } else if (warpService?.available) {
    items.push(item({
      id: "warp_service",
      state: "ready",
      hardBlocker: false,
      title: "WARP service",
      detail: warpService.message || "CloudflareWARP daemon responded."
    }));
  } else {
    items.push(item({
      id: "warp_service",
      state: "unavailable",
      hardBlocker: true,
      title: "WARP service",
      nextStep: "Start the Cloudflare WARP service (warp-svc), then reconnect.",
      detail: warpService?.message || "Unable to reach the CloudflareWARP daemon."
    }));
  }

  if (trayToolkit?.available) {
    items.push(item({
      id: "tray_toolkit",
      state: "ready",
      hardBlocker: false,
      title: "Tray",
      detail: trayToolkit.backend ? `Using ${trayToolkit.backend}` : "Tray backend available"
    }));
  } else {
    items.push(item({
      id: "tray_toolkit",
      state: "needs_attention",
      hardBlocker: false,
      title: "Tray",
      nextStep: "Install PyQt6 (or another tray backend) if you want the system tray. The Web UI still works.",
      detail: trayToolkit?.reason || "No tray backend found"
    }));
  }

  const desired = Boolean(killSwitch?.desired);
  const paused = Boolean(killSwitch?.enrollmentPause?.paused);
  const active = Boolean(killSwitch?.active);
  /** @type {"off"|"always_on"|"paused"} */
  let killSwitchMode = "off";
  if (paused) killSwitchMode = "paused";
  else if (desired) killSwitchMode = "always_on";

  if (killSwitchMode === "off") {
    items.push(item({
      id: "kill_switch",
      state: "ready",
      hardBlocker: false,
      title: "Always On",
      detail: "Off — outbound traffic is not blocked when WARP drops."
    }));
  } else if (killSwitchMode === "paused") {
    items.push(item({
      id: "kill_switch",
      state: "needs_attention",
      hardBlocker: false,
      title: "Always On",
      nextStep: "Always On is paused for Zero Trust sign-in. Finish registration, or turn Always On off in Settings.",
      detail: killSwitch?.detail || "Paused for enrollment"
    }));
  } else {
    items.push(item({
      id: "kill_switch",
      state: "needs_attention",
      hardBlocker: false,
      title: "Always On",
      nextStep: active
        ? "Always On is blocking traffic outside WARP. Connect WARP, or turn Always On off in Settings to restore access."
        : "Always On is on. If the tunnel drops, outbound traffic outside WARP will be blocked.",
      detail: active ? "Rules active" : "Desired on"
    }));
  }

  if (daemonListen?.listening !== false) {
    items.push(item({
      id: "daemon_listen",
      state: "ready",
      hardBlocker: false,
      title: "ThirdFlare One",
      detail: "Local control plane is answering."
    }));
  } else {
    items.push(item({
      id: "daemon_listen",
      state: "unavailable",
      hardBlocker: true,
      title: "ThirdFlare One",
      nextStep: "Start the ThirdFlare One daemon and try again.",
      detail: "Not listening"
    }));
  }

  const hardBlocked = items.some((entry) => entry.hardBlocker && entry.state !== "ready");
  const softWarnings = items.some((entry) => !entry.hardBlocker && entry.state !== "ready");
  const connectBlockedBy = items
    .filter((entry) => entry.hardBlocker && entry.state !== "ready")
    .map((entry) => entry.id);

  return {
    generatedAt,
    ready: !hardBlocked && !softWarnings,
    hardBlocked,
    softWarnings,
    needsAttention: hardBlocked || softWarnings,
    killSwitchMode,
    connectBlockedBy,
    items
  };
}

/**
 * Gather live probes and build a readiness report.
 */
export async function assessReadiness({
  warpCliPath,
  runStatus,
  probeKillSwitch,
  getEnrollmentPause,
  killSwitchDesired,
  killSwitchAllowLan,
  trayProbe,
  whichSync
} = {}) {
  const warpCli = probeWarpCliPresent(warpCliPath, { whichSync });

  let warpService = { available: false, message: "WARP status was not checked." };
  if (warpCli.present && typeof runStatus === "function") {
    try {
      const result = await runStatus();
      const combined = `${result?.stderr || ""}\n${result?.stdout || ""}`;
      const missing = /unable to connect to the cloudflarewarp daemon|maybe the daemon is not running|operation not permitted/i.test(combined);
      warpService = {
        available: !missing,
        message: missing
          ? (result?.stderr || result?.stdout || "Unable to reach the CloudflareWARP daemon.")
          : "CloudflareWARP daemon responded."
      };
    } catch (err) {
      warpService = {
        available: false,
        message: err?.message || "WARP status check failed."
      };
    }
  }

  const trayToolkit = typeof trayProbe === "function"
    ? trayProbe()
    : probeTrayToolkit();

  let killSwitch = {
    desired: Boolean(killSwitchDesired),
    allowLan: Boolean(killSwitchAllowLan),
    active: false,
    enrollmentPause: { paused: false },
    detail: null
  };
  if (typeof probeKillSwitch === "function") {
    try {
      const probe = await probeKillSwitch();
      killSwitch.active = Boolean(probe?.active);
      killSwitch.detail = probe?.detail || null;
    } catch (err) {
      killSwitch.detail = err?.message || "Kill switch probe failed.";
    }
  }
  if (typeof getEnrollmentPause === "function") {
    try {
      killSwitch.enrollmentPause = getEnrollmentPause() || { paused: false };
    } catch {
      killSwitch.enrollmentPause = { paused: false };
    }
  }

  return buildReadinessReport({
    warpCli,
    warpService,
    trayToolkit,
    killSwitch,
    daemonListen: { listening: true }
  });
}

/** Compact text for clipboard diagnostics (no account identifiers). */
export function formatDiagnosticsClipboard({ readiness, version, logs = [], installFormat } = {}) {
  const lines = [
    "ThirdFlare One diagnostics",
    `Generated: ${readiness?.generatedAt || new Date().toISOString()}`,
    `Version: ${version || "unknown"}${installFormat ? ` (${installFormat})` : ""}`,
    `Hard blocked: ${readiness?.hardBlocked ? "yes" : "no"}`,
    `Always On mode: ${readiness?.killSwitchMode || "unknown"}`,
    "",
    "Readiness:"
  ];
  for (const entry of readiness?.items || []) {
    const step = entry.nextStep ? ` → ${entry.nextStep}` : "";
    lines.push(`- [${entry.state}] ${entry.title}${entry.hardBlocker ? " (blocks connect)" : ""}${step}`);
    if (entry.detail) lines.push(`  ${entry.detail}`);
  }
  if (logs.length) {
    lines.push("", "Recent daemon log:");
    for (const line of logs.slice(-20)) {
      lines.push(`- ${String(line).replace(/\s+/g, " ").trim().slice(0, 240)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
