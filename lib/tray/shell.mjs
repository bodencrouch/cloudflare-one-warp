import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { syncTrayAutostart, resolveAppRoot, resolveTrayExec } from "./autostart.mjs";

export const TRAY_SHELLS = new Set(["cloudflare", "thirdflare"]);
export const DEFAULT_TRAY_SHELL = "cloudflare";

export const WARP_TASKBAR_PATH = "/usr/bin/warp-taskbar";
export const WARP_DESKTOP_SVC_PATH = "/usr/bin/warp-desktop-svc";
export const WARP_DESKTOP_SVC_UNIT = "warp-desktop-svc.service";
export const WARP_DESKTOP_SVC_UNIT_PATH = "/usr/lib/systemd/user/warp-desktop-svc.service";
export const CLOUDFLARE_AUTOSTART_BASENAME = "com.cloudflare.WarpTaskbar.desktop";
export const CLOUDFLARE_OVERRIDE_MARKER = "Managed by ThirdFlare One";

const ALLOWED_WARP_GUI_REQUESTS = new Set([WARP_TASKBAR_PATH, WARP_DESKTOP_SVC_PATH]);

export const MANAGED_WARP_DESKTOP_SVC_UNIT = "thirdflare-warp-desktop-svc.service";

export function underFlatpak(env = process.env) {
  return Boolean(env.FLATPAK_ID);
}

const execFileAsync = promisify(execFile);

function hostArgv(file, args, env) {
  return underFlatpak(env)
    ? { command: "flatpak-spawn", argv: ["--host", file, ...args] }
    : { command: file, argv: args };
}

/**
 * Run a fixed-argv command, hopping to the host session under Flatpak.
 * argv only — never builds a shell string.
 *
 * Async on purpose: these are `systemctl --user` and `pkill` calls reached from
 * HTTP handlers. Done synchronously, a hung user manager would block the event
 * loop for the full timeout and stall every SSE subscriber and health check.
 */
async function runHostCommand(file, args, { env = process.env, timeout = 8000 } = {}) {
  const { command, argv } = hostArgv(file, args, env);
  try {
    await execFileAsync(command, argv, { env, timeout });
    return true;
  } catch {
    return false;
  }
}

/** Sync twin, for the detection path only — one fast `test -x` under Flatpak. */
function runHostCommandSync(file, args, { env = process.env, timeout = 4000 } = {}) {
  const { command, argv } = hostArgv(file, args, env);
  try {
    execFileSync(command, argv, { env, stdio: "ignore", timeout });
    return true;
  } catch {
    return false;
  }
}

function hostBinaryExists(path, env = process.env) {
  return runHostCommandSync("test", ["-x", path], { env });
}

export function isValidTrayShell(value) {
  return TRAY_SHELLS.has(value);
}

export function normalizeTrayShell(value) {
  return isValidTrayShell(value) ? value : DEFAULT_TRAY_SHELL;
}

export function cloudflareAutostartOverridePath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configHome, "autostart", CLOUDFLARE_AUTOSTART_BASENAME);
}

export function buildCloudflareHiddenDesktop() {
  return `# ${CLOUDFLARE_OVERRIDE_MARKER}
[Desktop Entry]
Type=Application
Version=1.2
Name=Cloudflare One Client
Comment=View the current status of the WARP Tunnel
Exec=/usr/bin/warp-taskbar
Hidden=true
NoDisplay=true
X-GNOME-Autostart-enabled=false
StartupNotify=false
Keywords=warp teams cloudflare vpn
Icon=zero-trust-orange
Terminal=false
StartupWMClass=warp-taskbar
`;
}

export function isThirdflareManagedCloudflareOverride(content) {
  return typeof content === "string" && content.includes(CLOUDFLARE_OVERRIDE_MARKER);
}

export function detectCloudflareGui({
  taskbarPath = WARP_TASKBAR_PATH,
  desktopSvcPath = WARP_DESKTOP_SVC_PATH,
  exists = existsSync,
  hostExists,
  env = process.env
} = {}) {
  const check = underFlatpak(env)
    ? (hostExists || ((path) => hostBinaryExists(path, env)))
    : exists;
  return Boolean(check(taskbarPath) && check(desktopSvcPath));
}

