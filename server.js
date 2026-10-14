import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { runBoundedChild, stopBoundedChildren } from "./lib/http/bounded-child.mjs";
import { cleanupWebuiHandoffs } from "./scripts/webui-handoff.mjs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_DISPLAY_NAME,
  APP_ID,
  clearSessionOverrides,
  describeConfigSources,
  effectiveBind,
  getConfig,
  getPinnedUpdateSource,
  reloadConfig,
  setSessionOverrides,
  setSessionUpdateSource,
  setSessionKillSwitch,
  persistUserKillSwitch,
  persistUserTrayAutostart,
  persistUserTrayShell,
  persistUserWebUi,
  persistUserServer,
  persistUserUi,
  isValidServerPort,
  isValidServerBind
} from "./lib/config.mjs";
import {
  API_SECURITY_HEADERS,
  createSessionToken,
  evaluateRequest,
  removeSessionToken,
  SESSION_HEADER,
  SESSION_ROUTE,
  WEB_SECURITY_HEADERS
} from "./lib/http/request-gate.mjs";
import { syncTrayAutostart } from "./lib/tray/autostart.mjs";
import {
  applyTrayShell,
  decorateTrayConfig,
  describeTrayShell,
  isValidTrayShell,
  shouldWatchStatusNotifications,
  syncTrayShell
} from "./lib/tray/shell.mjs";
import { getVersion, getVersionInfo } from "./lib/version.mjs";
import { API_REVISION } from "./lib/api-revision.mjs";
import { applyUpdate, checkForUpdate, prepareApply } from "./lib/update/index.mjs";
import { listForks, listReleases } from "./lib/update/github.mjs";
import { detectInstallFormat } from "./lib/update/detect-format.mjs";
import { isSafeGithubRef } from "./lib/update/detect-format.mjs";
import { parseStatus } from "./lib/warp/status.mjs";
import { createStatusListener } from "./lib/warp/status-listener.mjs";
import { enrichSettings, parseSettings } from "./lib/warp/settings.mjs";
import { enrichSplitTunnel } from "./lib/warp/split-tunnel.mjs";
import { createProxyLauncher, listDesktopApps } from "./lib/apps/proxy-launcher.mjs";
import {
  deactivateCloudflareOneWarpNmProfiles,
  slugForWarpSettings,
  syncKdeProxy,
  syncNmForWarpState
} from "./lib/networkmanager/sync.mjs";
import {
  accessPortalUrl,
  isConsumerAccount,
  isZeroTrustAccount,
  parseRegistrationDevices,
  parseRegistrationOrganization,
  parseRegistrationShow
} from "./lib/warp/registration.mjs";
import {
  applyKillSwitch,
  probeKillSwitchActive,
  beginEnrollmentPause,
  endEnrollmentPause,
  cancelEnrollmentPause,
  getEnrollmentPauseState,
  ENROLLMENT_PAUSE_ACTIONS
} from "./lib/killswitch/index.mjs";
import { startStatusWatcher } from "./lib/notify/status-watcher.mjs";
import {
  appendFromRunWarp,
  getCommandLogCapacity,
  listEntries,
  redactWarpArgs
} from "./lib/warp/command-log.mjs";
import { assessReadiness, formatDiagnosticsClipboard } from "./lib/readiness/index.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const config = reloadConfig();
const port = Number(config.server?.port || 4173);
const listenHost = effectiveBind(config);
let session = null;

