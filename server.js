import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
  isValidServerPort
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
  getEnrollmentPauseState,
  ENROLLMENT_PAUSE_ACTIONS
} from "./lib/killswitch/index.mjs";
import { startStatusWatcher } from "./lib/notify/status-watcher.mjs";
import {
  appendFromRunWarp,
  getCommandLogCapacity,
  listEntries
} from "./lib/warp/command-log.mjs";
import { assessReadiness, formatDiagnosticsClipboard } from "./lib/readiness/index.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const config = reloadConfig();
const port = Number(config.server?.port || 4173);
const listenHost = effectiveBind(config);
const session = createSessionToken(port);

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

/** Keep NetworkManager / KDE Plasma proxy state aligned with warp-cli (Linux only). */
async function afterWarpNetworkSync(action) {
  if (process.platform !== "linux" || !action) return;
  try {
    const snap = await snapshot();
    if (action === "disconnect") {
      deactivateCloudflareOneWarpNmProfiles();
      syncKdeProxy({ enabled: false, appRoot: root });
      return;
    }
    const syncActions = new Set(["connect", "setMode", "setProtocol", "setMasqueOptions", "enableLocalProxy"]);
    if (!syncActions.has(action)) return;
    syncNmForWarpState(snap);
    const settings = snap.settings || {};
    const slug = slugForWarpSettings({
      mode: settings.Mode,
      protocol: settings["Preferred protocol"] ?? settings.Protocol ?? settings.protocol
    });
    syncKdeProxy({ enabled: slug === "proxy", port: 40000, appRoot: root });
  } catch {
    /* optional integration */
  }
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
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawnWarpCli(finalArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 15000
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      const result = {
        ok: false,
        command: `warp-cli ${finalArgs.join(" ")}`,
        code: null,
        stdout: "",
        stderr: error.message,
        durationMs: Date.now() - startedAt
      };
      appendFromRunWarp(redactCommand(result), { source: options.source || "warp" });
      resolve(result);
    });
    child.on("close", (code) => {
      const result = {
        ok: code === 0,
        command: `warp-cli ${finalArgs.join(" ")}`,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt
      };
      appendFromRunWarp(redactCommand(result), { source: options.source || "warp" });
      resolve(result);
    });
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
    // JSON from warp-cli --json (registration show/devices/organization)
    .replace(/("(?:id|device_id|public_key|license|account_id)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"');
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
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function actionArgs(body) {
  const { action, value, secondary } = body || {};

  if (ACTIONS[action]) return ACTIONS[action];
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
  if (action === "setProxyPort" && /^\d{2,5}$/.test(String(value))) return ["proxy", "port", String(value)];
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
    showResult.ok ? showResult.stdout : showResult.stderr || showResult.stdout
  );
  // Text fallback when --json is unsupported
  if (!registration.registered && !showResult.ok) {
    const textShow = await runWarp(["registration", "show"]);
    Object.assign(
      registration,
      parseRegistrationShow(textShow.ok ? textShow.stdout : textShow.stderr || textShow.stdout)
    );
  }

  const organization = parseRegistrationOrganization(
    orgResult.ok ? orgResult.stdout : orgResult.stderr || orgResult.stdout
  );
  let devices = parseRegistrationDevices(
    devicesResult.ok ? devicesResult.stdout : devicesResult.stderr || devicesResult.stdout
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
      // The request gate already proved this is a same-origin loopback caller.
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

    if (req.method === "GET" && url.pathname === "/api/health") {
      const active = getConfig();
      json(res, 200, {
        ok: true,
        app: APP_ID,
        name: APP_DISPLAY_NAME,
        version: getVersion(),
        apiRevision: API_REVISION,
        webuiEnabled: Boolean(active.webui?.enabled),
        effectivePort: Number(active.server?.port || port),
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

    if (req.method === "GET" && url.pathname === "/api/version") {
      const active = getConfig();
      json(res, 200, {
        ok: true,
        ...getVersionInfo(active),
        installFormat: detectInstallFormat()
      });
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
          bind: effectiveBind(active),
          port: Number(active.server?.port || port)
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
      if (body?.bind != null && (typeof body.bind !== "string" || !body.bind.trim())) {
        json(res, 400, { ok: false, error: "bind must be a non-empty string" });
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
        detail: enroll.paused
          ? "Kill switch paused for Zero Trust enrollment."
          : probe.detail,
        interface: "CloudflareWARP",
        note: "Native nftables kill switch — blocks outbound traffic except loopback, the WARP tunnel, and Cloudflare bootstrap IPs."
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/killswitch/enrollment-pause") {
      const body = await readJson(req);
      const mode = body?.mode === "end" ? "end" : "begin";
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
      const previousDesired = Boolean(getConfig().warp?.killSwitch);
      const previousAllowLan = Boolean(getConfig().warp?.killSwitchAllowLan);
      const allowLan = typeof body.allowLan === "boolean"
        ? body.allowLan
        : previousAllowLan;
      // Apply nft first — only commit session desired after a successful apply.
      const result = await applyKillSwitch({
        enabled: body.enabled,
        allowLan
      });
      if (result.ok) {
        persistUserKillSwitch({ enabled: body.enabled, allowLan });
      } else {
        setSessionKillSwitch({ enabled: previousDesired, allowLan: previousAllowLan });
      }
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
      const result = await runWarp(args, { timeout: 30000 });
      let resumeMeta = null;
      if (pauseForEnroll && body?.action === "registrationToken") {
        // Token completion ends the browser/IdP window — restore KS if it was desired.
        resumeMeta = await endEnrollmentPause({ reason: "registrationToken" });
      }
      json(res, result.ok ? 200 : 502, {
        ok: result.ok,
        result: redactCommand(result),
        killSwitchPause: pauseMeta,
        killSwitchResume: resumeMeta
      });
      void afterWarpNetworkSync(body?.action);
      return;
    }

    json(res, 404, { ok: false, error: "Unknown API route." });
  } catch (error) {
    json(res, 500, { ok: false, error: error.message });
  }
}

async function serveStatic(req, res, url) {
  const active = getConfig();
  if (!active.webui?.enabled) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...WEB_SECURITY_HEADERS });
    res.end("Not found");
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
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

createServer(async (req, res) => {
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
    sessionToken: session.token
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
}).listen(port, listenHost, () => {
  console.log(`${APP_DISPLAY_NAME} running at http://${listenHost}:${port}`);
  if (getConfig().webui?.enabled) {
    console.log("Web UI enabled — serving static assets from public/.");
  } else {
    console.log("API-only mode (webui.enabled=false). Static UI is not served.");
  }
  console.log(`Local session credential: ${session.path}`);

  const watcher = reconcileStatusWatcher();
  if (watcher?.started) {
    console.log("Desktop notifications enabled (ui.notifications).");
  } else if (notifyWatcherEnabled === false && activeTrayShell() === "cloudflare") {
    console.log("Desktop notifications left to Cloudflare One Client (tray.shell=cloudflare).");
  }

  // Reconcile kill switch: enable when desired; clear orphan table only when probe sees it.
  {
    const desired = Boolean(getConfig().warp?.killSwitch);
    const allowLan = Boolean(getConfig().warp?.killSwitchAllowLan);
    (async () => {
      if (desired) {
        const result = await applyKillSwitch({ enabled: true, allowLan });
        if (result.ok) console.log("WARP kill switch active (warp.killSwitch).");
        else console.warn(`WARP kill switch desired but not applied: ${result.detail}`);
        return;
      }
      const probe = await probeKillSwitchActive();
      if (probe.active === true) {
        const result = await applyKillSwitch({ enabled: false, allowLan });
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
      const sync = syncTrayAutostart({ autostart: true });
      if (sync.written) console.log(`Tray autostart entry installed (${sync.path}).`);
    } catch (error) {
      console.warn(`Tray autostart sync failed: ${error.message}`);
    }
  }

  const shutdown = () => {
    notifyWatcher?.stop();
    getStatusListener().stop();
    removeSessionToken(port);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