export function isAllowedWarpGuiResolvedPath(resolved) {
  if (typeof resolved !== "string" || !resolved) return false;
  if (resolved === WARP_TASKBAR_PATH || resolved === WARP_DESKTOP_SVC_PATH) return true;
  return resolved.startsWith("/usr/lib/warp/");
}

export function resolveWarpGuiBinary(requestedPath, { exists = existsSync, realpath = realpathSync } = {}) {
  if (!ALLOWED_WARP_GUI_REQUESTS.has(requestedPath)) return null;
  if (!exists(requestedPath)) return null;
  try {
    const resolved = realpath(requestedPath);
    if (!isAllowedWarpGuiResolvedPath(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Resolve how to launch an allow-listed WARP GUI binary.
 * Returns a fixed argv pair, or null when the binary is unavailable.
 */
export function warpGuiSpawnCommand(requestedPath, {
  env = process.env,
  exists = existsSync,
  realpath = realpathSync,
  hostExists
} = {}) {
  if (!ALLOWED_WARP_GUI_REQUESTS.has(requestedPath)) return null;
  if (underFlatpak(env)) {
    const check = hostExists || ((path) => hostBinaryExists(path, env));
    if (!check(requestedPath)) return null;
    return { command: "flatpak-spawn", args: ["--host", requestedPath], path: requestedPath, host: true };
  }
  const resolved = resolveWarpGuiBinary(requestedPath, { exists, realpath });
  if (!resolved) return null;
  return { command: resolved, args: [], path: resolved, host: false };
}

export function describeTrayShell({
  shell,
  autostart = false,
  env = process.env,
  detect
} = {}) {
  const requested = normalizeTrayShell(shell);
  // Thread env through: detectCloudflareGui probes host paths under Flatpak, so
  // reading process.env here would report the sandbox instead of the caller's env.
  const cloudflareAvailable = detectCloudflareGui({ ...(detect || {}), env });
  const active = requested === "cloudflare" && cloudflareAvailable ? "cloudflare" : "thirdflare";
  return {
    shell: requested,
    autostart: Boolean(autostart),
    cloudflareAvailable,
    active
  };
}

export function decorateTrayConfig(config, detect) {
  const info = describeTrayShell({
    shell: config?.tray?.shell,
    autostart: config?.tray?.autostart,
    detect
  });
  return {
    ...config,
    tray: {
      autostart: Boolean(config?.tray?.autostart),
      shell: info.shell,
      cloudflareAvailable: info.cloudflareAvailable,
      active: info.active
    }
  };
}

/**
 * Decide whether the daemon should post status notifications.
 * Cloudflare One Client posts its own, so ours stay quiet while it is active.
 *
 * @param {{ notifications?: boolean, active?: string }} options
 */
export function shouldWatchStatusNotifications({ notifications = true, active } = {}) {
  if (notifications === false) return false;
  return active !== "cloudflare";
}

export function graphicalSessionAvailable(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

function shouldManageUnit(env = process.env, manageUnit) {
  if (typeof manageUnit === "boolean") return manageUnit;
  if (env.THIRDFLARE_TRAY_SKIP_SYSTEMD === "1") return false;
  if (env.NODE_TEST_CONTEXT) return false;
  return true;
}

function shouldLiveSwap(env = process.env, live) {
  if (live === false) return false;
  if (env.THIRDFLARE_TRAY_LIVE === "0") return false;
  if (env.NODE_TEST_CONTEXT) return false;
  return graphicalSessionAvailable(env);
}

export function syncCloudflareAutostartOverride({ hide, env = process.env } = {}) {
  if (process.platform !== "linux") {
    return { ok: true, skipped: true, reason: "non-linux" };
  }

  const path = cloudflareAutostartOverridePath(env);

  if (!hide) {
    if (!existsSync(path)) {
      return { ok: true, hidden: false, path, removed: false };
    }
    const existing = readFileSync(path, "utf8");
    if (!isThirdflareManagedCloudflareOverride(existing)) {
      return { ok: true, hidden: false, path, removed: false, preserved: true };
    }
    unlinkSync(path);
    return { ok: true, hidden: false, path, removed: true };
  }

  const content = buildCloudflareHiddenDesktop();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (existing === content) {
    return { ok: true, hidden: true, path, unchanged: true };
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o644 });
  return { ok: true, hidden: true, path, written: true };
}

async function runSystemctlUser(args, { env = process.env } = {}) {
  return { ok: await runHostCommand("systemctl", ["--user", ...args], { env }) };
}

export function managedWarpDesktopSvcUnitPath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configHome, "systemd", "user", MANAGED_WARP_DESKTOP_SVC_UNIT);
}

export function buildManagedWarpDesktopSvcUnit(execPath = WARP_DESKTOP_SVC_PATH) {
  return `# ${CLOUDFLARE_OVERRIDE_MARKER}
[Unit]
Description=Cloudflare Zero Trust Client Service
Documentation=https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/
Requires=dbus.socket
After=dbus.socket
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Type=simple
ExecStart=${execPath}
Restart=always
RestartSec=3

[Install]
WantedBy=graphical-session.target
`;
}

/**
 * Write or remove the ThirdFlare-managed user unit for warp-desktop-svc.
 * Used only when the WARP package ships no unit of its own.
 */
export function syncManagedWarpDesktopSvcUnit({ install, env = process.env, svcPath = WARP_DESKTOP_SVC_PATH } = {}) {
  const path = managedWarpDesktopSvcUnitPath(env);

  if (!install) {
    if (!existsSync(path)) {
      return { ok: true, installed: false, path, removed: false };
    }
    const existing = readFileSync(path, "utf8");
    if (!isThirdflareManagedCloudflareOverride(existing)) {
      return { ok: true, installed: false, path, removed: false, preserved: true };
    }
    unlinkSync(path);
    return { ok: true, installed: false, path, removed: true };
  }

  const content = buildManagedWarpDesktopSvcUnit(svcPath);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (existing === content) {
    return { ok: true, installed: true, path, unchanged: true };
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o644 });
  return { ok: true, installed: true, path, written: true };
}

/**
 * Enable or disable warp-desktop-svc for the login session.
 * Prefers the unit shipped by the WARP package; falls back to a
 * ThirdFlare-managed user unit when the package ships none.
 */
export async function syncWarpDesktopSvcUnit({ enable, env = process.env, unitPath = WARP_DESKTOP_SVC_UNIT_PATH } = {}) {
  if (process.platform !== "linux") {
    return { skipped: true, reason: "non-linux" };
  }
  // Inside Flatpak the sandbox cannot see host units, and a unit written to the
  // sandbox config is invisible to host systemd. Let the caller spawn instead.
  if (underFlatpak(env)) {
    return { skipped: true, reason: "flatpak" };
  }

  const action = enable ? "enable" : "disable";

  if (existsSync(unitPath)) {
    const result = await runSystemctlUser([action, "--now", WARP_DESKTOP_SVC_UNIT], { env });
    return { ok: result.ok, enable: Boolean(enable), unit: WARP_DESKTOP_SVC_UNIT, managed: false };
  }

  const svc = warpGuiSpawnCommand(WARP_DESKTOP_SVC_PATH, { env });
  if (!svc && enable) {
    return { skipped: true, reason: "no-unit" };
  }

  const managedPath = managedWarpDesktopSvcUnitPath(env);
  if (!enable && !existsSync(managedPath)) {
    return { skipped: true, reason: "no-unit" };
  }

  if (enable) {
    const written = syncManagedWarpDesktopSvcUnit({ install: true, env, svcPath: svc.path });
    await runSystemctlUser(["daemon-reload"], { env });
    const result = await runSystemctlUser([action, "--now", MANAGED_WARP_DESKTOP_SVC_UNIT], { env });
    return {
      ok: result.ok,
      enable: true,
      unit: MANAGED_WARP_DESKTOP_SVC_UNIT,
      managed: true,
      path: written.path
    };
  }

  const result = await runSystemctlUser([action, "--now", MANAGED_WARP_DESKTOP_SVC_UNIT], { env });
  const removed = syncManagedWarpDesktopSvcUnit({ install: false, env });
  await runSystemctlUser(["daemon-reload"], { env });
  return {
    ok: result.ok,
    enable: false,
    unit: MANAGED_WARP_DESKTOP_SVC_UNIT,
    managed: true,
    removed: Boolean(removed.removed)
  };
}

/**
 * Sync ThirdFlare and Cloudflare One Client XDG autostart so only one tray
 * launches at login. Linux-only; no-op elsewhere.
 */
export async function syncTrayShell({
  shell,
  autostart,
  env = process.env,
  appRoot,
  manageUnit,
  detect,
  platform = process.platform
} = {}) {
  if (platform !== "linux") {
    return { ok: true, skipped: true, reason: "non-linux" };
  }

  const info = describeTrayShell({ shell, autostart, env, detect });
  const thirdflareAutostart = info.active === "thirdflare" && Boolean(autostart);
  const tray = syncTrayAutostart({ autostart: thirdflareAutostart, env, appRoot });
  const cloudflare = syncCloudflareAutostartOverride({
    hide: info.active === "thirdflare",
    env
  });

  let unit = { skipped: true, reason: "disabled" };
  if (shouldManageUnit(env, manageUnit)) {
    unit = await syncWarpDesktopSvcUnit({ enable: info.active === "cloudflare", env });
  }

  return {
    ok: true,
    shell: info.shell,
    active: info.active,
    cloudflareAvailable: info.cloudflareAvailable,
    tray,
    cloudflare,
    unit
  };
}

function ereEscape(value) {
  return value.replace(/[.[\]{}()*+?^$|\\]/g, "\\$&");
}

/**
 * Build a full-command-line pattern for one allow-listed WARP GUI binary.
 *
 * Two reasons not to match on the process name: Linux truncates `comm` at 15
 * characters, so `pgrep -x warp-desktop-svc` never matches; and the same binary
 * runs as `/usr/bin/warp-taskbar` from the WARP autostart entry or as its
 * `/usr/lib/warp/` target when ThirdFlare One starts it. Both spellings count.
 * Paths come from the static allow-list, never from user input.
 */
export function warpProcessPattern(requestedPath, { realpath = realpathSync } = {}) {
  const paths = new Set([requestedPath]);
  try {
    const resolved = realpath(requestedPath);
    if (isAllowedWarpGuiResolvedPath(resolved)) paths.add(resolved);
  } catch {
    /* not installed on this host */
  }
  return `(${[...paths].map(ereEscape).join("|")})( .*)?`;
}

function pgrepCommandLine(path, env = process.env) {
  return runHostCommand("pgrep", ["-f", "-x", warpProcessPattern(path)], { env, timeout: 4000 });
}

function pkillCommandLine(path, env = process.env) {
  return runHostCommand("pkill", ["-f", "-x", warpProcessPattern(path)], { env, timeout: 4000 });
}

function pkillScript(scriptName) {
  return runHostCommand("pkill", ["-f", scriptName], { timeout: 4000 });
}

export function isWarpTaskbarRunning(env = process.env) {
  return pgrepCommandLine(WARP_TASKBAR_PATH, env);
}

export function isWarpDesktopSvcRunning(env = process.env) {
  return pgrepCommandLine(WARP_DESKTOP_SVC_PATH, env);
}

/**
 * Stop the Cloudflare desktop app.
 *
 * `keepService` stops only the tray icon and leaves warp-desktop-svc running.
 * Use it for a one-session swap: the two trays cannot share the tray icon, but
 * nothing about ThirdFlare's tray conflicts with WARP's background service, and
 * stopping it would outlive the swap the user asked for.
 */
export async function stopCloudflareGui({ env = process.env, manageUnit, keepService = false } = {}) {
  const taskbar = await pkillCommandLine(WARP_TASKBAR_PATH, env);
  if (keepService) {
    return { ok: true, taskbar, svc: false, unit: { skipped: true, reason: "keep-service" } };
  }
  let unit = { skipped: true };
  if (shouldManageUnit(env, manageUnit)) {
    const hostUnit = underFlatpak(env) || existsSync(WARP_DESKTOP_SVC_UNIT_PATH);
    const name = hostUnit ? WARP_DESKTOP_SVC_UNIT : MANAGED_WARP_DESKTOP_SVC_UNIT;
    unit = { ...(await runSystemctlUser(["stop", name], { env })), unit: name };
  }
  const svc = await pkillCommandLine(WARP_DESKTOP_SVC_PATH, env);
  return { ok: true, taskbar, svc, unit };
}

export async function stopThirdflareTrayProcesses() {
  const qt = await pkillScript("scripts/tray-qt.py");
  const sni = await pkillScript("scripts/tray-sni.py");
  const yad = await pkillScript("yad --notification.*thirdflare");
  return { ok: true, qt, sni, yad };
}

/**
 * warp-taskbar writes a `.sentry-native/` cache into its working directory.
 * Start it from the user's home, the way the WARP autostart entry does, so it
 * never litters the ThirdFlare install tree.
 */
function warpGuiWorkingDirectory(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  return existsSync(home) ? home : undefined;
}

export async function startCloudflareGui({ env = process.env, manageUnit } = {}) {
  const taskbar = warpGuiSpawnCommand(WARP_TASKBAR_PATH, { env });
  if (!taskbar) {
    return { ok: false, reason: "missing-taskbar" };
  }

  let unit = { skipped: true, reason: "disabled" };
  if (shouldManageUnit(env, manageUnit)) {
    unit = await syncWarpDesktopSvcUnit({ enable: true, env });
    if (unit.skipped || unit.ok === false) {
      const svc = warpGuiSpawnCommand(WARP_DESKTOP_SVC_PATH, { env });
      if (svc && !(await isWarpDesktopSvcRunning(env))) {
        const child = spawn(svc.command, svc.args, {
          env,
          cwd: warpGuiWorkingDirectory(env),
          detached: true,
          stdio: "ignore"
        });
        child.unref();
        unit = { ...unit, spawned: true };
      }
    }
  }

  if (await isWarpTaskbarRunning(env)) {
    return { ok: true, alreadyRunning: true, path: taskbar.path, unit };
  }

  const child = spawn(taskbar.command, taskbar.args, {
    env,
    cwd: warpGuiWorkingDirectory(env),
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { ok: true, pid: child.pid, path: taskbar.path, unit };
}

function startThirdflareTray({ env = process.env, appRoot } = {}) {
  const root = appRoot || resolveAppRoot(env);
  const exec = resolveTrayExec(env, root);
  const child = spawn(exec, ["--force-thirdflare"], {
    env: { ...env, THIRDFLARE_WEBUI: "1" },
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { ok: true, pid: child.pid, exec };
}

export async function swapRunningShell({ active, env = process.env, appRoot, manageUnit } = {}) {
  if (active === "cloudflare") {
    await stopThirdflareTrayProcesses();
    return startCloudflareGui({ env, manageUnit });
  }
  await stopCloudflareGui({ env, manageUnit });
  return startThirdflareTray({ env, appRoot });
}

/**
 * Persist-time apply: autostart files always; live process swap when a
 * graphical session is present and not disabled for tests.
 */
export async function applyTrayShell({
  shell,
  autostart,
  env = process.env,
  appRoot,
  manageUnit,
  live,
  detect
} = {}) {
  const sync = await syncTrayShell({
    shell,
    autostart,
    env,
    appRoot,
    manageUnit,
    detect
  });

  // syncTrayShell returns no `active` when it skipped (non-Linux), and
  // swapRunningShell would then take the thirdflare branch and pkill/spawn on a
  // platform this feature does not target.
  if (sync.skipped) {
    return { sync, liveSwap: { attempted: false, reason: sync.reason || "skipped" } };
  }

  if (!shouldLiveSwap(env, live)) {
    return {
      sync,
      liveSwap: {
        attempted: false,
        reason: graphicalSessionAvailable(env) ? "disabled" : "no-display"
      }
    };
  }

  return {
    sync,
    liveSwap: {
      attempted: true,
      ...(await swapRunningShell({
        active: sync.active,
        env,
        appRoot,
        manageUnit
      }))
    }
  };
}