function publicConfig(cfg = getConfig()) {
  return decorateTrayConfig(cfg);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

/** Serialize desktop synchronization using the latest WARP state, not stale action intent. */
let networkSyncChain = Promise.resolve();
let networkSyncRunning = false;
let networkSyncRequested = false;
const NETWORK_SYNC_ACTIONS = new Set([
  "connect", "disconnect", "setMode", "setProtocol", "setMasqueOptions", "enableLocalProxy", "setProxyPort", "runCustom", "reconcileDesktop"
]);
function afterWarpNetworkSync(action) {
  if (process.platform !== "linux" || !NETWORK_SYNC_ACTIONS.has(action)) return Promise.resolve();
  const synchronize = async () => {
    const [statusResult, settingsResult] = await Promise.all([
      runWarp(["status"]), runWarp(["settings", "list"])
    ]);
    if (!statusResult.ok || !settingsResult.ok) return;
    const snap = {
      status: parseStatus(statusResult.stdout),
      settings: enrichSettings(parseSettings(settingsResult.stdout))
    };
    await syncNmForWarpState(snap);
    const settings = snap.settings;
    const slug = slugForWarpSettings({
      mode: settings.Mode,
      protocol: settings["Preferred protocol"] ?? settings["Tunnel protocol"] ?? settings.Protocol ?? settings.protocol
    });
    const proxyPort = Number(settings["Proxy port"] || 40000);
    await syncKdeProxy({
      enabled: Boolean(snap.status.connected) && slug === "proxy",
      port: proxyPort,
      appRoot: root
    });
  };
  networkSyncRequested = true;
  if (networkSyncRunning) return networkSyncChain;
  networkSyncRunning = true;
  networkSyncChain = (async () => {
    do {
      networkSyncRequested = false;
      try { await synchronize(); }
      catch (error) { console.warn(`Desktop network synchronization failed: ${error.message}`); }
    } while (networkSyncRequested);
  })().finally(() => { networkSyncRunning = false; });
  return networkSyncChain;
}

const COMMANDS = {
  status: ["status"],
  settings: ["settings", "list"],
  registration: ["registration", "show"],
  organization: ["registration", "organization"],
  devices: ["registration", "devices"],
  stats: ["stats"],
  tunnelStats: ["tunnel", "stats"],
  dnsStats: ["dns", "stats"],
  dnsFallback: ["dns", "fallback", "list"],
  dnsDefaultFallbacks: ["dns", "default-fallbacks"],
  splitTunnelDump: ["tunnel", "dump"],
  splitTunnelIps: ["tunnel", "ip", "list"],
  splitTunnelHosts: ["tunnel", "host", "list"],
  targets: ["target", "list"],
  vnet: ["vnet"],
  mdm: ["mdm", "get-configs"],
  supportUrl: ["settings", "support-url"],
  modeSwitchAllowed: ["settings", "mode-switch-allowed"],
  override: ["override", "show"],
  localNetworkOverride: ["override", "local-network", "show"],
  trustedSsids: ["trusted", "ssid", "list"],
  posture: ["debug", "posture"],
  network: ["debug", "network"],
  alternateNetwork: ["debug", "alternate-network"],
  dex: ["debug", "dex"],
  certs: ["certs"]
};

const ACTIONS = {
  connect: ["connect"],
  disconnect: ["disconnect"],
  register: ["--accept-tos", "registration", "new"],
  deleteRegistration: ["registration", "delete"],
  resetSettings: ["settings", "reset"],
  rotateKeys: ["tunnel", "rotate-keys"],
  resetProtocol: ["tunnel", "protocol", "reset"],
  resetSplitIps: ["tunnel", "ip", "reset"],
  resetSplitHosts: ["tunnel", "host", "reset"],
  dnsLogEnable: ["dns", "log", "enable"],
  dnsLogDisable: ["dns", "log", "disable"],
  accessReauth: ["debug", "access-reauth"],
  resetGatewayId: ["dns", "gateway-id", "reset"],
  resetEndpoint: ["tunnel", "endpoint", "reset"],
  resetMasqueOptions: ["tunnel", "masque-options", "reset"],
  environmentNormal: ["environment", "set", "Normal"],
  environmentFedramp: ["environment", "set", "FedRAMP-High"],
  environmentReset: ["environment", "reset"],
  trustedWifiEnable: ["trusted", "wifi", "enable"],
  trustedWifiDisable: ["trusted", "wifi", "disable"],
  trustedEthernetEnable: ["trusted", "ethernet", "enable"],
  trustedEthernetDisable: ["trusted", "ethernet", "disable"],
  resetTrustedSsids: ["trusted", "ssid", "reset"],
  allowLocalNetwork: ["override", "local-network", "allow"],
  stopLocalNetworkOverride: ["override", "local-network", "stop"]
};

const MODES = new Set(["warp", "doh", "warp+doh", "dot", "warp+dot", "proxy", "tunnel_only"]);
const PROTOCOLS = new Set(["MASQUE", "WireGuard"]);
const FAMILIES = new Set(["full", "malware", "off"]);
const MASQUE_OPTIONS = new Set(["h3-only", "h2-only", "h3-with-h2-fallback"]);
const TEAM_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const LICENSE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{6,64}$/;
const WARP_TOKEN_RE = /^(com\.cloudflare\.warp:\/\/\S+|https:\/\/[a-z0-9.-]+\.cloudflareaccess\.com\/\S+)$/i;

function warpCliCommand() {
  return getConfig().warp?.cli || process.env.WARP_CLI || "warp-cli";
}

function spawnWarpCli(warpArgs, options = {}) {
  const cmd = warpCliCommand();
  if (process.env.FLATPAK_ID && cmd === "warp-cli") {
    return spawn("flatpak-spawn", ["--host", "--", "warp-cli", ...warpArgs], options);
  }
  // Portable Node mock / script: WARP_CLI ending in .mjs/.cjs/.js runs via node (Win/macOS/Linux).
  if (/\.(mjs|cjs|js)$/i.test(String(cmd))) {
    return spawn(process.execPath, [cmd, ...warpArgs], options);
  }
  return spawn(cmd, warpArgs, options);
}

/** @type {ReturnType<typeof startStatusWatcher> | null} */
let notifyWatcher = null;
/** @type {boolean | null} */
let notifyWatcherEnabled = null;

function activeTrayShell() {
  const active = getConfig();
  return describeTrayShell({
    shell: active.tray?.shell,
    autostart: active.tray?.autostart
  }).active;
}

// Status events also originate outside this app (official client, CLI, reconnects).
// Coalesce bursts and inspect the current state rather than trusting event text.
let desktopSyncTimer = null;
function scheduleDesktopNetworkSync() {
  if (process.platform !== "linux" || desktopSyncTimer) return;
  desktopSyncTimer = setTimeout(() => {
    desktopSyncTimer = null;
    void afterWarpNetworkSync("reconcileDesktop");
  }, 200);
  desktopSyncTimer.unref();
}

/**
 * Start, stop, or leave the notification watcher alone to match current config.
 *
 * Cloudflare One Client posts its own status notifications, so ours stay off
 * while it is the active desktop app. Switching shells or toggling
 * ui.notifications has to take effect without a daemon restart.
 */
function reconcileStatusWatcher() {
  const enabled = shouldWatchStatusNotifications({
    notifications: getConfig().ui?.notifications !== false,
    active: activeTrayShell()
  });
  if (notifyWatcherEnabled === enabled) return notifyWatcher;
  notifyWatcher?.stop();
  notifyWatcherEnabled = enabled;
  notifyWatcher = startStatusWatcher({
    statusListener: getStatusListener(),
    enabled,
    env: process.env
  });
  return notifyWatcher;
}

/** @type {ReturnType<typeof createStatusListener> | null} */
let statusListener = null;

function getStatusListener() {
  if (!statusListener) {
    statusListener = createStatusListener({
      spawnWarpCli,
      redactLine: (line) => redactWarpOutput(line)
    });
  }
  return statusListener;
}

function runWarp(args, options = {}) {
  const finalArgs = ["--no-ansi", "--no-paginate", ...args];
  const safeArgs = redactWarpArgs(finalArgs);
  const secrets = finalArgs.flatMap((value, index) => {
    if (safeArgs[index] === value) return [];
    const secret = String(value);
    const values = [secret];
    if (/^--[^=]+=/.test(secret)) values.push(secret.slice(secret.indexOf("=") + 1));
    if (/^https?:|^com\.cloudflare\.warp:/i.test(secret)) {
      try {
        const url = new URL(secret);
        for (const [name, value] of url.searchParams) {
          if (/token|secret|key/i.test(name) && value) values.push(value);
        }
      } catch { /* the full opaque value is still redacted */ }
    }
    return values.filter(Boolean);
  });
  const scrub = (text) => secrets.reduce((value, secret) => value.split(secret).join("[redacted]"), String(text || ""));
  const command = `warp-cli ${safeArgs.join(" ")}`;
  const startedAt = Date.now();
  return runBoundedChild(() => spawnWarpCli(finalArgs, {
    stdio: ["ignore", "pipe", "pipe"]
  }), { timeout: options.timeout || 15000 }).then((execution) => {
    const result = {
      ...execution,
      command,
      stdout: scrub(execution.stdout.trim()),
      stderr: scrub(execution.stderr.trim()),
      durationMs: Date.now() - startedAt
    };
    appendFromRunWarp(redactCommand(result), { source: options.source || "warp" });
    return result;
  });
}

function parseKeyValueLines(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (match) values[match[1].trim()] = match[2].trim();
  }
  return values;
}

