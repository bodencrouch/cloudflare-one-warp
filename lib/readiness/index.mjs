/**
 * Authoritative readiness answer for tray, Web UI, and launcher.
 * Consumers must not recompute these checks independently.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, win32, join } from "node:path";

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
export function probeWarpCliPresent(cliPath, { whichSync, env = process.env, platform = process.platform, access = accessSync } = {}) {
  const cmd = String(cliPath || "warp-cli").trim() || "warp-cli";
  const windows = platform === "win32";
  const extensions = windows && !/\.[^/\\]+$/.test(cmd)
    ? ["", ...(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  const paths = cmd.includes("/") || cmd.includes("\\") || /\.(mjs|cjs|js)$/i.test(cmd)
    ? [cmd] : (env.PATH || "").split(windows ? ";" : delimiter).filter(Boolean).map((dir) =>
      windows ? win32.join(dir, cmd) : join(dir, cmd));
  if (whichSync && !cmd.includes("/") && !cmd.includes("\\")) {
    const found = whichSync(cmd);
    return { present: Boolean(found), path: found || cmd };
  }
  for (const path of paths) {
    for (const ext of extensions) {
      for (const suffix of new Set([ext, windows ? ext.toLowerCase() : ext])) {
        try {
          access(path + suffix, windows || /\.(mjs|cjs|js)$/i.test(path) ? fsConstants.F_OK : fsConstants.X_OK);
          return { present: true, path: path + suffix };
        } catch { /* try next candidate */ }
      }
    }
  }
  return { present: false, path: cmd };
}

async function execute(cmd, args, options) {
  try {
    const result = await execFileAsync(cmd, args, { ...options, maxBuffer: 65536 });
    return { ...result, status: 0 };
  } catch (error) {
    return { status: error.code, stdout: error.stdout || "", stderr: error.stderr || error.message };
  }
}

/** Resolve a host-only CLI using the same Flatpak execution boundary as actions. */
export async function probeWarpCli({ cliPath, env = process.env, platform = process.platform, whichSync, executeCommand = execute } = {}) {
  if (env.FLATPAK_ID && (!cliPath || cliPath === "warp-cli")) {
    const result = await executeCommand("flatpak-spawn", ["--host", "--", "warp-cli", "--version"], {
      timeout: 4000, encoding: "utf8", env
    });
    return { present: result.status === 0, path: String(cliPath || "warp-cli"), host: true };
  }
  return probeWarpCliPresent(cliPath, { env, platform, whichSync });
}

