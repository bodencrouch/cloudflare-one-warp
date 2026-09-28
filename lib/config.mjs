import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const APP_ID = "thirdflare";
export const APP_DISPLAY_NAME = "ThirdFlare One";

const DEFAULTS = {
  server: {
    port: 4173,
    bind: "127.0.0.1"
  },
  webui: {
    enabled: false,
    allowRemote: false
  },
  warp: {
    cli: "warp-cli",
    killSwitch: false,
    killSwitchAllowLan: false
  },
  ui: {
    openBrowser: true,
    theme: "system",
    locale: "en",
    notifications: true
  },
  updates: {
    channel: "stable",
    source: {
      owner: "bodencrouch",
      repo: "thirdflare-one"
    },
    checkOnStartup: true
  },
  tray: {
    autostart: false,
    shell: "cloudflare"
  }
};

const sessionOverrides = {};

function readJsonFile(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Map renamed GitHub org in persisted user config. */
function normalizeLegacyConfig(config) {
  if (!isPlainObject(config)) return config;
  const owner = config.updates?.source?.owner;
  if (owner === "bodencrouch") {
    return deepMerge(config, { updates: { source: { owner: "bodencrouch" } } });
  }
  return config;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, ...layers) {
  const out = structuredClone(base);
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (isPlainObject(value) && isPlainObject(out[key])) {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

function envOverrides(env) {
  const out = {};
  const port = Number(env.THIRDFLARE_PORT || env.CLOUDFLARE_ONE_GUI_PORT || env.PORT);
  if (Number.isFinite(port) && port > 0) {
    out.server = { ...(out.server || {}), port };
  }

  const bind = env.THIRDFLARE_BIND || env.CLOUDFLARE_ONE_GUI_BIND;
  if (bind) {
    out.server = { ...(out.server || {}), bind };
  }

  const warpCli = env.THIRDFLARE_WARP_CLI || env.WARP_CLI;
  if (warpCli) {
    out.warp = { ...(out.warp || {}), cli: warpCli };
  }

  if (env.THIRDFLARE_WEBUI === "1" || env.THIRDFLARE_WEBUI === "true") {
    out.webui = { ...(out.webui || {}), enabled: true };
  }
  if (env.THIRDFLARE_WEBUI === "0" || env.THIRDFLARE_WEBUI === "false") {
    out.webui = { ...(out.webui || {}), enabled: false };
  }
  if (env.THIRDFLARE_WEBUI_ALLOW_REMOTE === "1" || env.THIRDFLARE_WEBUI_ALLOW_REMOTE === "true") {
    out.webui = { ...(out.webui || {}), allowRemote: true };
  }

  if (env.THIRDFLARE_LOCALE) {
    out.ui = { ...(out.ui || {}), locale: env.THIRDFLARE_LOCALE };
  }

  if (env.THIRDFLARE_NOTIFICATIONS === "0" || env.THIRDFLARE_NOTIFICATIONS === "false") {
    out.ui = { ...(out.ui || {}), notifications: false };
  }
  if (env.THIRDFLARE_NOTIFICATIONS === "1" || env.THIRDFLARE_NOTIFICATIONS === "true") {
    out.ui = { ...(out.ui || {}), notifications: true };
  }

  const channel = env.THIRDFLARE_UPDATE_CHANNEL;
  if (channel === "stable" || channel === "beta") {
    out.updates = { ...(out.updates || {}), channel };
  }

  const source = env.THIRDFLARE_UPDATE_SOURCE;
  if (source && source.includes("/")) {
    const [owner, repo] = source.split("/", 2);
    if (owner && repo) {
      out.updates = {
        ...(out.updates || {}),
        source: { owner, repo }
      };
    }
  }

  if (env.THIRDFLARE_UPDATE_CHECK === "0" || env.THIRDFLARE_UPDATE_CHECK === "false") {
    out.updates = { ...(out.updates || {}), checkOnStartup: false };
  }

  return out;
}

export function configPaths(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  return {
    system: "/etc/thirdflare/config.json",
    user: join(home, ".config", "thirdflare", "config.json"),
    legacyUser: join(home, ".config", "cloudflare-one-gui", "config.json")
  };
}

function normalizeTrayConfig(config) {
  if (!isPlainObject(config) || !isPlainObject(config.tray)) return config;
  const shell = config.tray.shell;
  if (shell === "cloudflare" || shell === "thirdflare") return config;
  return deepMerge(config, { tray: { shell: "cloudflare" } });
}

export function loadConfig(env = process.env) {
  const paths = configPaths(env);
  return normalizeTrayConfig(normalizeLegacyConfig(deepMerge(
    DEFAULTS,
    readJsonFile(paths.system),
    // Legacy path loads before the new user file so ~/.config/thirdflare wins.
    readJsonFile(paths.legacyUser),
    readJsonFile(paths.user),
    envOverrides(env),
    sessionOverrides
  )));
}

/**
 * Update source from file/env layers only (ignores session).
 * Used as the fork-graph root so session cannot invent an unrelated upstream.
 */
export function getPinnedUpdateSource(env = process.env) {
  const paths = configPaths(env);
  const pinned = normalizeLegacyConfig(deepMerge(
    DEFAULTS,
    readJsonFile(paths.system),
    readJsonFile(paths.legacyUser),
    readJsonFile(paths.user),
    envOverrides(env)
  ));
  return {
    owner: pinned.updates?.source?.owner || "bodencrouch",
    repo: pinned.updates?.source?.repo || "thirdflare-one"
  };
}

/**
 * Keys allowed via POST /api/config/session.
 * Never warp.cli / server.
 * updates.source is set only via POST /api/update/source (fork-graph validated).
 */
const SESSION_ALLOWLIST = {
  ui: new Set(["locale", "theme", "openBrowser", "notifications"]),
  updates: new Set(["channel", "checkOnStartup", "source"])
  // webui.* and server.* require restart — persist via dedicated POST endpoints.
  // warp.killSwitch* is session-set only via POST /api/killswitch after nft apply succeeds.
};

function sanitizeSessionPartial(partial) {
  if (!isPlainObject(partial)) return {};
  const out = {};
  for (const [section, keys] of Object.entries(SESSION_ALLOWLIST)) {
    if (!isPlainObject(partial[section])) continue;
    const sectionOut = {};
    for (const [key, value] of Object.entries(partial[section])) {
      if (!keys.has(key)) continue;
      if (key === "source") {
        // Source must be applied through setSessionUpdateSource (validated).
        continue;
      }
      if (key === "channel" && value !== "stable" && value !== "beta") continue;
      if (key === "locale" && (typeof value !== "string" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(value))) continue;
      if ((key === "notifications" || key === "openBrowser" || key === "checkOnStartup") && typeof value !== "boolean") continue;
      sectionOut[key] = value;
    }
    if (Object.keys(sectionOut).length) out[section] = sectionOut;
  }
  return out;
}

/**
 * Set session updates.source after caller validates against the fork graph.
 */
export function setSessionUpdateSource(source) {
  if (!isPlainObject(source)) return getConfig();
  const owner = String(source.owner || "");
  const repo = String(source.repo || "");
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return getConfig();
  }
  const prev = sessionOverrides.updates && isPlainObject(sessionOverrides.updates)
    ? { ...sessionOverrides.updates }
    : {};
  sessionOverrides.updates = { ...prev, source: { owner, repo } };
  cached = loadConfig();
  return cached;
}

/**
 * Session kill-switch desired state — only from POST /api/killswitch after nft apply.
 * Not allowed via generic /api/config/session (would imply protection without rules).
 */
export function setSessionKillSwitch({ enabled, allowLan } = {}) {
  if (typeof enabled !== "boolean") return getConfig();
  const prev = sessionOverrides.warp && isPlainObject(sessionOverrides.warp)
    ? { ...sessionOverrides.warp }
    : {};
  sessionOverrides.warp = {
    ...prev,
    killSwitch: enabled,
    killSwitchAllowLan: typeof allowLan === "boolean" ? allowLan : Boolean(prev.killSwitchAllowLan)
  };
  cached = loadConfig();
  return cached;
}

/**
 * Persist kill-switch desired state to the user config file so it survives restart.
 * Only call after a successful nft apply. Merges into ~/.config/thirdflare/config.json
 * without clobbering unrelated keys.
 *
 * @param {{ enabled: boolean, allowLan?: boolean }} options
 * @param {{ userPath?: string, env?: NodeJS.ProcessEnv }} [io]
 */
export function persistUserKillSwitch({ enabled, allowLan } = {}, io = {}) {
  if (typeof enabled !== "boolean") return getConfig();
  const lan = typeof allowLan === "boolean" ? allowLan : false;
  const env = io.env || process.env;
  const userPath = io.userPath || configPaths(env).user;
  const existing = readJsonFile(userPath);
  const next = deepMerge(existing, {
    warp: {
      killSwitch: enabled,
      killSwitchAllowLan: lan
    }
  });
  mkdirSync(dirname(userPath), { recursive: true, mode: 0o700 });
  writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  // Drop session warp mirror so the file layer is authoritative after reload.
  if (sessionOverrides.warp) {
    delete sessionOverrides.warp.killSwitch;
    delete sessionOverrides.warp.killSwitchAllowLan;
    if (!Object.keys(sessionOverrides.warp).length) delete sessionOverrides.warp;
  }
  cached = loadConfig(env);
  return cached;
}

/**
 * Persist tray autostart preference to the user config file.
 * Merges into ~/.config/thirdflare/config.json without clobbering unrelated keys.
 *
 * @param {{ autostart: boolean }} options
 * @param {{ userPath?: string, env?: NodeJS.ProcessEnv }} [io]
 */
export function persistUserTrayAutostart({ autostart } = {}, io = {}) {
  if (typeof autostart !== "boolean") return getConfig();
  const env = io.env || process.env;
  const userPath = io.userPath || configPaths(env).user;
  const existing = readJsonFile(userPath);
  const next = deepMerge(existing, {
    tray: { autostart }
  });
  mkdirSync(dirname(userPath), { recursive: true, mode: 0o700 });
  writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  if (sessionOverrides.tray) {
    delete sessionOverrides.tray.autostart;
    if (!Object.keys(sessionOverrides.tray).length) delete sessionOverrides.tray;
  }
  cached = loadConfig(env);
  return cached;
}

/**
 * Persist desktop-shell preference (`cloudflare` | `thirdflare`) to the user config file.
 * `tray.autostart` is a remembered preference, not an instruction: syncTrayShell
 * only writes the ThirdFlare autostart entry while ThirdFlare is the active
 * shell, so the two can never fight at login and the preference survives a trip
 * through Cloudflare One Client and back. Not session-settable.
 *
 * @param {{ shell: string, autostart?: boolean }} options
 * @param {{ userPath?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {object | null} next config, or null when shell is invalid
 */
export function persistUserTrayShell({ shell, autostart } = {}, io = {}) {
  if (shell !== "cloudflare" && shell !== "thirdflare") return null;
  const env = io.env || process.env;
  const userPath = io.userPath || configPaths(env).user;
  const existing = readJsonFile(userPath);
  const tray = { shell };
  if (typeof autostart === "boolean") {
    tray.autostart = autostart;
  }
  const next = deepMerge(existing, { tray });
  mkdirSync(dirname(userPath), { recursive: true, mode: 0o700 });
  writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  if (sessionOverrides.tray) {
    delete sessionOverrides.tray.shell;
    delete sessionOverrides.tray.autostart;
    if (!Object.keys(sessionOverrides.tray).length) delete sessionOverrides.tray;
  }
  cached = loadConfig(env);
  return cached;
}

function writeUserConfigPatch(patch, io = {}) {
  const env = io.env || process.env;
  const userPath = io.userPath || configPaths(env).user;
  const existing = readJsonFile(userPath);
  const next = deepMerge(existing, patch);
  mkdirSync(dirname(userPath), { recursive: true, mode: 0o700 });
  writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  cached = loadConfig(env);
  return cached;
}

/**
 * Persist Web UI enablement to the user config file (restart required to apply).
 *
 * @param {{ enabled?: boolean, allowRemote?: boolean }} options
 * @param {{ userPath?: string, env?: NodeJS.ProcessEnv }} [io]
 */
export function persistUserWebUi({ enabled, allowRemote } = {}, io = {}) {
  const patch = { webui: {} };
  if (typeof enabled === "boolean") patch.webui.enabled = enabled;
  if (typeof allowRemote === "boolean") patch.webui.allowRemote = allowRemote;
  if (!Object.keys(patch.webui).length) return getConfig();
  return writeUserConfigPatch(patch, io);
}

/**
 * Persist server listen settings (restart required to apply).
 *
 * @param {{ port?: number, bind?: string }} options
 * @param {{ userPath?: string, env?: NodeJS.ProcessEnv }} [io]
 */
export function persistUserServer({ port, bind } = {}, io = {}) {
  const patch = { server: {} };
  if (typeof port === "number" && Number.isFinite(port)) patch.server.port = port;
  if (typeof bind === "string" && bind.trim()) patch.server.bind = bind.trim();
  if (!Object.keys(patch.server).length) return getConfig();
  return writeUserConfigPatch(patch, io);
}

/**
 * Persist UI preferences to the user config file.
 *
 * @param {{ notifications?: boolean }} options
 * @param {{ userPath?: string, env?: NodeJS.ProcessEnv }} [io]
 */
export function persistUserUi({ notifications } = {}, io = {}) {
  const patch = { ui: {} };
  if (typeof notifications === "boolean") patch.ui.notifications = notifications;
  if (!Object.keys(patch.ui).length) return getConfig();
  const cfg = writeUserConfigPatch(patch, io);
  if (typeof notifications === "boolean" && sessionOverrides.ui) {
    delete sessionOverrides.ui.notifications;
    if (!Object.keys(sessionOverrides.ui).length) delete sessionOverrides.ui;
  }
  return cfg;
}

/** Valid daemon HTTP port for user config. */
export function isValidServerPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export function setSessionOverrides(partial) {
  if (!isPlainObject(partial)) return getConfig();
  const safe = sanitizeSessionPartial(partial);
  const merged = deepMerge(sessionOverrides, safe);
  for (const key of Object.keys(sessionOverrides)) {
    delete sessionOverrides[key];
  }
  Object.assign(sessionOverrides, merged);
  cached = loadConfig();
  return cached;
}

export function clearSessionOverrides() {
  for (const key of Object.keys(sessionOverrides)) {
    delete sessionOverrides[key];
  }
  cached = loadConfig();
  return cached;
}

let cached = loadConfig();

export function getConfig() {
  return cached;
}

export function reloadConfig(env = process.env) {
  cached = loadConfig(env);
  return cached;
}

export function effectiveBind(config = getConfig()) {
  if (config.webui?.enabled && config.webui?.allowRemote) {
    return "0.0.0.0";
  }
  return config.server?.bind || "127.0.0.1";
}

export function describeConfigSources(env = process.env) {
  const paths = configPaths(env);
  return {
    defaults: true,
    systemFile: existsSync(paths.system),
    userFile: existsSync(paths.user),
    legacyUserFile: existsSync(paths.legacyUser),
    environment: true,
    session: Object.keys(sessionOverrides).length > 0
  };
}