function parseTunnelStats(text) {
  const values = parseKeyValueLines(text);
  const traffic = text.match(/Sent:\s*([^;]+);\s*Received:\s*([^\n]+)/i);

  return {
    protocol: values["Tunnel Protocol"] || null,
    endpoints: values.Endpoints || null,
    handshakeAge: values["Time since last handshake"] || null,
    sent: traffic?.[1]?.trim() || null,
    received: traffic?.[2]?.trim() || null,
    latency: values["Estimated latency"] || null,
    loss: values["Estimated loss"] || null,
    colo: values.Colo || null,
    tlsVersion: values.Version || null,
    postQuantum: values["Post-Quantum enabled"] || null
  };
}

function parseDnsStats(text) {
  const values = parseKeyValueLines(text);
  return {
    queries: values.Queries || null,
    averageDuration: values["Average Duration"] || null,
    success: values.Success || null,
    timedOut: values["Timed Out"] || null,
    noRecords: values["No Records Found"] || null,
    otherError: values["Other Error"] || null
  };
}

function redactWarpOutput(text) {
  if (text == null) return text;
  return String(text)
    .replace(/(^|\n)(ID:\s+).+/gi, "$1$2[redacted]")
    .replace(/(Device ID:\s+).+/gi, "$1[redacted]")
    .replace(/(Public key:\s+).+/gi, "$1[redacted]")
    .replace(/(License:\s+).+/gi, "$1[redacted]")
    .replace(/(Account ID:\s+).+/gi, "$1[redacted]")
    .replace(/((?:Token|Secret|Authorization):\s+).+/gi, "$1[redacted]")
    // JSON from warp-cli --json (registration show/devices/organization)
    .replace(/("(?:id|device_id|public_key|license|account_id|token|secret|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"');
}

function redactCommand(result) {
  return {
    ...result,
    stdout: redactWarpOutput(result.stdout),
    stderr: redactWarpOutput(result.stderr)
  };
}

function parseWarpArgs(value) {
  if (typeof value !== "string" || value.length > 240) return null;
  if (/[;&|<>`$\\\n\r]/.test(value)) return null;

  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(value))) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  if (args[0] === "warp-cli") args.shift();
  return args.length ? args : null;
}

function daemonError(result) {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return combined.includes("unable to connect to the cloudflarewarp daemon")
    || combined.includes("maybe the daemon is not running")
    || combined.includes("operation not permitted");
}

async function buildReadiness(statusResult = null) {
  const active = getConfig();
  return assessReadiness({
    warpCliPath: warpCliCommand(),
    runStatus: async () => statusResult || runWarp(["status"]),
    probeKillSwitch: () => probeKillSwitchActive(),
    getEnrollmentPause: () => getEnrollmentPauseState(),
    killSwitchDesired: Boolean(active.warp?.killSwitch),
    killSwitchAllowLan: Boolean(active.warp?.killSwitchAllowLan)
  });
}

async function snapshot() {
  const entries = await Promise.all(
    Object.entries(COMMANDS).map(async ([key, args]) => [key, await runWarp(args)])
  );
  const commands = Object.fromEntries(entries.map(([key, result]) => [key, redactCommand(result)]));
  const status = parseStatus(commands.status.stdout || commands.status.stderr);
  const settings = enrichSettings(parseSettings(commands.settings.stdout), {
    localNetworkOverride: commands.localNetworkOverride.stdout
  });
  const daemon = {
    available: !daemonError(commands.status),
    message: daemonError(commands.status)
      ? (commands.status.stderr || commands.status.stdout)
      : "CloudflareWARP daemon responded."
  };
  const readiness = await buildReadiness(commands.status);

  return {
    generatedAt: new Date().toISOString(),
    daemon,
    status,
    readiness,
    settings,
    splitTunnel: enrichSplitTunnel({
      dump: commands.splitTunnelDump,
      ips: commands.splitTunnelIps,
      hosts: commands.splitTunnelHosts
    }),
    parsed: {
      tunnel: parseTunnelStats(commands.tunnelStats.stdout),
      dns: parseDnsStats(commands.dnsStats.stdout)
    },
    commands
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...API_SECURITY_HEADERS
  });
  res.end(payload);
}

function sse(res, event, data) {
  if (res.destroyed) return;
  if (res.writableLength > 256 * 1024) { res.destroy(); return; }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * Reject cross-site writes. There is no CSRF token, and every mutating route
 * reaches warp-cli, systemd, or the user's config — so a hostile page must not
 * be able to drive them just because the daemon listens on loopback.
 *
 * Three independent gates, any one of which is enough to stop a browser:
 *  - Sec-Fetch-Site: browsers always send it; only same-origin/none pass.
 *  - Origin: when present it must match the host we were reached on.
 *  - Content-Type: a cross-origin form can only send urlencoded/multipart/
 *    text-plain, so requiring JSON forces a preflight we never answer.
 *
 * Non-browser clients (curl, the tray CLI, tests) send none of these headers
 * and are unaffected.
 *
 * @returns {string | null} rejection reason, or null when the request may proceed
 */
function crossSiteRejection(req) {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && !SAFE_FETCH_SITES.has(site)) {
    return `cross-site request blocked (sec-fetch-site: ${site})`;
  }

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null") {
    const host = req.headers.host || `127.0.0.1:${port}`;
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      return "cross-site request blocked (malformed origin)";
    }
    if (originHost !== host) {
      return "cross-site request blocked (origin does not match host)";
    }
  }

  const contentType = req.headers["content-type"];
  if (typeof contentType === "string" && contentType.trim()) {
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (mime !== "application/json") {
      return `unsupported content-type: ${mime} (send application/json)`;
    }
  }

  return null;
}

async function readJson(req) {
  const limit = 64 * 1024;
  const bodyError = () => Object.assign(new Error("Request body exceeds the 64 KiB limit."), { status: 413 });
  if (Number(req.headers["content-length"]) > limit) {
    req.resume();
    throw bodyError();
  }
  const data = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onAborted = () => onError(Object.assign(new Error("Request aborted."), { status: 400 }));
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        req.resume();
        reject(bodyError());
      } else chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
  if (!data.length) return {};
  let parsed;
  try { parsed = JSON.parse(data.toString("utf8")); }
  catch { throw Object.assign(new Error("Malformed JSON request."), { status: 400 }); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Request body must be a JSON object."), { status: 400 });
  }
  return parsed;
}

// Mutating CLI workflows must execute as transactions: proxy setup and enrollment
// cannot be interleaved with a second client's mode/disconnect/registration action.
let actionQueue = Promise.resolve();
let pendingActions = 0;
async function serializeWarpAction(operation) {
  if (pendingActions >= 32) {
    throw Object.assign(new Error("Too many pending WARP actions. Try again shortly."), { status: 429 });
  }
  pendingActions++;
  const result = actionQueue.then(operation);
  actionQueue = result.catch(() => {});
  try { return await result; }
  finally { pendingActions--; }
}

function actionArgs(body) {
  const { action, value, secondary } = body || {};

  if (typeof action === "string" && Object.hasOwn(ACTIONS, action)) return ACTIONS[action];
  if (action === "registerOrganization") {
    const team = String(value || "").trim().toLowerCase();
    if (!TEAM_NAME_RE.test(team)) return null;
    return ["--accept-tos", "registration", "new", team];
  }
  if (action === "applyLicense") {
    const key = String(value || "").trim();
    if (!LICENSE_KEY_RE.test(key)) return null;
    return ["--accept-tos", "registration", "license", key];
  }
  if (action === "registrationToken") {
    const token = String(value || "").trim();
    if (token.length > 2048 || /[;&|<>`$\\\n\r]/.test(token) || !WARP_TOKEN_RE.test(token)) return null;
    return ["--accept-tos", "registration", "token", token];
  }
  if (action === "setMode" && MODES.has(value)) return ["mode", value];
  if (action === "setProtocol" && PROTOCOLS.has(value)) return ["tunnel", "protocol", "set", value];
  if (action === "setFamilies" && FAMILIES.has(value)) return ["dns", "families", value];
  if (action === "setMasqueOptions" && MASQUE_OPTIONS.has(value)) return ["tunnel", "masque-options", "set", value];
  if (action === "setProxyPort" && /^\d{1,5}$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535) return ["proxy", "port", String(value)];
  if (action === "setVnet" && value) return ["vnet", String(value)];
  if (action === "setGatewayId" && value) return ["dns", "gateway-id", "set", String(value)];
  if (action === "setEndpoint" && value) return ["tunnel", "endpoint", "set", String(value)];
  if (action === "overrideCode" && value) return ["override", String(value)];
  if (action === "overrideUnlock" && value) return ["override", "unlock", String(value)];
  if (action === "runCustom") return parseWarpArgs(value);
  if (action === "addDnsFallback" && value) return ["dns", "fallback", "add", String(value)];
  if (action === "removeDnsFallback" && value) return ["dns", "fallback", "remove", String(value)];
  if (action === "addSplitIp" && value) return ["tunnel", "ip", "add", String(value)];
  if (action === "removeSplitIp" && value) return ["tunnel", "ip", "remove", String(value)];
  if (action === "addSplitIpRange" && value) return ["tunnel", "ip", "add-range", String(value), String(secondary || value)];
  if (action === "removeSplitIpRange" && value) return ["tunnel", "ip", "remove-range", String(value), String(secondary || value)];
  if (action === "addSplitHost" && value) return ["tunnel", "host", "add", String(value)];
  if (action === "removeSplitHost" && value) return ["tunnel", "host", "remove", String(value)];
  if (action === "addTrustedSsid" && value) return ["trusted", "ssid", "add", String(value)];
  if (action === "removeTrustedSsid" && value) return ["trusted", "ssid", "remove", String(value)];

  return null;
}

/**
 * Structured account/enrollment state for the Account UI.
 * License is returned for consumer multi-device setup; public key stays redacted.
 */
async function accountDetails() {
  const [showResult, orgResult, devicesResult] = await Promise.all([
    runWarp(["--json", "registration", "show"]),
    runWarp(["--json", "registration", "organization"]),
    runWarp(["--json", "registration", "devices"])
  ]);

  const registration = parseRegistrationShow(
    showResult.ok ? showResult.stdout : ""
  );
  // Text fallback when --json is unsupported
  if (!registration.registered && !showResult.ok) {
    const textShow = await runWarp(["registration", "show"]);
    Object.assign(
      registration,
      parseRegistrationShow(textShow.ok ? textShow.stdout : "")
    );
  }

  const organization = parseRegistrationOrganization(
    orgResult.ok ? orgResult.stdout : ""
  );
  let devices = parseRegistrationDevices(
    devicesResult.ok ? devicesResult.stdout : ""
  );
  // devices is consumer-only; ignore failures for Zero Trust
  if (!devicesResult.ok && /only available|not supported|zero.?trust|organization/i.test(
    `${devicesResult.stderr}\n${devicesResult.stdout}`
  )) {
    devices = [];
  }

  const team = organization.organization;
  const consumer = isConsumerAccount(registration);
  const zeroTrust = isZeroTrustAccount(registration) || Boolean(team);

  return {
    generatedAt: new Date().toISOString(),
    registered: registration.registered,
    accountType: registration.accountType,
    accountId: registration.accountId,
    deviceId: registration.deviceId,
    license: consumer || registration.license ? registration.license : null,
    managed: registration.managed,
    organization: team,
    accessPortalUrl: accessPortalUrl(team),
    consumer,
    zeroTrust,
    devices,
    nextSteps: !registration.registered
      ? ["register_free", "enroll_zero_trust"]
      : consumer
        ? ["apply_license", "list_devices", "connect"]
        : ["complete_token", "connect"],
    commands: {
      registration: redactCommand(showResult),
      organization: redactCommand(orgResult),
      devices: redactCommand(devicesResult)
    }
  };
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === SESSION_ROUTE) {
      // The request gate authenticated the owner credential before this route.
      json(res, 200, { ok: true, session: session.token, header: SESSION_HEADER });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      const rejection = crossSiteRejection(req);
      if (rejection) {
        json(res, 403, { ok: false, error: rejection });
        return;
      }
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/health") {
      const active = getConfig();
      json(res, 200, {
        ok: true,
        app: APP_ID,
        name: APP_DISPLAY_NAME,
        version: getVersion(),
        apiRevision: API_REVISION,
        webuiEnabled: Boolean(active.webui?.enabled),
        effectivePort: port,
        generatedAt: new Date().toISOString()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/readiness") {
      const readiness = await buildReadiness();
      json(res, 200, { ok: true, ...readiness });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/diagnostics") {
      const readiness = await buildReadiness();
      const entries = listEntries();
      const logLines = entries.map((entry) => {
        const err = entry.ok ? "" : ` exit=${entry.code ?? "?"}`;
        return `${entry.ts || ""} ${entry.command || "warp-cli"}${err}`.trim();
      });
      const text = formatDiagnosticsClipboard({
        readiness,
        version: getVersion(),
        installFormat: detectInstallFormat(),
        logs: logLines
      });
      json(res, 200, { ok: true, text, readiness });
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/version") {
      // Public daemon probes reveal no configured account/source metadata.
      // A matching owner credential retains the richer API for existing clients.
      const authenticated = Boolean(session?.token) && req.headers[SESSION_HEADER] === session.token;
      json(res, 200, authenticated ? {
        ok: true,
        ...getVersionInfo(getConfig()),
        installFormat: detectInstallFormat(),
        apiRevision: API_REVISION
      } : { ok: true, version: getVersion(), apiRevision: API_REVISION });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/update/check") {
      const result = await checkForUpdate(getConfig());
      json(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/update/releases") {
      const active = getConfig();
      const owner = url.searchParams.get("owner") || active.updates?.source?.owner;
      const repo = url.searchParams.get("repo") || active.updates?.source?.repo;
      if (!isSafeGithubRef(owner) || !isSafeGithubRef(repo)) {
        json(res, 400, { ok: false, error: "Invalid owner/repo." });
        return;
      }
      const releases = await listReleases({ owner, repo });
      json(res, 200, { ok: true, source: { owner, repo }, releases });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/update/forks") {
      const pinned = getPinnedUpdateSource();
      const owner = pinned.owner;
      const repo = pinned.repo;
      if (!isSafeGithubRef(owner) || !isSafeGithubRef(repo)) {
        json(res, 400, { ok: false, error: "Invalid owner/repo." });
        return;
      }
      const forks = await listForks({ owner, repo });
      json(res, 200, {
        ok: true,
        upstream: { owner, repo },
        forks: [
          { owner, repo, fullName: `${owner}/${repo}`, stars: null, upstream: true },
          ...forks
        ]
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/update/source") {
      const body = await readJson(req);
      const owner = String(body?.owner || "").trim();
      const repo = String(body?.repo || "").trim();
      if (!isSafeGithubRef(owner) || !isSafeGithubRef(repo)) {
        json(res, 400, { ok: false, error: "Invalid owner/repo." });
        return;
      }
      const pinned = getPinnedUpdateSource();
      const forks = await listForks(pinned);
      const allowed = [
        { owner: pinned.owner, repo: pinned.repo },
        ...forks.map((f) => ({ owner: f.owner, repo: f.repo }))
      ];
      const ok = allowed.some((entry) => entry.owner === owner && entry.repo === repo);
      if (!ok) {
        json(res, 403, {
          ok: false,
          error: "Source must be the pinned upstream or one of its GitHub forks."
        });
        return;
      }
      setSessionUpdateSource({ owner, repo });
      json(res, 200, {
        ok: true,
        config: publicConfig(getConfig()),
        source: { owner, repo },
        sources: describeConfigSources()
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/update/prepare") {
      const body = await readJson(req);
      const result = await prepareApply(getConfig(), body, { bindHost: listenHost });
      json(res, result.ok === false ? 400 : 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/update/apply") {
      const body = await readJson(req);
      const result = await applyUpdate(getConfig(), body, { bindHost: listenHost });
      json(res, result.ok === false ? 400 : 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      const active = getConfig();
      json(res, 200, {
        ok: true,
        config: publicConfig(active),
        sources: describeConfigSources(),
        effective: {
          bind: listenHost,
          port
        },
        notes: {
          restartRequired: ["server.port", "server.bind", "webui.enabled", "webui.allowRemote"],
          sessionOnly: "POST /api/config/session overrides apply until the daemon restarts.",
          persistEndpoints: [
            "POST /api/config/webui",
            "POST /api/config/server",
            "POST /api/config/ui",
            "POST /api/config/tray-autostart",
            "POST /api/config/tray-shell"
          ]
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config/session") {
      const body = await readJson(req);
      if (body?.clear === true) {
        clearSessionOverrides();
      } else {
        setSessionOverrides(body?.config || body);
      }
      reconcileStatusWatcher();
      json(res, 200, {
        ok: true,
        config: publicConfig(getConfig()),
        sources: describeConfigSources()
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config/tray-autostart") {
      const body = await readJson(req);
      if (typeof body?.autostart !== "boolean") {
        json(res, 400, { ok: false, error: "autostart must be a boolean" });
        return;
      }
      const config = persistUserTrayAutostart({ autostart: body.autostart });
      const applied = await syncTrayShell({
        shell: config.tray?.shell,
        autostart: config.tray?.autostart
      });
      // `autostart` is remembered even when it changes nothing today: the entry
      // is only written while Cloudflare One WARP is the active desktop app. Say so
      // rather than reporting a bare ok for a no-op.
      const active = applied.active || activeTrayShell();
      json(res, 200, {
        ok: true,
        config: publicConfig(config),
        sync: applied.tray || applied,
        active,
        effective: active === "cloudflare-one-warp" && Boolean(config.tray?.autostart)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config/tray-shell") {
      const body = await readJson(req);
      if (!isValidTrayShell(body?.shell)) {
        json(res, 400, { ok: false, error: "shell must be cloudflare or cloudflare-one-warp" });
        return;
      }
      const config = persistUserTrayShell({ shell: body.shell });
      if (!config) {
        json(res, 400, { ok: false, error: "shell must be cloudflare or cloudflare-one-warp" });
        return;
      }
      const applied = await applyTrayShell({
        shell: config.tray?.shell,
        autostart: config.tray?.autostart
      });
      // Notification ownership follows the active shell, so re-evaluate now
      // instead of leaving it frozen at whatever it was when the daemon started.
      reconcileStatusWatcher();
      json(res, 200, {
        ok: true,
        config: publicConfig(config),
        sync: applied.sync,
        liveSwap: applied.liveSwap,
        notifications: { owner: notifyWatcherEnabled ? "cloudflare-one-warp" : "cloudflare" }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config/webui") {
      const body = await readJson(req);
      if (body?.enabled != null && typeof body.enabled !== "boolean") {
        json(res, 400, { ok: false, error: "enabled must be a boolean" });
        return;
      }
      if (body?.allowRemote != null && typeof body.allowRemote !== "boolean") {
        json(res, 400, { ok: false, error: "allowRemote must be a boolean" });
        return;
      }
      if (body?.allowRemote === true) {
        json(res, 400, { ok: false, error: "Remote control is not available. Use local access or an authenticated SSH tunnel." });
        return;
      }
      if (body?.enabled == null && body?.allowRemote == null) {
        json(res, 400, { ok: false, error: "Provide enabled and/or allowRemote" });
        return;
      }
      const config = persistUserWebUi({
        enabled: body.enabled,
        allowRemote: body.allowRemote
      });
      json(res, 200, {
        ok: true,
        config: publicConfig(config),
        restartRequired: true
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config/server") {
      const body = await readJson(req);
      if (body?.port != null) {
        const portNum = Number(body.port);
        if (!isValidServerPort(portNum)) {
          json(res, 400, { ok: false, error: "port must be an integer from 1024 to 65535" });
          return;
        }
      }
      if (body?.bind != null && (typeof body.bind !== "string" || !isValidServerBind(body.bind))) {
        json(res, 400, { ok: false, error: "bind must be 127.0.0.1, localhost, or ::1" });
        return;
      }
      if (body?.port == null && body?.bind == null) {
        json(res, 400, { ok: false, error: "Provide port and/or bind" });
        return;
      }
      const config = persistUserServer({
        port: body.port != null ? Number(body.port) : undefined,
        bind: body.bind
      });
      json(res, 200, {
        ok: true,
        config: publicConfig(config),
        restartRequired: true
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config/ui") {
      const body = await readJson(req);
      if (body?.notifications != null && typeof body.notifications !== "boolean") {
        json(res, 400, { ok: false, error: "notifications must be a boolean" });
        return;
      }
      if (body?.notifications == null) {
        json(res, 400, { ok: false, error: "Provide notifications" });
        return;
      }
      const config = persistUserUi({ notifications: body.notifications });
      reconcileStatusWatcher();
      json(res, 200, { ok: true, config: publicConfig(config) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
        ...API_SECURITY_HEADERS
      });
      sse(res, "ready", { ok: true, generatedAt: new Date().toISOString() });

      const heartbeat = setInterval(() => {
        sse(res, "heartbeat", { generatedAt: new Date().toISOString() });
      }, 25000);

      const unsub = getStatusListener().subscribe((payload) => {
        const eventName = payload.kind === "error" ? "error" : "warp";
        sse(res, eventName, {
          line: payload.line,
          status: payload.status,
          generatedAt: payload.generatedAt
        });
      });

      const cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };

      req.on("close", cleanup);
      res.on("close", cleanup);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      const sinceRaw = url.searchParams.get("since");
      const since = sinceRaw != null && sinceRaw !== "" ? Number(sinceRaw) : null;
      json(res, 200, {
        ok: true,
        entries: listEntries({ since: Number.isFinite(since) ? since : null }),
        capacity: getCommandLogCapacity()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/apps") {
      const apps = await listDesktopApps();
      json(res, 200, { ok: true, apps });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/apps/proxy-launcher") {
      const body = await readJson(req);
      const appId = String(body?.appId || body?.id || "").trim();
      if (!appId) {
        json(res, 400, { ok: false, error: "Body must include appId." });
        return;
      }
      const port = body?.port != null ? Number(body.port) : 40000;
      const result = await createProxyLauncher({ appId, port });
      json(res, result.ok ? 200 : 404, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      json(res, 200, await snapshot());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/killswitch") {
      const desired = Boolean(getConfig().warp?.killSwitch);
      const allowLan = Boolean(getConfig().warp?.killSwitchAllowLan);
      const probe = await probeKillSwitchActive();
      const enroll = getEnrollmentPauseState();
      json(res, 200, {
        ok: !probe.probeError,
        desired,
        allowLan,
        active: probe.active,
        probeError: Boolean(probe.probeError),
        enrollmentPause: enroll,
        detail: enroll.restorationPending
          ? `Kill switch restoration is pending: ${enroll.error || "retrying protection"}`
          : enroll.paused
            ? "Kill switch paused for Zero Trust enrollment."
            : probe.detail,
        interface: "CloudflareWARP",
        note: "Native nftables kill switch — blocks outbound traffic except loopback, the WARP tunnel, and Cloudflare bootstrap IPs."
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/killswitch/enrollment-pause") {
      const body = await readJson(req);
      const mode = body.mode;
      if (mode !== "begin" && mode !== "end") {
        json(res, 400, { ok: false, error: "mode must be begin or end." });
        return;
      }
      if (mode === "begin") {
        const result = await beginEnrollmentPause();
        json(res, result.ok ? 200 : 502, result);
        return;
      }
      const result = await endEnrollmentPause({ reason: "api" });
      json(res, result.ok ? 200 : 502, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/killswitch") {
      const body = await readJson(req);
      if (typeof body?.enabled !== "boolean") {
        json(res, 400, { ok: false, error: "Body must include boolean enabled." });
        return;
      }
      let allowLan;
      // Apply nft first — only commit session desired after a successful apply.
      const result = await applyKillSwitch({
        resolve: () => {
          allowLan = typeof body.allowLan === "boolean"
            ? body.allowLan
            : Boolean(getConfig().warp?.killSwitchAllowLan);
          return { enabled: body.enabled, allowLan };
        },
        onSuccess: () => {
          persistUserKillSwitch({ enabled: body.enabled, allowLan });
          if (!body.enabled) cancelEnrollmentPause();
        }
      });
      const desired = Boolean(getConfig().warp?.killSwitch);
      json(res, result.ok ? 200 : 502, {
        ok: result.ok,
        desired,
        allowLan: Boolean(getConfig().warp?.killSwitchAllowLan),
        active: result.active === null ? null : Boolean(result.enabled),
        probeError: Boolean(result.probeError),
        detail: result.detail,
        method: result.method,
        guidedCommands: result.guidedCommands,
        script: result.script
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/account") {
      json(res, 200, await accountDetails());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readJson(req);
      await serializeWarpAction(async () => {
        if (body?.action === "enableLocalProxy") {
          const steps = [];
          const protocolResult = await runWarp(["tunnel", "protocol", "set", "MASQUE"], { timeout: 30000 });
          steps.push({
            action: "setProtocol",
            result: redactCommand(protocolResult)
          });
          if (!protocolResult.ok) {
            json(res, 502, {
              ok: false,
              error: protocolResult.stderr || protocolResult.stdout || "Could not set tunnel protocol to MASQUE.",
              result: redactCommand(protocolResult),
              steps
            });
            return;
          }
          const modeResult = await runWarp(["mode", "proxy"], { timeout: 30000 });
          steps.push({
            action: "setMode",
            result: redactCommand(modeResult)
          });
          const settingsResult = await runWarp(["settings", "list"], { timeout: 15000 });
          const settings = enrichSettings(parseSettings(settingsResult.stdout || ""));
          const proxyOk = modeResult.ok && settings.Mode === "proxy";
          json(res, proxyOk ? 200 : 502, {
            ok: proxyOk,
            error: proxyOk
              ? undefined
              : (modeResult.stderr || modeResult.stdout || "Could not enable Local proxy mode."),
            result: redactCommand(modeResult),
            steps,
            settings,
            mode: settings.Mode
          });
          void afterWarpNetworkSync("enableLocalProxy");
          return;
        }
        const args = actionArgs(body);
        if (!args) {
          json(res, 400, { ok: false, error: "Unsupported or invalid action." });
          return;
        }
        const pauseForEnroll = ENROLLMENT_PAUSE_ACTIONS.has(body?.action);
        let pauseMeta = null;
        if (pauseForEnroll) {
          pauseMeta = await beginEnrollmentPause();
          if (!pauseMeta.ok) {
            json(res, 502, {
              ok: false,
              error: pauseMeta.detail || "Could not pause kill switch for enrollment.",
              killSwitchPause: pauseMeta
            });
            return;
          }
        }
        let result;
        let resumeMeta = null;
        try {
          result = await runWarp(args, { timeout: 30000 });
        } finally {
          if (pauseForEnroll && (!result?.ok || body.action === "registrationToken")) {
            // A failed enrollment must not leave protection removed for the
            // browser window. Restoration follows the latest desired preference.
            resumeMeta = await endEnrollmentPause({
              reason: result?.ok ? "registrationToken" : "enrollment_failed"
            });
          }
        }
        const operationOk = result.ok && resumeMeta?.ok !== false;
        json(res, operationOk ? 200 : 502, {
          ok: operationOk,
          error: resumeMeta?.ok === false ? resumeMeta.detail || "Could not restore kill switch protection." : undefined,
          result: redactCommand(result),
          killSwitchPause: pauseMeta,
          killSwitchResume: resumeMeta
        });
        void afterWarpNetworkSync(body?.action);
      });
      return;
    }

    json(res, 404, { ok: false, error: "Unknown API route." });
  } catch (error) {
    json(res, error.status || 500, { ok: false, error: error.message });
  }
}

async function serveStatic(req, res, url) {
  const active = getConfig();
  if (!active.webui?.enabled) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...WEB_SECURITY_HEADERS });
    res.end("Not found");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    json(res, 400, { ok: false, error: "Malformed request path." });
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicRoot, safePath);

  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403, { ...WEB_SECURITY_HEADERS });
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] || "application/octet-stream",
      ...WEB_SECURITY_HEADERS
    });
    res.end(body);
  } catch {
    const index = await readFile(join(publicRoot, "index.html"));
    res.writeHead(200, { "content-type": MIME[".html"], ...WEB_SECURITY_HEADERS });
    res.end(index);
  }
}

/** Record a blocked request so users can see it in the Console log (never the token or body). */
function logBlockedRequest(req, url, verdict) {
  appendFromRunWarp(
    {
      command: `${req.method || "GET"} ${url.pathname}`,
      code: verdict.status,
      ok: false,
      stderr: `blocked: ${verdict.reason}`
    },
    { source: "security" }
  );
}

async function dispatchRequest(req, res) {
  // Parse against our own origin: an attacker-controlled Host header must never
  // influence routing, and a malformed one must not throw.
  let url;
  try {
    url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  } catch {
    json(res, 400, { ok: false, error: "Malformed request." });
    return;
  }

  const verdict = evaluateRequest({
    method: req.method,
    pathname: url.pathname,
    headers: req.headers,
    remoteAddress: req.socket?.remoteAddress,
    port,
    sessionToken: session?.token
  });
  if (!verdict.allowed) {
    logBlockedRequest(req, url, verdict);
    json(res, verdict.status, { ok: false, error: verdict.message, reason: verdict.reason });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  await serveStatic(req, res, url);
}

const server = createServer((req, res) => {
  void dispatchRequest(req, res).catch(() => {
    if (res.headersSent) res.destroy();
    else json(res, 500, { ok: false, error: "Request could not be completed." });
  });
});
server.on("error", (error) => {
  console.error(`Unable to start daemon: ${error.code || "listen failed"}`);
  process.exitCode = 1;
});
server.listen(port, listenHost, () => {
  try {
    session = createSessionToken(port);
  } catch {
    console.error("Unable to publish the local session credential.");
    server.close();
    process.exitCode = 1;
    return;
  }
  console.log(`${APP_DISPLAY_NAME} running at http://${listenHost}:${port}`);
  if (getConfig().webui?.enabled) {
    console.log("Web UI enabled — serving static assets from public/.");
  } else {
    console.log("API-only mode (webui.enabled=false). Static UI is not served.");
  }
  console.log(`Local session credential: ${session.path}`);

  if (process.platform === "linux") {
    getStatusListener().subscribe((event) => {
      if (event.kind === "warp") scheduleDesktopNetworkSync();
    });
    void afterWarpNetworkSync("reconcileDesktop");
  }
  const watcher = reconcileStatusWatcher();
  if (watcher?.started) {
    console.log("Desktop notifications enabled (ui.notifications).");
  } else if (notifyWatcherEnabled === false && activeTrayShell() === "cloudflare") {
    console.log("Desktop notifications left to Cloudflare One Client (tray.shell=cloudflare).");
  }

  // Reconcile kill switch: enable when desired; clear orphan table only when probe sees it.
  {
    const desired = Boolean(getConfig().warp?.killSwitch);
    (async () => {
      if (desired) {
        const result = await applyKillSwitch({ resolve: () => ({
          enabled: Boolean(getConfig().warp?.killSwitch),
          allowLan: Boolean(getConfig().warp?.killSwitchAllowLan)
        }) });
        if (result.ok) console.log("WARP kill switch active (warp.killSwitch).");
        else console.warn(`WARP kill switch desired but not applied: ${result.detail}`);
        return;
      }
      const probe = await probeKillSwitchActive();
      if (probe.active === true) {
        const result = await applyKillSwitch({ resolve: () => ({
          enabled: Boolean(getConfig().warp?.killSwitch),
          allowLan: Boolean(getConfig().warp?.killSwitchAllowLan)
        }) });
        if (result.ok) console.log("WARP kill switch orphan table removed.");
        else console.warn(`WARP kill switch orphan cleanup failed: ${result.detail}`);
      } else if (probe.probeError) {
        console.warn(`WARP kill switch probe unavailable at startup: ${probe.detail}`);
      }
    })().catch((error) => {
      console.warn(`WARP kill switch apply failed: ${error.message}`);
    });
  }

  if (getConfig().tray?.autostart) {
    try {
      const autostart = activeTrayShell() === "cloudflare-one-warp";
      const sync = syncTrayAutostart({ autostart });
      if (sync.written) console.log(`Tray autostart entry installed (${sync.path}).`);
    } catch (error) {
      console.warn(`Tray autostart sync failed: ${error.message}`);
    }
  }

  const shutdown = () => {
    clearTimeout(desktopSyncTimer);
    stopBoundedChildren();
    notifyWatcher?.stop();
    getStatusListener().stop();
    if (removeSessionToken(port, process.env, session?.token)) {
      try { cleanupWebuiHandoffs({ all: true, port }); }
      catch { /* A failed cleanup must not prevent daemon shutdown. */ }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