const trayProbeCache = new Map();
/** Async, shared probes keep snapshots and unrelated HTTP requests responsive. */
export async function probeTrayToolkit({ spawn = execute, env = process.env, platform = process.platform, cacheMs = 60000 } = {}) {
  if (platform === "win32") return { available: false, backend: null, reason: "windows" };
  const key = JSON.stringify([env.PATH, env.CLOUDFLARE_ONE_WARP_TRAY_PYTHON, env.CLOUDFLARE_ONE_WARP_PYTHON, env.PYTHONPATH, env.FLATPAK_ID]);
  const cached = spawn === execute && trayProbeCache.get(key);
  if (cached && Date.now() - cached.startedAt < cacheMs) return cached.promise;
  const promise = (async () => {
    let defaultPython = "python3";
    try { accessSync("/usr/bin/python3", fsConstants.X_OK); defaultPython = "/usr/bin/python3"; } catch { /* resolve PATH */ }
    const py = env.CLOUDFLARE_ONE_WARP_TRAY_PYTHON || env.CLOUDFLARE_ONE_WARP_PYTHON || defaultPython;
    for (const [cmd, args, backend, timeout] of [
      [py, ["-c", "from PyQt6.QtWidgets import QSystemTrayIcon; from PyQt6.QtWebEngineWidgets import QWebEngineView"], "qt", 4000],
      [py, ["-c", "import gi; gi.require_version('Gtk', '3.0')\ntry:\n gi.require_version('AppIndicator3', '0.1'); from gi.repository import AppIndicator3\nexcept ValueError:\n gi.require_version('AyatanaAppIndicator3', '0.1'); from gi.repository import AyatanaAppIndicator3"], "sni", 4000],
      ["yad", ["--version"], "yad", 2000]
    ]) {
      const result = await spawn(cmd, args, { encoding: "utf8", timeout, env });
      if (result.status === 0) return { available: true, backend, reason: null };
    }
    return { available: false, backend: null, reason: "no_backend" };
  })();
  if (spawn === execute) trayProbeCache.set(key, { startedAt: Date.now(), promise });
  return promise;
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
      nextStep: "Install the Cloudflare One Client so Cloudflare One WARP can talk to WARP, then try again.",
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
  const paused = Boolean(killSwitch?.enrollmentPause?.paused || killSwitch?.enrollmentPause?.restorationPending);
  const active = killSwitch?.active;
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
      nextStep: killSwitch?.enrollmentPause?.restorationPending
        ? "Firewall restoration failed and will be retried. Protection is not confirmed; reapply Always On in Settings."
        : "Always On is paused for Zero Trust sign-in. Finish registration, or turn Always On off in Settings.",
      detail: killSwitch?.enrollmentPause?.error || killSwitch?.detail || "Paused for enrollment"
    }));
  } else {
    items.push(item({
      id: "kill_switch",
      state: "needs_attention",
      hardBlocker: false,
      title: "Always On",
      nextStep: active === true
        ? "Always On is blocking traffic outside WARP. Connect WARP, or turn Always On off in Settings to restore access."
        : (active === false
          ? "Always On is requested, but its firewall rules are absent. Reapply protection in Settings."
          : "Always On is requested, but firewall protection could not be verified. Check the firewall and reapply protection."),
      detail: active === true ? "Rules active" : active === false ? "Rules absent" : "Protection unknown"
    }));
  }

  if (daemonListen?.listening !== false) {
    items.push(item({
      id: "daemon_listen",
      state: "ready",
      hardBlocker: false,
      title: "Cloudflare One WARP",
      detail: "Local control plane is answering."
    }));
  } else {
    items.push(item({
      id: "daemon_listen",
      state: "unavailable",
      hardBlocker: true,
      title: "Cloudflare One WARP",
      nextStep: "Start the Cloudflare One WARP daemon and try again.",
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
  whichSync,
  env = process.env,
  platform = process.platform,
  executeCommand
} = {}) {
  const warpCli = await probeWarpCli({ cliPath: warpCliPath, whichSync, env, platform, executeCommand });

  let warpService = { available: false, message: "WARP status was not checked." };
  if (warpCli.present && typeof runStatus === "function") {
    try {
      const result = await runStatus();
      const combined = `${result?.stderr || ""}\n${result?.stdout || ""}`;
      const missing = /unable to connect to the cloudflarewarp daemon|maybe the daemon is not running|operation not permitted/i.test(combined);
      const succeeded = result?.ok !== false && (result?.ok === true || result?.code === 0 || result?.status === 0);
      const recognized = /\b(connected|disconnected|connecting|reconnecting|registration missing|not registered)\b/i.test(result?.stdout || "");
      const available = !missing && succeeded && recognized;
      warpService = {
        available,
        message: available ? "CloudflareWARP daemon responded."
          : (result?.stderr || result?.stdout || "WARP service returned no recognized status.")
      };
    } catch (err) {
      warpService = {
        available: false,
        message: err?.message || "WARP status check failed."
      };
    }
  }

  const trayToolkit = typeof trayProbe === "function"
    ? await trayProbe()
    : await probeTrayToolkit({ env, platform });

  let killSwitch = {
    desired: Boolean(killSwitchDesired),
    allowLan: Boolean(killSwitchAllowLan),
    active: null,
    enrollmentPause: { paused: false },
    detail: null
  };
  if (typeof probeKillSwitch === "function") {
    try {
      const probe = await probeKillSwitch();
      killSwitch.active = typeof probe?.active === "boolean" ? probe.active : null;
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
    "Cloudflare One WARP diagnostics",
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
