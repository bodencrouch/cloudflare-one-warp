import { apiFetch } from "./api-client.js";
import { loadLocale, t, tip, getLocale } from "./i18n.js";
import {
  appendStatusLine,
  createDefaultLogWidgetState,
  isLogPanelFocused,
  LOG_WIDGET_COLLAPSED_KEY,
  LOG_WIDGET_TAB_KEY,
  openLogDockTab,
  patchLogStatusTab,
  pollConsoleLogs,
  renderLogDock,
  seedStatusFromSnapshot
} from "./log-widget.js";

const navItems = [
  ["home", "nav.home", "⌂", "pageHome"],
  ["account", "nav.account", "◎", "pageAccount"],
  ["gateway", "nav.gateway", "◇", "pageGateway"],
  ["tunnel", "nav.tunnel", "↔", "pageTunnel"],
  ["split", "nav.split", "⌁", "pageSplit"],
  ["trusted", "nav.trusted", "⌁", "pageTrusted"],
  ["settings", "nav.settings", "⚙", "pageSettings"],
  ["app", "nav.app", "✦", "pageApp"],
  ["advanced", "nav.advanced", "⌘", "pageAdvanced"]
];

const quickModes = ["warp", "doh", "warp+doh", "dot", "warp+dot", "proxy", "tunnel_only"];
const protocols = ["MASQUE", "WireGuard"];
const families = ["off", "malware", "full"];
const masqueOptions = ["h3-with-h2-fallback", "h3-only", "h2-only"];

const state = {
  view: "home",
  snapshot: null,
  busy: false,
  lastAction: null,
  error: null,
  toast: null,
  version: null,
  health: null,
  appConfig: null,
  update: {
    checking: false,
    loadingCatalog: false,
    loadingReleases: false,
    result: null,
    releases: [],
    forks: [],
    upstream: null,
    selectedOwner: "",
    selectedRepo: "",
    selectedTag: "",
    confirmToken: null,
    showReleases: false
  },
  live: {
    connected: false,
    label: "Live status connecting",
    lastEvent: null,
    lastLine: "",
    failures: 0
  },
  forms: {
    proxyPort: "40000",
    vnet: "",
    splitIp: "",
    splitHost: "",
    gatewayId: "",
    dnsFallback: "",
    endpoint: "",
    trustedSsid: "",
    overrideCode: "",
    customCommand: "status",
    organization: "",
    licenseKey: "",
    authToken: ""
  },
  account: null,
  accountLoading: false,
  revealLicense: false,
  killswitch: {
    desired: false,
    allowLan: false,
    active: false,
    probeError: false,
    enrollmentPaused: false,
    detail: "",
    guidedCommands: null,
    script: null,
    loading: false
  },
  pendingScrollId: null,
  logWidget: createDefaultLogWidgetState(),
  desktopApps: {
    list: [],
    loading: false,
    selectedId: "",
    lastShortcut: null
  },
  appRouting: {
    pending: false
  },
  ui: {
    openPanels: new Set()
  }
};

const EXPERT_UI_STORAGE_KEY = "thirdflare-ui-expert";

const simpleNavItems = [
  ["home", "simple.nav.home", "⌂"],
  ["connectivity", "simple.nav.connectivity", "⎔"],
  ["settings", "simple.nav.settings", "⚙"],
  ["profile", "simple.nav.profile", "◎"],
  ["about", "simple.nav.about", "☁"]
];

const app = document.querySelector("#app");

function isNativeShell() {
  return new URLSearchParams(window.location.search).get("shell") === "1";
}

function initNativeBridge() {
  if (!isNativeShell() || window.thirdflare) return;
  if (typeof qt === "undefined") return;
  const script = document.createElement("script");
  script.src = "qrc:///qtwebchannel/qwebchannel.js";
  script.onload = () => {
    if (typeof QWebChannel === "undefined" || typeof qt === "undefined") return;
    // eslint-disable-next-line no-undef
    new QWebChannel(qt.webChannelTransport, (channel) => {
      window.thirdflare = channel.objects.thirdflare;
    });
  };
  document.head.appendChild(script);
}

function openSystemSettings() {
  if (window.thirdflare?.openSettings) {
    window.thirdflare.openSettings();
    return;
  }
  state.toast = t("app.openSettingsUnavailable");
  render();
}

function useExpertLayout() {
  return !isNativeShell() || localStorage.getItem(EXPERT_UI_STORAGE_KEY) === "1";
}

function setExpertMode(enabled) {
  if (enabled) {
    localStorage.setItem(EXPERT_UI_STORAGE_KEY, "1");
    state.view = "home";
  } else {
    localStorage.removeItem(EXPERT_UI_STORAGE_KEY);
    state.view = "connectivity";
  }
  render();
}

function openRoutingExpert(view = "split", scrollId = null) {
  localStorage.setItem(EXPERT_UI_STORAGE_KEY, "1");
  state.view = view;
  state.pendingScrollId = scrollId;
  render();
}

function splitTunnelState() {
  return state.snapshot?.splitTunnel || { mode: "unknown", ips: [], hosts: [], managedByDashboard: false, managedHint: null };
}

function splitModeLabel(mode) {
  if (mode === "exclude") return t("splitGuide.modeExclude");
  if (mode === "include") return t("splitGuide.modeInclude");
  return t("splitGuide.modeUnknown");
}

function proxyPortValue() {
  const fromForm = String(state.forms.proxyPort || "").trim();
  if (fromForm) return fromForm;
  const fromSettings = setting("Proxy port", "proxy port");
  if (fromSettings && fromSettings !== "Unknown") return fromSettings;
  return "40000";
}

/** Local proxy / WarpProxy mode (warp-cli display string or normalized slug). */
function isProxyMode() {
  const mode = String(setting("Mode") || "");
  const lower = mode.toLowerCase();
  if (lower === "proxy") return true;
  if (/^warpproxy\b/i.test(mode) || /\bproxy on port\b/i.test(mode)) return true;
  return Boolean(state.appRouting?.pending);
}

async function copyText(label, text) {
  try {
    await navigator.clipboard.writeText(text);
    state.toast = label;
    render();
  } catch {
    state.error = t("account.copyFailed");
    render();
  }
}

function commandText(key) {
  const command = state.snapshot?.commands?.[key];
  if (!command) return "No output yet.";
  return command.stdout || command.stderr || "No output.";
}

function setting(...keys) {
  const settings = state.snapshot?.settings || {};
  for (const key of keys) {
    const needle = key.toLowerCase();
    const found = Object.entries(settings).find(([name]) => {
      const normalized = name.toLowerCase().replace(/^\([^)]*\)\s*/, "").trim();
      return normalized === needle || normalized.endsWith(`\t${needle}`) || normalized.endsWith(needle);
    });
    if (found) return found[1];
  }
  return "Unknown";
}

function readinessReport() {
  return state.snapshot?.readiness || null;
}

function readinessHardBlocked() {
  const readiness = readinessReport();
  if (readiness) return Boolean(readiness.hardBlocked);
  return state.snapshot?.daemon?.available === false;
}

function readinessAttentionItems() {
  const readiness = readinessReport();
  if (!readiness?.items) return [];
  return readiness.items.filter((item) => item.state !== "ready");
}

function statusKind() {
  const readiness = readinessReport();
  if (readiness?.hardBlocked) return "bad";
  if (readiness?.softWarnings) return "warn";
  if (!state.snapshot?.daemon?.available) return "bad";
  return state.snapshot.status?.severity || "warn";
}

function statusText() {
  if (!state.snapshot) return "Loading WARP state";
  const blockers = readinessAttentionItems().filter((item) => item.hardBlocker);
  if (blockers.length) return blockers[0].title;
  if (!state.snapshot.daemon.available) return "Daemon unavailable";
  return state.snapshot.status.label || "State unavailable";
}

/** Single Connect/Disconnect control driven by live WARP status. */
function connectionToggle() {
  const hardBlocked = readinessHardBlocked();
  const status = state.snapshot?.status;
  const connected = Boolean(status?.connected);
  const connecting = Boolean(status?.connecting);
  const blocker = readinessAttentionItems().find((item) => item.hardBlocker);

  if (hardBlocked) {
    return {
      action: null,
      label: t("common.connect"),
      tipKey: "daemon",
      className: "primary tip connection-toggle",
      disabled: true,
      pressed: false,
      reason: blocker?.nextStep || t("home.readinessBlocked")
    };
  }
  if (connected || connecting) {
    return {
      action: "disconnect",
      label: connecting ? t("common.connecting") : t("common.disconnect"),
      tipKey: "disconnect",
      className: "secondary danger tip connection-toggle is-connected",
      disabled: false,
      pressed: true
    };
  }
  return {
    action: "connect",
    label: t("common.connect"),
    tipKey: "connect",
    className: "primary tip connection-toggle",
    disabled: false,
    pressed: false
  };
}

function applyConnectionToggle(button) {
  if (!button) return;
  const toggle = connectionToggle();
  button.className = toggle.className;
  button.textContent = toggle.label;
  button.disabled = toggle.disabled || state.busy;
  button.setAttribute("aria-pressed", toggle.pressed ? "true" : "false");
  button.setAttribute("data-action", toggle.action || "");
  button.setAttribute("data-tip", tip(toggle.tipKey));
  button.tabIndex = 0;
}

function wireConnectionToggle(button) {
  if (!button) return;
  const extraClass = button.hasAttribute("data-header-connection-toggle") ? "header-connection-toggle" : "";
  applyConnectionToggle(button);
  if (extraClass) button.classList.add(extraClass);
  button.onclick = () => {
    const next = connectionToggle();
    if (!next.action || next.disabled) return;
    action(next.action);
  };
}

function el(tag, className, html = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.innerHTML = html;
  return node;
}

function hasFocusedField() {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable;
}

/** True when a full render would disrupt in-progress UI interaction. */
function isUserInteracting() {
  if (hasFocusedField() || isLogPanelFocused()) return true;
  const active = document.activeElement;
  if (active && active !== document.body) {
    const tag = active.tagName;
    if (tag === "BUTTON" || tag === "SUMMARY" || tag === "A") return true;
    if (active.closest?.(".segmented, .switch-row, .log-dock, .button-row")) return true;
  }
  if (document.querySelector("details[open]")) return true;
  if (state.busy) return true;
  return false;
}

function captureOpenPanels() {
  if (!state.ui?.openPanels) state.ui.openPanels = new Set();
  document.querySelectorAll("details[data-panel-id]").forEach((node) => {
    const id = node.getAttribute("data-panel-id");
    if (!id) return;
    if (node.open) state.ui.openPanels.add(id);
    else state.ui.openPanels.delete(id);
  });
}

function wireDetailsPanel(details, panelId) {
  if (!panelId) return details;
  details.setAttribute("data-panel-id", panelId);
  if (state.ui?.openPanels?.has(panelId)) details.open = true;
  details.addEventListener("toggle", () => {
    if (!state.ui.openPanels) state.ui.openPanels = new Set();
    if (details.open) state.ui.openPanels.add(panelId);
    else state.ui.openPanels.delete(panelId);
  });
  return details;
}

function patchTunnelProxyGuide() {
  const panel = document.getElementById("tunnel-proxy-guide");
  if (!panel || state.view !== "tunnel") return;
  const isProxy = isProxyMode();
  const wasProxy = Boolean(panel.querySelector("[data-copy-proxy]"));
  if (isProxy === wasProxy) return;
  panel.replaceWith(tunnelProxyGuidePanel());
}

function patchAppRoutingPanel() {
  const panel = document.getElementById("app-routing-guide");
  if (!panel || state.view !== "split") return;
  const isProxy = isProxyMode();
  const hasPicker = Boolean(panel.querySelector("[data-testid='app-routing-select']"));
  if (isProxy === hasPicker) return;
  panel.replaceWith(appRoutingPanel());
}

function patchSilentRefresh() {
  patchLiveChrome();
  patchLogStatusTab(state);
  patchSnapshotPanels();
  patchTunnelProxyGuide();
  patchAppRoutingPanel();
}

/** Update output pre blocks and metrics without rebuilding the shell. */
function patchSnapshotPanels() {
  if (!state.snapshot) return;

  document.querySelectorAll("[data-output-key]").forEach((panel) => {
    const key = panel.getAttribute("data-output-key");
    const command = key === "lastAction" ? state.lastAction : state.snapshot?.commands?.[key];
    const pre = panel.querySelector("pre");
    const badge = panel.querySelector(".panel-heading span");
    if (pre) {
      const output = command
        ? (command.stdout || command.stderr || "No output.")
        : "No output yet.";
      pre.textContent = output;
    }
    if (badge && command) {
      badge.className = command.ok ? "ok" : "fail";
      badge.textContent = command.ok ? "ok" : `exit ${command.code ?? "error"}`;
    }
  });

  document.querySelectorAll(".metrics-row .metric strong").forEach((node, index) => {
    const tunnel = state.snapshot?.parsed?.tunnel || {};
    const dns = state.snapshot?.parsed?.dns || {};
    const values = [
      setting("Mode"),
      tunnel.protocol || setting("Tunnel protocol", "Protocol"),
      tunnel.latency || "Unknown",
      tunnel.sent && tunnel.received ? `${tunnel.sent} up / ${tunnel.received} down` : "Unknown",
      dns.success ? `${dns.success} success` : "Unknown",
      new Date(state.snapshot.generatedAt).toLocaleTimeString()
    ];
    if (values[index] != null) node.textContent = String(values[index]).slice(0, 80);
  });

  patchKillSwitchChrome();
  patchSegmentedSelection();
}

function patchKillSwitchChrome() {
  const ks = state.killswitch;
  const panel = app.querySelector(".killswitch-panel");
  if (!panel) return;
  const effectivelyOn = Boolean(ks.active) || (Boolean(ks.desired) && !ks.enrollmentPaused);
  panel.querySelectorAll(".switch").forEach((toggle, index) => {
    const on = index === 0 ? effectivelyOn : ks.allowLan;
    toggle.classList.toggle("on", on);
    toggle.setAttribute("aria-checked", on ? "true" : "false");
    toggle.disabled = ks.loading || state.busy || (index === 1 && !effectivelyOn);
  });
}

function patchSegmentedSelection() {
  document.querySelectorAll(".segmented[data-setting-key]").forEach((row) => {
    const keys = row.getAttribute("data-setting-key").split("|").map((key) => key.trim());
    const current = String(setting(...keys) || "").toLowerCase();
    row.querySelectorAll("button[data-value]").forEach((button) => {
      const value = String(button.getAttribute("data-value") || "").toLowerCase();
      button.classList.toggle("selected", value === current);
      button.disabled = state.busy;
    });
  });
}

async function refresh({ silent = false, preserveError = false } = {}) {
  if (!silent) {
    if (!preserveError) state.error = null;
    render();
  }
  try {
    const response = await apiFetch("/api/snapshot");
    state.snapshot = await response.json();
    seedStatusFromSnapshot(state);
    if (state.view === "account") await loadAccount(false);
    if (state.view === "split") await loadDesktopApps(false);
    if (String(state.snapshot?.settings?.Mode || "").toLowerCase() === "proxy") {
      state.appRouting.pending = false;
    }
    const killSwitchDesired = Boolean(state.appConfig?.warp?.killSwitch);
    if (state.view === "settings" || (state.view === "home" && killSwitchDesired)) {
      await loadKillSwitch(false);
    }
  } catch (error) {
    state.error = error.message;
  }
  if (silent) {
    patchSilentRefresh();
    return;
  }
  render();
}

async function loadKillSwitch(showBusy = true) {
  if (showBusy) state.killswitch.loading = true;
  try {
    const response = await apiFetch("/api/killswitch");
    const body = await response.json();
    state.killswitch.desired = Boolean(body.desired);
    state.killswitch.allowLan = Boolean(body.allowLan);
    state.killswitch.active = body.active === null ? null : Boolean(body.active);
    state.killswitch.probeError = Boolean(body.probeError);
    state.killswitch.enrollmentPaused = Boolean(body.enrollmentPause?.paused);
    state.killswitch.detail = body.detail || "";
    if (body.ok !== false && !body.guidedCommands) {
      state.killswitch.guidedCommands = null;
      state.killswitch.script = null;
    }
  } catch (error) {
    state.killswitch.detail = error.message;
  }
  state.killswitch.loading = false;
}

async function setKillSwitch(enabled, allowLan = state.killswitch.allowLan) {
  if (enabled && !window.confirm(t("home.killSwitchConfirm"))) return;
  state.killswitch.loading = true;
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/killswitch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, allowLan })
    });
    const body = await response.json();
    state.killswitch.desired = Boolean(body.desired);
    state.killswitch.allowLan = Boolean(body.allowLan);
    state.killswitch.active = body.active === null ? null : Boolean(body.active);
    state.killswitch.probeError = Boolean(body.probeError);
    state.killswitch.detail = body.detail || "";
    state.killswitch.guidedCommands = body.guidedCommands || null;
    state.killswitch.script = body.script || null;
    if (!response.ok) state.error = body.detail || "Kill switch apply failed.";
    if (state.appConfig?.warp) {
      state.appConfig.warp.killSwitch = state.killswitch.desired;
      state.appConfig.warp.killSwitchAllowLan = state.killswitch.allowLan;
    }
  } catch (error) {
    state.error = error.message;
  }
  state.killswitch.loading = false;
  if (state.error) render();
  else patchSilentRefresh();
}

function killSwitchMode() {
  const ks = state.killswitch;
  if (ks.enrollmentPaused) return "paused";
  if (ks.desired || ks.active) return "always_on";
  return "off";
}

function killSwitchPanel() {
  const ks = state.killswitch;
  const panel = el("section", "panel killswitch-panel");
  // Treat orphan active (desired off, table on) as on so the toggle can disable.
  const effectivelyOn = Boolean(ks.active) || (Boolean(ks.desired) && !ks.enrollmentPaused);
  const mismatch = Boolean(ks.active) !== Boolean(ks.desired) || Boolean(ks.probeError);
  const mode = killSwitchMode();
  const badge = mode === "paused"
    ? t("home.killSwitchModePaused")
    : mode === "always_on"
      ? t("home.killSwitchModeAlwaysOn")
      : ks.probeError
        ? t("home.killSwitchUnknown")
        : t("home.killSwitchModeOff");
  panel.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup("killSwitch")}>${t("home.killSwitch")}</h3>
      <span data-testid="killswitch-mode">${badge}</span>
    </div>
    <p class="panel-lede tip" data-tip="${escapeHtml(tip("killSwitch"))}" tabindex="0">${t("home.killSwitchCopy")}</p>
  `;

  const main = el("div", "switch-row");
  main.innerHTML = `
    <div class="switch-meta">
      <strong class="tip" data-tip="${escapeHtml(tip("killSwitch"))}" tabindex="0">${t("home.killSwitchLabel")}</strong>
      <p>${escapeHtml(
        mode === "paused"
          ? t("home.killSwitchPausedHint")
          : mode === "always_on"
            ? (ks.detail || t("home.killSwitchRestoreHint"))
            : (ks.detail || (mismatch ? t("home.killSwitchMismatch") : t("home.killSwitchHint")))
      )}</p>
    </div>
  `;
  const toggle = el("button", `switch ${effectivelyOn ? "on" : ""}`);
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", effectivelyOn ? "true" : "false");
  toggle.setAttribute("aria-label", t("home.killSwitchLabel"));
  toggle.setAttribute("data-testid", "killswitch-toggle");
  toggle.disabled = ks.loading || state.busy;
  toggle.onclick = () => setKillSwitch(!effectivelyOn, ks.allowLan);
  main.append(toggle);
  panel.append(main);

  const lan = el("div", "switch-row");
  lan.innerHTML = `
    <div class="switch-meta">
      <strong class="tip" data-tip="${escapeHtml(tip("killSwitchAllowLan"))}" tabindex="0">${t("home.killSwitchAllowLan")}</strong>
      <p>${t("home.killSwitchAllowLanHint")}</p>
    </div>
  `;
  const lanToggle = el("button", `switch ${ks.allowLan ? "on" : ""}`);
  lanToggle.type = "button";
  lanToggle.setAttribute("role", "switch");
  lanToggle.setAttribute("aria-checked", ks.allowLan ? "true" : "false");
  lanToggle.setAttribute("aria-label", t("home.killSwitchAllowLan"));
  lanToggle.setAttribute("data-testid", "killswitch-allow-lan");
  lanToggle.disabled = ks.loading || state.busy || !effectivelyOn;
  lanToggle.onclick = () => setKillSwitch(true, !ks.allowLan);
  lan.append(lanToggle);
  panel.append(lan);

  if (ks.guidedCommands?.length) {
    const guide = el("div", "killswitch-guide");
    guide.innerHTML = `<p>${t("home.killSwitchGuided")}</p><pre>${escapeHtml(ks.guidedCommands.join("\n"))}${ks.script ? `\n\n${escapeHtml(ks.script)}` : ""}</pre>`;
    panel.append(guide);
  }
  return panel;
}

async function loadAccount(showBusy = true) {
  if (showBusy) {
    state.accountLoading = true;
    render();
  }
  try {
    const response = await apiFetch("/api/account");
    state.account = await response.json();
  } catch (error) {
    state.error = error.message;
  }
  state.accountLoading = false;
}

async function loadDesktopApps(showBusy = true) {
  if (showBusy) {
    state.desktopApps.loading = true;
    render();
  }
  try {
    const response = await apiFetch("/api/apps");
    const body = await response.json();
    state.desktopApps.list = body.ok ? body.apps || [] : [];
    if (!state.desktopApps.selectedId && state.desktopApps.list.length) {
      state.desktopApps.selectedId = state.desktopApps.list[0].id;
    }
  } catch (error) {
    state.error = error.message;
  }
  state.desktopApps.loading = false;
}

async function createAppShortcut() {
  const appId = state.desktopApps.selectedId;
  if (!appId) {
    state.error = t("appRouting.enableFirst");
    render();
    return;
  }
  if (!isProxyMode()) {
    state.error = t("appRouting.enableFirst");
    render();
    return;
  }
  state.busy = true;
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/apps/proxy-launcher", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId, port: proxyPortValue() })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      state.error = body.error || t("tunnelGuide.enableProxyFailed");
    } else {
      state.desktopApps.lastShortcut = body;
      state.toast = t("appRouting.shortcutCreated");
    }
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  render();
}

async function action(actionName, value, secondary, confirmCommand = false) {
  if (confirmCommand && !window.confirm(`Run warp-cli action: ${actionName}?`)) return;

  state.busy = true;
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: actionName, value, secondary })
    });
    const body = await response.json();
    state.lastAction = body.result || body;
    if (!response.ok) state.error = body.error || body.result?.stderr || "Command failed.";
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  await pollConsoleLogs(state);
  if (state.error || state.toast) await refresh({ preserveError: true });
  else await refresh({ preserveError: true, silent: true });
}

async function enableLocalProxy() {
  if (!window.confirm(t("tunnelGuide.enableProxyConfirm"))) return;
  openLogDockTab(state, "console");
  state.busy = true;
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "enableLocalProxy" })
    });
    const body = await response.json();
    state.lastAction = body.result || body;
    if (!response.ok) {
      state.error = body.error || body.result?.stderr || t("tunnelGuide.enableProxyFailed");
      state.appRouting.pending = false;
    } else {
      state.appRouting.pending = true;
      if (body.settings && state.snapshot) {
        state.snapshot.settings = { ...(state.snapshot.settings || {}), ...body.settings };
      }
      state.toast = t("tunnelGuide.proxyEnabledToast");
      state.pendingScrollId = "app-routing-guide";
      await loadDesktopApps(true);
    }
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  await pollConsoleLogs(state);
  if (state.error || state.toast) await refresh({ preserveError: true });
  else {
    await refresh({ preserveError: true, silent: true });
    patchTunnelProxyGuide();
  }
}

function dnsProtocolLabel() {
  const mode = String(setting("Mode")).toLowerCase();
  if (mode === "doh" || mode === "warp+doh") return "DoH";
  if (mode === "dot" || mode === "warp+dot") return "DoT";
  return "off";
}

function tunnelProtocolLabel() {
  if (!state.snapshot?.status?.connected) return "N/A";
  const value = setting("WARP tunnel protocol", "Tunnel protocol", "Protocol");
  return value === "Unknown" ? "N/A" : value;
}

function connectionBadge() {
  const status = state.snapshot?.status;
  if (!state.snapshot?.daemon?.available) {
    return { text: t("home.daemonMissing"), kind: "bad" };
  }
  if (!status) return { text: t("common.unknown"), kind: "warn" };
  if (status.connecting) return { text: t("common.connecting"), kind: "warn" };
  if (status.connected) return { text: t("simple.connected"), kind: "good" };
  return { text: t("simple.disconnected"), kind: "bad" };
}

function cfCard(title, rows) {
  const card = el("section", "cf-card");
  card.innerHTML = `<div class="cf-card-title">${escapeHtml(title)}</div>`;
  rows.forEach(([label, valueHtml]) => {
    const row = el("div", "cf-row");
    row.innerHTML = `<span>${escapeHtml(label)}</span><span class="cf-row-value">${valueHtml}</span>`;
    card.append(row);
  });
  return card;
}

function simpleActionsBar() {
  const bar = el("div", "simple-actions");
  const connectBtn = el("button", "connection-toggle header-connection-toggle", "");
  connectBtn.type = "button";
  connectBtn.setAttribute("data-header-connection-toggle", "");
  connectBtn.setAttribute("data-testid", "header-connection-toggle");
  wireConnectionToggle(connectBtn);
  connectBtn.classList.add("header-connection-toggle");

  const refreshBtn = el("button", "ghost icon-button tip", "↻");
  refreshBtn.type = "button";
  refreshBtn.setAttribute("data-refresh", "");
  refreshBtn.setAttribute("data-testid", "refresh-button");
  refreshBtn.setAttribute("aria-label", t("common.refresh"));
  refreshBtn.setAttribute("data-tip", t("common.refresh"));
  refreshBtn.tabIndex = 0;
  refreshBtn.onclick = refresh;

  bar.append(connectBtn, refreshBtn);
  return bar;
}

function simpleHomeView() {
  const view = el("div", "view-stack");
  const head = el("div", "simple-page-head");
  head.append(el("h1", "simple-page-title", t("simple.nav.home")));
  head.append(simpleActionsBar());
  view.append(head);

  const badge = connectionBadge();
  const hero = el("section", "cf-card simple-hero");
  hero.innerHTML = `
    <div class="cf-card-title">${t("simple.tunnelConnection")}</div>
    <div class="cf-row">
      <span>${t("simple.connectionStatus")}</span>
      <span class="status-badge ${badge.kind}">${escapeHtml(badge.text)}</span>
    </div>
    <div class="cf-row">
      <span>${t("simple.statusLine")}</span>
      <span class="cf-row-value">${escapeHtml(statusText())}</span>
    </div>
  `;
  view.append(hero);
  return view;
}

function simpleConnectivityView() {
  const view = el("div", "view-stack");
  const head = el("div", "simple-page-head");
  head.append(el("h1", "simple-page-title", t("simple.nav.connectivity")));
  head.append(simpleActionsBar());
  view.append(head);

  view.append(cfCard(t("simple.dnsConnection"), [
    [t("simple.dnsProtocol"), escapeHtml(dnsProtocolLabel())]
  ]));

  const badge = connectionBadge();
  view.append(cfCard(t("simple.tunnelConnection"), [
    [t("simple.connectionStatus"), `<span class="status-badge ${badge.kind}">${escapeHtml(badge.text)}</span>`],
    [t("simple.warpTunnelProtocol"), escapeHtml(tunnelProtocolLabel())]
  ]));

  const keysCard = el("section", "cf-card");
  keysCard.innerHTML = `<div class="cf-card-title">${t("simple.encryptionKeys")}</div>`;
  const keysRow = el("div", "cf-row cf-row-action");
  keysRow.innerHTML = `<span>${t("simple.encryptionKeys")}</span>`;
  const resetBtn = el("button", "secondary", t("simple.resetKeys"));
  resetBtn.type = "button";
  resetBtn.disabled = state.busy;
  resetBtn.onclick = () => action("rotateKeys");
  keysRow.append(resetBtn);
  keysCard.append(keysRow);
  view.append(keysCard);

  const routingCard = el("section", "cf-card simple-routing-card");
  routingCard.innerHTML = `<div class="cf-card-title">${t("simple.routingTitle")}</div><p class="simple-routing-copy">${t("simple.routingSummary")}</p>`;
  const routingBtn = el("button", "secondary", t("simple.configureRouting"));
  routingBtn.type = "button";
  routingBtn.disabled = state.busy;
  routingBtn.onclick = () => openRoutingExpert("split");
  routingCard.append(routingBtn);
  view.append(routingCard);

  return view;
}

function simpleSettingsView() {
  const view = el("div", "view-stack");
  const head = el("div", "simple-page-head");
  head.append(el("h1", "simple-page-title", t("simple.nav.settings")));
  head.append(simpleActionsBar());
  view.append(head);

  const expertOn = useExpertLayout();
  const expertRow = el("div", "switch-row");
  expertRow.innerHTML = `
    <div class="switch-meta">
      <strong>${t("simple.expertMode")}</strong>
      <p>${t("simple.expertModeHint")}</p>
    </div>
  `;
  const expertToggle = el("button", `switch ${expertOn ? "on" : ""}`);
  expertToggle.type = "button";
  expertToggle.setAttribute("role", "switch");
  expertToggle.setAttribute("aria-checked", expertOn ? "true" : "false");
  expertToggle.setAttribute("aria-label", t("simple.expertMode"));
  expertToggle.onclick = () => setExpertMode(!expertOn);
  expertRow.append(expertToggle);
  const expertPanel = el("section", "panel");
  expertPanel.append(expertRow);
  view.append(expertPanel);
  view.append(desktopAppPanel());
  return view;
}

function simpleProfileView() {
  const view = el("div", "view-stack");
  const head = el("div", "simple-page-head");
  head.append(el("h1", "simple-page-title", t("simple.nav.profile")));
  head.append(simpleActionsBar());
  view.append(head);

  const account = state.account;
  view.append(cfCard(t("account.overview"), [
    [t("account.registered"), account?.registered ? t("account.registered") : t("account.notRegistered")],
    [t("account.accountType"), escapeHtml(account?.accountType || t("common.unknown"))],
    [t("account.deviceId"), escapeHtml(account?.deviceId || t("common.unknown"))]
  ]));
  return view;
}

function simpleAboutView() {
  const view = el("div", "view-stack");
  const head = el("div", "simple-page-head");
  head.append(el("h1", "simple-page-title", t("simple.nav.about")));
  head.append(simpleActionsBar());
  view.append(head);

  const version = state.version?.version || "…";
  const format = state.version?.installFormat || "…";
  view.append(cfCard(t("app.about"), [
    [t("app.currentVersion"), escapeHtml(version)],
    [t("app.installFormat"), escapeHtml(format)],
    [t("brand.title"), "ThirdFlare One"]
  ]));
  view.append(el("p", "simple-about-copy", t("simple.aboutCopy")));
  return view;
}

function simpleContent() {
  const section = el("section", "simple-content");
  const views = {
    home: simpleHomeView,
    connectivity: simpleConnectivityView,
    settings: simpleSettingsView,
    profile: simpleProfileView,
    about: simpleAboutView
  };
  const renderView = views[state.view] || simpleConnectivityView;
  section.append(renderView());
  return section;
}

function logDockHandlers() {
  return {
    onTabChange: async (tab) => {
      state.logWidget.tab = tab;
      localStorage.setItem(LOG_WIDGET_TAB_KEY, tab);
      if (tab === "console") await pollConsoleLogs(state);
      render();
    },
    onToggleCollapse: () => {
      state.logWidget.collapsed = !state.logWidget.collapsed;
      localStorage.setItem(LOG_WIDGET_COLLAPSED_KEY, state.logWidget.collapsed ? "1" : "0");
      render();
    },
    onCopyConsoleEntry: async (entry) => {
      const text = [
        entry.command,
        entry.stdout,
        entry.stderr
      ].filter(Boolean).join("\n");
      await copyText(t("logWidget.copied"), text);
    },
    renderDiagnostics: () => diagnosticsPanels()
  };
}

function appendLogDock(parent) {
  parent.append(renderLogDock(state, logDockHandlers()));
}

function simpleShell() {
  document.body.classList.add("simple-ui");
  const root = el("div", "simple-shell");
  const sidebar = el("nav", "simple-sidebar");
  sidebar.innerHTML = `
    <div class="simple-brand" aria-hidden="true"><span></span></div>
  `;
  simpleNavItems.forEach(([id, labelKey, icon]) => {
    const button = el("button", `simple-nav-item ${state.view === id ? "active" : ""}`);
    button.innerHTML = `<span class="simple-nav-icon" aria-hidden="true">${icon}</span><span class="simple-nav-label">${t(labelKey)}</span>`;
    button.setAttribute("aria-label", t(labelKey));
    button.setAttribute("data-nav", id);
    button.onclick = () => {
      state.view = id;
      render();
      if (id === "profile") loadAccount(false).then(() => render());
      if (id === "about") loadSimpleAbout().then(() => render());
    };
    sidebar.append(button);
  });
  const main = el("div", "simple-main");
  main.append(simpleContent());
  appendLogDock(main);
  root.append(sidebar, main);
  return root;
}

async function loadSimpleAbout() {
  if (state.version) return;
  try {
    const response = await apiFetch("/api/version");
    state.version = await response.json();
  } catch (error) {
    state.error = error.message;
  }
}

function shell() {
  document.body.classList.remove("simple-ui");
  const root = el("div", "window-shell");
  root.append(header());

  const body = el("main", "app-body");
  const nav = el("nav", "sidebar");
  navItems.forEach(([id, labelKey, icon, tipKey]) => {
    const button = el("button", `nav-item ${state.view === id ? "active" : ""}`);
    button.innerHTML = `<span class="nav-icon" aria-hidden="true">${icon}</span><span>${t(labelKey)}</span>`;
    button.setAttribute("aria-label", t(labelKey));
    button.setAttribute("data-nav", id);
    if (tipKey) applyTip(button, tipKey);
    button.onclick = () => {
      state.view = id;
      render();
      if (id === "app") loadAppPanel();
      if (id === "account") {
        loadAccount().then(() => render());
      }
      if (id === "settings") {
        loadKillSwitch(false).then(() => render());
      }
    };
    nav.append(button);
  });

  body.append(nav, mainColumn());
  root.append(body);
  return root;
}

function mainColumn() {
  const column = el("div", "main-column");
  column.append(content());
  appendLogDock(column);
  return column;
}

function header() {
  const node = el("header", "titlebar");
  node.innerHTML = `
    <div class="brand">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div>
        <div class="brand-title">${t("brand.title")}</div>
        <div class="brand-subtitle">${t("brand.subtitle")}</div>
      </div>
    </div>
    <div class="window-actions">
      <div class="live-pill ${state.live.connected ? "online" : "offline"}">
        <span></span>${state.live.connected ? t("common.live") : t("common.polling")}
      </div>
      <button type="button" class="connection-toggle header-connection-toggle" data-header-connection-toggle data-testid="header-connection-toggle" tabindex="0"></button>
      <button type="button" class="ghost icon-button tip" data-refresh data-testid="refresh-button" aria-label="${escapeHtml(t("common.refresh"))}" data-tip="${escapeHtml(t("common.refresh"))}" tabindex="0">↻</button>
      <div class="traffic-dots"><i></i><i></i><i></i></div>
    </div>
  `;
  wireConnectionToggle(node.querySelector("[data-header-connection-toggle]"));
  node.querySelector("[data-refresh]").onclick = refresh;
  return node;
}

function content() {
  if (state.view === "diagnostics") {
    state.view = "home";
    openLogDockTab(state, "diagnostics");
  }
  const section = el("section", "content");
  const views = {
    home: homeView,
    account: accountView,
    gateway: gatewayView,
    tunnel: tunnelView,
    split: splitView,
    trusted: trustedView,
    settings: settingsView,
    app: appView,
    advanced: advancedView
  };
  section.append((views[state.view] || homeView)());
  return section;
}

function tipMarkup(key) {
  const text = tip(key);
  if (!text || text.startsWith("tips.")) return "";
  return ` class="tip" data-tip="${escapeHtml(text)}" tabindex="0"`;
}

function tipDataAttrs(key) {
  const text = tip(key);
  if (!text || text.startsWith("tips.")) return "";
  return ` data-tip="${escapeHtml(text)}" tabindex="0"`;
}

function tipClass(key, base = "") {
  const text = tip(key);
  const has = Boolean(text && !text.startsWith("tips."));
  return [base, has ? "tip" : ""].filter(Boolean).join(" ");
}

function applyTip(node, key) {
  const text = tip(key);
  if (!node || !text || text.startsWith("tips.")) return node;
  node.classList.add("tip");
  node.setAttribute("data-tip", text);
  if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
  return node;
}

const modeValueTips = {
  warp: "modeWarp",
  doh: "modeDoh",
  "warp+doh": "modeWarpDoh",
  dot: "modeDot",
  "warp+dot": "modeWarpDot",
  proxy: "modeProxy",
  tunnel_only: "modeTunnelOnly"
};

const familiesValueTips = {
  off: "familiesOff",
  malware: "familiesMalware",
  full: "familiesFull"
};

const protocolValueTips = {
  MASQUE: "protocolMasque",
  WireGuard: "protocolWireGuard"
};

function pageTitle(title, copy, tipKey = "") {
  return el("div", "page-title", `<h1${tipMarkup(tipKey)}>${title}</h1><p>${copy}</p>`);
}

function readinessBanner() {
  const items = readinessAttentionItems();
  if (!items.length) return null;
  const panel = el("section", "panel readiness-panel");
  panel.setAttribute("data-testid", "readiness-banner");
  const hard = items.some((item) => item.hardBlocker);
  panel.innerHTML = `
    <div class="panel-heading">
      <h3>${hard ? t("home.readinessBlockedTitle") : t("home.readinessAttentionTitle")}</h3>
      <span>${hard ? t("home.readinessBlockedBadge") : t("home.readinessAttentionBadge")}</span>
    </div>
    <ul class="readiness-list"></ul>
  `;
  const list = panel.querySelector(".readiness-list");
  items.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.nextStep || item.detail || "")}`;
    list.append(li);
  });
  return panel;
}

async function copyDiagnostics() {
  try {
    const response = await apiFetch("/api/diagnostics");
    const body = await response.json();
    if (!response.ok || !body.text) throw new Error(body.error || "Diagnostics unavailable");
    await copyText(t("home.diagnosticsCopied"), body.text);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function homeView() {
  const grid = el("div", "view-stack");
  grid.append(pageTitle(t("home.title"), t("home.copy"), "pageHome"));

  const layout = el("div", "home-grid");
  const primary = el("section", "hero-panel panel");
  const toggle = connectionToggle();
  const heroMessage = toggle.reason
    || state.snapshot?.daemon?.message
    || t("common.loading");
  primary.innerHTML = `
    <div class="status-orb ${statusKind()}"><span></span></div>
    <div class="hero-copy">
      <div class="status-label tip" data-tip="${escapeHtml(tip("liveStatus"))}" tabindex="0">${statusText()}</div>
      <h2 class="tip" data-tip="${escapeHtml(tip("daemon"))}" tabindex="0">${readinessHardBlocked() ? t("home.daemonMissing") : t("home.tunnelControls")}</h2>
      <p>${escapeHtml(heroMessage)}</p>
    </div>
    <div class="hero-actions">
      <button type="button" class="connection-toggle" data-connection-toggle data-testid="connection-toggle" tabindex="0"></button>
      <button type="button" class="secondary" data-copy-diagnostics data-testid="copy-diagnostics">${t("home.copyDiagnostics")}</button>
    </div>
  `;
  const toggleBtn = primary.querySelector("[data-connection-toggle]");
  wireConnectionToggle(toggleBtn);
  primary.querySelector("[data-copy-diagnostics]").onclick = () => copyDiagnostics();
  const quick = el("section", "panel quick-panel");
  quick.innerHTML = `<div class="panel-heading"><h3${tipMarkup("mode")}>${t("home.quickSettings")}</h3><span>${t("home.quickHint")}</span></div>`;
  quick.append(segmented(t("home.mode"), quickModes, "setMode", setting("Mode"), tip("mode"), modeValueTips, "Mode"));
  quick.append(segmented(t("home.protocol"), protocols, "setProtocol", setting("Tunnel protocol", "Protocol"), tip("protocol"), protocolValueTips, "Tunnel protocol|Protocol"));
  quick.append(segmented(t("home.families"), families, "setFamilies", setting("Families mode", "DNS families"), tip("families"), familiesValueTips, "Families mode|DNS families"));

  layout.append(primary, quick);
  const banner = readinessBanner();
  if (banner) grid.append(banner);
  grid.append(layout, killSwitchPanel(), metrics(), liveStatePanel(), outputPanel("Last command", state.lastAction, "rawOutput", "lastAction"));
  return grid;
}

function segmented(label, values, actionName, current, tipText = "", valueTips = null, settingKey = null) {
  const wrap = el("div", "field-group");
  const tipAttr = tipText ? ` class="tip" data-tip="${escapeHtml(tipText)}" tabindex="0"` : "";
  wrap.innerHTML = `<label${tipAttr}>${label}</label>`;
  const row = el("div", "segmented");
  if (settingKey) {
    row.setAttribute("data-setting-key", settingKey);
    row.setAttribute("data-testid", `segmented-${actionName}`);
  }
  values.forEach((value) => {
    const button = el("button", current?.toLowerCase?.() === value.toLowerCase() ? "selected" : "", value);
    button.setAttribute("data-value", value);
    button.type = "button";
    const tipKey = valueTips && (valueTips[value] || valueTips[String(value).toLowerCase()]);
    if (tipKey) applyTip(button, tipKey);
    button.onclick = () => {
      if (actionName === "setEnvironment") {
        action(value === "FedRAMP-High" ? "environmentFedramp" : "environmentNormal", undefined, undefined, true);
        return;
      }
      action(actionName, value);
    };
    row.append(button);
  });
  wrap.append(row);
  return wrap;
}

function choiceSegmented(label, choices, current, tipText = "") {
  const wrap = el("div", "field-group");
  const tipAttr = tipText ? ` class="tip" data-tip="${escapeHtml(tipText)}" tabindex="0"` : "";
  wrap.innerHTML = `<label${tipAttr}>${label}</label>`;
  const row = el("div", "segmented");
  choices.forEach(({ value, label: choiceLabel, action: actionName, confirm = false, tipKey }) => {
    const selected = current?.toLowerCase?.() === String(value).toLowerCase();
    const button = el("button", selected ? "selected" : "", choiceLabel);
    button.type = "button";
    if (tipKey) applyTip(button, tipKey);
    button.onclick = () => {
      if (confirm && !window.confirm(`Run warp-cli action: ${choiceLabel}?`)) return;
      action(actionName);
    };
    row.append(button);
  });
  wrap.append(row);
  return wrap;
}

function metrics() {
  const tunnel = state.snapshot?.parsed?.tunnel || {};
  const dns = state.snapshot?.parsed?.dns || {};
  const items = [
    ["Mode", setting("Mode"), "mode"],
    ["Protocol", tunnel.protocol || setting("Tunnel protocol", "Protocol"), "protocol"],
    ["Latency", tunnel.latency || "Unknown", "handshake"],
    ["Traffic", tunnel.sent && tunnel.received ? `${tunnel.sent} up / ${tunnel.received} down` : "Unknown", "loss"],
    ["DNS", dns.success ? `${dns.success} success` : "Unknown", "dnsQueries"],
    ["Generated", state.snapshot ? new Date(state.snapshot.generatedAt).toLocaleTimeString() : "Pending", "liveStatus"]
  ];
  const row = el("section", "metrics-row");
  items.forEach(([label, value, tipKey]) => {
    row.append(el("div", "metric", `<span${tipMarkup(tipKey)}>${label}</span><strong>${escapeHtml(String(value)).slice(0, 80)}</strong>`));
  });
  return row;
}

function liveStatePanel() {
  const tunnel = state.snapshot?.parsed?.tunnel || {};
  const dns = state.snapshot?.parsed?.dns || {};
  const panel = el("section", "panel state-panel");
  panel.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup("liveStatus")}>Current State</h3>
      <span>${state.live.lastEvent ? `event ${new Date(state.live.lastEvent).toLocaleTimeString()}` : "snapshot"}</span>
    </div>
    <div class="state-grid">
      ${stateDatum("Colo", tunnel.colo || "Unknown", "colo")}
      ${stateDatum("Handshake", tunnel.handshakeAge || "Unknown", "handshake")}
      ${stateDatum("Loss", tunnel.loss || "Unknown", "loss")}
      ${stateDatum("DNS queries", dns.queries || "Unknown", "dnsQueries")}
      ${stateDatum("DNS avg", dns.averageDuration || "Unknown", "dnsAvg")}
      ${stateDatum("Live event", state.live.lastLine || "Waiting", "liveStatus")}
      ${stateDatum("VNet", commandText("vnet"), "vnetMetric")}
    </div>
  `;
  return panel;
}

function stateDatum(label, value, tipKey = "") {
  return `<div class="${tipClass(tipKey, "state-datum")}"${tipDataAttrs(tipKey)}><span>${label}</span><strong>${escapeHtml(String(value)).slice(0, 96)}</strong></div>`;
}

function accountView() {
  const view = el("div", "view-stack account-view");
  const acct = state.account;
  view.append(pageTitle(t("account.title"), t("account.copy"), "pageAccount"));

  const overview = el("section", "panel account-overview account-status-strip");
  overview.innerHTML = `
    <div class="panel-heading">
      <h3 class="tip" data-tip="${escapeHtml(tip("accountOverview"))}" tabindex="0">${t("account.overview")}</h3>
      <span class="${acct?.registered ? "ok" : "fail"}">${acct?.registered ? t("account.registered") : t("account.notRegistered")}</span>
    </div>
    <p class="account-lede">${escapeHtml(t("account.lede"))}</p>
  `;
  if (state.accountLoading && !acct) {
    overview.append(el("p", "muted", t("common.loading")));
  } else if (acct) {
    const typeLabel = acct.accountType
      ? String(acct.accountType)
      : acct.registered
        ? t("common.unknown")
        : t("account.none");
    const badgeClass = !acct.registered ? "badge warn" : acct.consumer ? "badge ok" : "badge zt";
    const grid = el("div", "state-grid account-status-grid");
    grid.innerHTML = `
      <div class="state-datum tip" data-tip="${escapeHtml(tip("accountOverview"))}" tabindex="0"><span>${t("account.accountType")}</span><strong><span class="${badgeClass}">${escapeHtml(typeLabel)}</span></strong></div>
      <div class="state-datum tip" data-tip="${escapeHtml(tip("zeroTrust"))}" tabindex="0"><span>${t("account.organization")}</span><strong>${escapeHtml(acct.organization || t("account.none"))}</strong></div>
      <div class="state-datum tip" data-tip="${escapeHtml(tip("deviceId"))}" tabindex="0"><span>${t("account.deviceId")}</span><strong>${escapeHtml(shortId(acct.deviceId))}</strong></div>
      <div class="state-datum tip" data-tip="${escapeHtml(tip("accountId"))}" tabindex="0"><span>${t("account.accountId")}</span><strong>${escapeHtml(shortId(acct.accountId))}</strong></div>
    `;
    overview.append(grid);
  }
  view.append(overview);
  view.append(basicAccountPanel(acct));
  view.append(dangerPanel());

  const details = wireDetailsPanel(el("details", "account-raw"), "account-raw");
  details.innerHTML = `<summary class="tip" data-tip="${escapeHtml(tip("rawOutput"))}" tabindex="0">${t("account.rawOutput")}</summary>`;
  details.append(outputPanel(t("account.registrationRaw"), state.snapshot?.commands?.registration || acct?.commands?.registration, "rawOutput"));
  details.append(outputPanel(t("account.organizationRaw"), state.snapshot?.commands?.organization || acct?.commands?.organization, "rawOutput"));
  details.append(outputPanel(t("account.devicesRaw"), state.snapshot?.commands?.devices || acct?.commands?.devices, "devices"));
  view.append(details);
  return view;
}

function shortId(value) {
  if (!value) return t("account.none");
  const s = String(value);
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function basicAccountPanel(acct) {
  const panel = el("section", "panel account-section");
  panel.innerHTML = `
    <div class="panel-heading">
      <h3 class="tip" data-tip="${escapeHtml(tip("freePlan"))}" tabindex="0">${t("account.basicTitle")}</h3>
      <span>${t("account.basicHint")}</span>
    </div>
    <p class="muted">${escapeHtml(t("account.basicCopy"))}</p>
  `;

  const actions = el("div", "button-row");
  const registerBtn = el("button", "primary tip", t("account.registerFree"));
  registerBtn.setAttribute("data-tip", tip("registerFree"));
  registerBtn.setAttribute("data-testid", "account-register");
  registerBtn.onclick = () => action("register");
  actions.append(registerBtn);
  panel.append(actions);

  if (acct?.license) {
    const licenseBox = el("div", "license-box");
    const shown = state.revealLicense ? acct.license : maskLicense(acct.license);
    licenseBox.innerHTML = `
      <div class="panel-heading">
        <h4 class="tip" data-tip="${escapeHtml(tip("licenseKey"))}" tabindex="0">${t("account.yourLicense")}</h4>
        <span>${t("account.licenseHint")}</span>
      </div>
      <code class="license-value" data-testid="account-license">${escapeHtml(shown)}</code>
    `;
    const row = el("div", "button-row");
    const reveal = el("button", "secondary", state.revealLicense ? t("account.hideLicense") : t("account.revealLicense"));
    reveal.onclick = () => {
      state.revealLicense = !state.revealLicense;
      render();
    };
    const copy = el("button", "secondary tip", t("account.copyLicense"));
    copy.setAttribute("data-tip", tip("copyLicense"));
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(acct.license);
        state.toast = t("account.licenseCopied");
        render();
      } catch {
        state.error = t("account.copyFailed");
        render();
      }
    };
    row.append(reveal, copy);
    licenseBox.append(row);
    panel.append(licenseBox);
  }

  const licenseForm = el("label", "input-row");
  licenseForm.innerHTML = `
    <span class="tip" data-tip="${escapeHtml(tip("applyLicense"))}" tabindex="0">${t("account.applyLicenseLabel")}</span>
    <input value="${escapeHtml(state.forms.licenseKey)}" placeholder="${escapeHtml(t("account.licensePlaceholder"))}" autocomplete="off" spellcheck="false" data-testid="account-license-input" />
    <button class="secondary" data-testid="account-apply-license">${t("account.applyLicense")}</button>
  `;
  const licenseInput = licenseForm.querySelector("input");
  licenseInput.oninput = () => {
    state.forms.licenseKey = licenseInput.value;
  };
  licenseForm.querySelector("button").onclick = () => {
    if (!state.forms.licenseKey.trim()) return;
    action("applyLicense", state.forms.licenseKey.trim());
  };
  panel.append(licenseForm);

  if (acct?.consumer && Array.isArray(acct.devices) && acct.devices.length) {
    const devices = el("div", "devices-list");
    devices.innerHTML = `
      <div class="panel-heading">
        <h4 class="tip" data-tip="${escapeHtml(tip("devices"))}" tabindex="0">${t("account.devices")}</h4>
        <span>${acct.devices.length}</span>
      </div>
    `;
    const table = el("div", "device-table");
    acct.devices.forEach((device) => {
      const row = el("div", "device-row");
      const active = device.active ? t("account.active") : t("account.inactive");
      row.innerHTML = `
        <strong>${escapeHtml(device.name || device.model || t("account.unnamedDevice"))}</strong>
        <span>${escapeHtml(device.os || t("common.unknown"))}</span>
        <span class="${device.active ? "ok" : "muted"}">${escapeHtml(active)}</span>
        <code>${escapeHtml(shortId(device.deviceId))}</code>
      `;
      table.append(row);
    });
    devices.append(table);
    panel.append(devices);
  }

  const advanced = wireDetailsPanel(el("details", "account-advanced"), "account-advanced");
  advanced.innerHTML = `<summary class="tip" data-tip="${escapeHtml(tip("zeroTrust"))}" tabindex="0">${t("account.advancedZt")}</summary>`;
  const advBody = el("div", "account-advanced-body");
  advBody.append(el("p", "muted", t("account.advancedZtCopy")));

  const teamForm = el("label", "input-row");
  teamForm.innerHTML = `
    <span class="tip" data-tip="${escapeHtml(tip("teamName"))}" tabindex="0">${t("account.teamName")}</span>
    <input value="${escapeHtml(state.forms.organization)}" placeholder="${escapeHtml(t("account.teamPlaceholder"))}" autocomplete="off" spellcheck="false" />
    <button class="secondary">${t("account.enrollTeam")}</button>
  `;
  const teamInput = teamForm.querySelector("input");
  teamInput.oninput = () => {
    state.forms.organization = teamInput.value;
  };
  teamForm.querySelector("button").onclick = () => {
    const team = state.forms.organization.trim().toLowerCase();
    if (!team) return;
    action("registerOrganization", team, null, true);
  };
  advBody.append(teamForm);

  const tokenForm = el("label", "input-row token-row");
  tokenForm.innerHTML = `
    <span class="tip" data-tip="${escapeHtml(tip("authToken"))}" tabindex="0">${t("account.authToken")}</span>
    <input value="${escapeHtml(state.forms.authToken)}" placeholder="${escapeHtml(t("account.tokenPlaceholder"))}" autocomplete="off" spellcheck="false" />
    <button class="secondary">${t("account.completeToken")}</button>
  `;
  const tokenInput = tokenForm.querySelector("input");
  tokenInput.oninput = () => {
    state.forms.authToken = tokenInput.value;
  };
  tokenForm.querySelector("button").onclick = () => {
    if (!state.forms.authToken.trim()) return;
    action("registrationToken", state.forms.authToken.trim(), null, true);
  };
  advBody.append(tokenForm);

  const docsZt = el("p", "account-docs muted");
  docsZt.innerHTML = `${escapeHtml(t("account.docsPrefix"))} <a href="https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/" target="_blank" rel="noopener noreferrer">${escapeHtml(t("account.docsZt"))}</a>`;
  advBody.append(docsZt);
  advanced.append(advBody);
  panel.append(advanced);

  const docs = el("p", "account-docs muted");
  docs.innerHTML = `${escapeHtml(t("account.docsPrefix"))} <a href="https://developers.cloudflare.com/warp-client/get-started/linux/" target="_blank" rel="noopener noreferrer">${escapeHtml(t("account.docsLinux"))}</a>`;
  panel.append(docs);
  return panel;
}

function dangerPanel() {
  const panel = el("section", "panel account-section danger-zone");
  panel.innerHTML = `
    <div class="panel-heading">
      <h3 class="tip" data-tip="${escapeHtml(tip("dangerZone"))}" tabindex="0">${t("account.dangerTitle")}</h3>
      <span>${t("account.dangerHint")}</span>
    </div>
    <p class="muted">${escapeHtml(t("account.dangerCopy"))}</p>
  `;
  const row = el("div", "button-row");
  const rotate = el("button", "secondary tip", t("account.rotateKeys"));
  rotate.setAttribute("data-tip", tip("rotateKeys"));
  rotate.onclick = () => {
    if (!window.confirm(t("account.confirmRotate"))) return;
    action("rotateKeys");
  };
  const del = el("button", "secondary danger tip", t("account.deleteRegistration"));
  del.setAttribute("data-tip", tip("deleteRegistration"));
  del.setAttribute("data-testid", "account-delete");
  del.onclick = () => {
    if (!window.confirm(t("account.confirmDelete"))) return;
    action("deleteRegistration");
  };
  row.append(rotate, del);
  panel.append(row);
  return panel;
}

function maskLicense(value) {
  const s = String(value || "");
  if (s.length < 8) return "••••••••";
  return `${s.slice(0, 4)}${"•".repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

function gatewayView() {
  const view = el("div", "view-stack");
  view.append(pageTitle("Gateway DNS", "Control DNS mode, Families filtering, logging visibility, and Gateway status.", "pageGateway"));
  view.append(segmented("Families mode", families, "setFamilies", setting("Families mode", "DNS families"), tip("families"), familiesValueTips, "Families mode|DNS families"));
  view.append(formPanel("Gateway and fallback domains", [
    ["Gateway ID", "gatewayId", "Set Gateway ID", () => action("setGatewayId", state.forms.gatewayId, null, true), "gatewayId"],
    ["Fallback domain", "dnsFallback", "Add fallback", () => action("addDnsFallback", state.forms.dnsFallback), "dnsFallback"]
  ]));
  view.append(actionPanel("Gateway actions", [["Reset Gateway ID", "resetGatewayId", "resetGatewayId"]]));
  view.append(choiceSegmented("DNS logging", [
    { value: "disabled", label: "Off", action: "dnsLogDisable", tipKey: "dnsLog" },
    { value: "enabled", label: "On", action: "dnsLogEnable", tipKey: "dnsLog" }
  ], setting("DNS logging"), tip("dnsLog")));
  view.append(outputPanel("Fallback domains", state.snapshot?.commands?.dnsFallback, "dnsFallback"));
  view.append(outputPanel("DNS statistics", state.snapshot?.commands?.dnsStats, "dnsQueries"));
  view.append(outputPanel("Default fallbacks", state.snapshot?.commands?.dnsDefaultFallbacks, "dnsFallback"));
  view.append(outputPanel("Settings", state.snapshot?.commands?.settings, "pageSettings"));
  return view;
}

function splitRoutingStatusBanner() {
  const st = splitTunnelState();
  const connected = Boolean(state.snapshot?.status?.connected);
  const badge = connectionBadge();
  const panel = el("section", "panel routing-status-banner");
  panel.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup("splitTunnel")}>${t("splitGuide.statusTitle")}</h3>
      <span class="status-badge ${badge.kind}">${escapeHtml(badge.text)}</span>
    </div>
    <div class="routing-status-grid">
      <div class="routing-status-item">
        <span class="routing-status-label">${t("simple.connectionStatus")}</span>
        <strong>${escapeHtml(statusText())}</strong>
      </div>
      <div class="routing-status-item">
        <span class="routing-status-label routing-mode-label${tipMarkup("splitTunnel")}">${t("splitGuide.statusTitle")}</span>
        <span class="routing-mode-badge mode-${escapeHtml(st.mode)}">${escapeHtml(splitModeLabel(st.mode))}</span>
      </div>
      <div class="routing-status-item">
        <span class="routing-status-label">${t("splitGuide.routeCounts", { ipCount: st.ips.length, hostCount: st.hosts.length })}</span>
      </div>
    </div>
    ${!connected ? `<p class="routing-hint">${t("splitGuide.connectFirst")}</p>` : ""}
    <p class="routing-hint">${t("splitGuide.modeReadOnlyHint")}</p>
    ${st.managedHint ? `<p class="routing-hint managed">${escapeHtml(st.managedHint)}</p>` : ""}
  `;
  return panel;
}

function routingScenarioCard({ id, title, summary, steps, note, active }) {
  const card = el("section", `panel routing-scenario${active ? " is-active" : ""}`);
  card.id = id;
  card.innerHTML = `
    <div class="routing-scenario-head">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(summary)}</p>
    </div>
    <ol class="routing-steps">
      ${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
    </ol>
    ${note ? `<p class="routing-note">${escapeHtml(note)}</p>` : ""}
  `;
  return card;
}

function routeListPanel(title, items, removeAction, tipKey) {
  const panel = el("section", "panel route-list-panel");
  panel.innerHTML = `<div class="panel-heading"><h3${tipMarkup(tipKey)}>${escapeHtml(title)}</h3><span>${items.length}</span></div>`;
  if (!items.length) {
    panel.append(el("p", "routing-empty", t("splitGuide.noRoutes")));
    return panel;
  }
  const list = el("div", "route-list");
  items.forEach((value) => {
    const row = el("div", "route-row");
    row.innerHTML = `<code>${escapeHtml(value)}</code>`;
    const btn = el("button", "secondary danger", t("splitGuide.removeRoute"));
    btn.type = "button";
    btn.disabled = state.busy;
    btn.onclick = () => action(removeAction, value);
    row.append(btn);
    list.append(row);
  });
  panel.append(list);
  return panel;
}

function collapsedOutputPanel(title, result, tipKey, panelId = null, outputKey = null) {
  const id = panelId || `collapsed-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const details = wireDetailsPanel(el("details", "panel output-panel-collapsed"), id);
  const ok = result?.ok;
  const output = result ? (result.stdout || result.stderr || "No output.") : "No command has run yet.";
  details.innerHTML = `
    <summary${tipMarkup(tipKey)}>${escapeHtml(title)} <span class="${ok ? "ok" : "fail"}">${result ? (ok ? "ok" : `exit ${result.code ?? "error"}`) : "waiting"}</span></summary>
    <pre>${escapeHtml(output)}</pre>
  `;
  if (outputKey) details.setAttribute("data-output-key", outputKey);
  return details;
}

function appRoutingPanel() {
  const isProxy = isProxyMode();
  const panel = el("section", "panel guide-panel app-routing-panel");
  panel.id = "app-routing-guide";
  panel.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup("pageSplit")}>${t("appRouting.title")}</h3>
      <span>${isProxy ? t("tunnelGuide.proxyModeLabel") : t("appRouting.inactive")}</span>
    </div>
    <p class="guide-lede">${t("appRouting.summary")}</p>
  `;

  const steps = el("ol", "routing-steps");
  steps.innerHTML = `
    <li class="${isProxy ? "done" : ""}">${t("appRouting.stepEnable")}</li>
    <li class="${isProxy ? "active" : ""}">${t("appRouting.stepPick")}</li>
    <li>${t("appRouting.stepLaunch")}</li>
  `;
  panel.append(steps);

  const actions = el("div", "app-routing-actions");
  if (!isProxy) {
    const enableBtn = el("button", "primary", t("appRouting.enableRouting"));
    enableBtn.type = "button";
    enableBtn.disabled = state.busy;
    enableBtn.setAttribute("data-testid", "app-routing-enable");
    enableBtn.onclick = () => enableLocalProxy();
    actions.append(enableBtn);
  } else {
    panel.append(el("p", "routing-hint ok", t("appRouting.proxyActive")));
    const pickRow = el("div", "field-row app-routing-pick");
    pickRow.innerHTML = `<label>${t("appRouting.pickApp")}</label>`;
    const select = el("select", "app-routing-select");
    select.setAttribute("data-testid", "app-routing-select");
    select.disabled = state.busy || state.desktopApps.loading;
    if (state.desktopApps.loading) {
      select.append(el("option", "", t("appRouting.loadingApps")));
    } else if (!state.desktopApps.list.length) {
      select.append(el("option", "", t("appRouting.noApps")));
    } else {
      for (const app of state.desktopApps.list) {
        const option = el("option", "", app.name);
        option.value = app.id;
        if (app.id === state.desktopApps.selectedId) option.selected = true;
        select.append(option);
      }
    }
    select.onchange = () => {
      state.desktopApps.selectedId = select.value;
    };
    pickRow.append(select);
    actions.append(pickRow);
    const shortcutBtn = el("button", "secondary", t("appRouting.createShortcut"));
    shortcutBtn.type = "button";
    shortcutBtn.setAttribute("data-testid", "app-routing-shortcut");
    shortcutBtn.disabled = state.busy || state.desktopApps.loading || !state.desktopApps.list.length;
    shortcutBtn.onclick = () => createAppShortcut();
    actions.append(shortcutBtn);
  }
  panel.append(actions);
  return panel;
}

function splitRoutingGuidePanel() {
  const st = splitTunnelState();
  const panel = el("div", "routing-scenarios");

  panel.append(routingScenarioCard({
    id: "routing-scenario-exclude",
    title: t("splitGuide.scenario1Title"),
    summary: t("splitGuide.scenario1Summary"),
    steps: [
      t("splitGuide.scenario1Step1"),
      t("splitGuide.scenario1Step2"),
      t("splitGuide.scenario1Step3")
    ],
    note: t("splitGuide.scenario1AppNote"),
    active: st.mode === "exclude"
  }));

  panel.append(routingScenarioCard({
    id: "routing-scenario-include",
    title: t("splitGuide.scenario2Title"),
    summary: t("splitGuide.scenario2Summary"),
    steps: [
      t("splitGuide.scenario2Step1"),
      t("splitGuide.scenario2Step2"),
      t("splitGuide.scenario2Step3")
    ],
    active: st.mode === "include"
  }));

  panel.append(routingScenarioCard({
    id: "routing-scenario-proxy",
    title: t("splitGuide.scenario3Title"),
    summary: t("splitGuide.scenario3Summary"),
    steps: [
      t("splitGuide.scenario3Step1"),
      t("splitGuide.scenario3Step2"),
      t("splitGuide.scenario3Step3")
    ],
    note: t("splitGuide.scenario3Example"),
    active: isProxyMode()
  }));

  const wrap = el("section", "panel guide-panel routing-guide-panel");
  wrap.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup("pageSplit")}>${t("splitGuide.title")}</h3>
      <span>guide</span>
    </div>
    <p class="guide-link"><a href="https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/split-tunnels/" target="_blank" rel="noopener noreferrer">${t("splitGuide.docsLink")}</a></p>
  `;
  wrap.prepend(appRoutingPanel());
  wrap.append(panel);
  return wrap;
}

function tunnelProxyGuidePanel() {
  const isProxy = isProxyMode();
  const port = proxyPortValue();
  const proxyUrl = `127.0.0.1:${port}`;
  const panel = el("section", "panel guide-panel tunnel-proxy-panel");
  panel.id = "tunnel-proxy-guide";

  if (isProxy) {
    panel.innerHTML = `
      <div class="panel-heading">
        <h3${tipMarkup("modeProxy")}>${t("tunnelGuide.proxyActiveTitle")}</h3>
        <span class="routing-mode-badge mode-proxy">${t("tunnelGuide.proxyModeLabel")}</span>
      </div>
      <p>${t("tunnelGuide.proxyActiveSummary")}</p>
      <div class="proxy-listen-row">
        <code class="proxy-listen">${escapeHtml(proxyUrl)}</code>
        <button type="button" class="secondary" data-copy-proxy>${t("tunnelGuide.proxyCopy")}</button>
      </div>
      <p class="routing-hint">${t("tunnelGuide.proxyMasqueNote")}</p>
      <ol class="routing-steps">
        <li>${t("tunnelGuide.proxyStep1")}</li>
        <li>${t("tunnelGuide.proxyStep2")}</li>
        <li>${t("tunnelGuide.proxyStep3")}</li>
      </ol>
      <p class="routing-note">${t("splitGuide.scenario3Example", { port })}</p>
    `;
    panel.querySelector("[data-copy-proxy]").onclick = () => copyText(t("tunnelGuide.proxyCopied"), proxyUrl);
    return panel;
  }

  panel.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup("modeProxy")}>${t("tunnelGuide.proxyTeaserTitle")}</h3>
      <span>guide</span>
    </div>
    <p>${t("tunnelGuide.proxyTeaserSummary")}</p>
    <button type="button" class="secondary" data-enable-proxy data-testid="tunnel-enable-proxy">${t("tunnelGuide.enableProxyMode")}</button>
  `;
  panel.querySelector("[data-enable-proxy]").onclick = () => enableLocalProxy();
  return panel;
}

function tunnelView() {
  const view = el("div", "view-stack");
  view.append(pageTitle("Tunnel", "Switch WARP modes, tunnel protocols, proxy port, and virtual network.", "pageTunnel"));
  view.append(tunnelProxyGuidePanel());
  view.append(segmented("Operating mode", quickModes, "setMode", setting("Mode"), tip("mode"), modeValueTips, "Mode"));
  view.append(segmented("Preferred protocol", protocols, "setProtocol", setting("Tunnel protocol", "Protocol"), tip("protocol"), protocolValueTips, "Tunnel protocol|Protocol"));
  view.append(segmented("MASQUE options", masqueOptions, "setMasqueOptions", setting("MASQUE options"), tip("masque"), null, "MASQUE options"));
  view.append(formPanel("Proxy and VNet", [
    ["SOCKS proxy port", "proxyPort", "Set proxy port", () => action("setProxyPort", state.forms.proxyPort), "proxyPort"],
    ["Virtual network", "vnet", "Set VNet", () => action("setVnet", state.forms.vnet), "vnet"],
    ["Endpoint IP:port", "endpoint", "Set endpoint", () => action("setEndpoint", state.forms.endpoint, null, true), "endpoint"]
  ]));
  view.append(actionPanel("Tunnel actions", [
    ["Reset protocol", "resetProtocol", "resetProtocol"],
    ["Reset MASQUE options", "resetMasqueOptions", "resetMasqueOptions"],
    ["Reset endpoint", "resetEndpoint", "resetEndpoint"]
  ]));
  view.append(outputPanel("Tunnel statistics", state.snapshot?.commands?.tunnelStats, "handshake"));
  return view;
}

function splitView() {
  const st = splitTunnelState();
  const excludeMode = st.mode !== "include";
  const ipLabel = excludeMode ? t("splitGuide.addIpExclude") : t("splitGuide.addIpInclude");
  const hostLabel = excludeMode ? t("splitGuide.addHostExclude") : t("splitGuide.addHostInclude");

  const view = el("div", "view-stack");
  view.append(pageTitle("Split Tunnel", t("splitGuide.pageLede"), "pageSplit"));
  view.append(splitRoutingStatusBanner());
  view.append(splitRoutingGuidePanel());
  view.append(formPanel("Routes", [
    [ipLabel, "splitIp", "Add IP", () => action("addSplitIp", state.forms.splitIp), "splitIp"],
    [hostLabel, "splitHost", "Add host", () => action("addSplitHost", state.forms.splitHost), "splitHost"]
  ]));
  view.append(routeListPanel(t("splitGuide.ipRoutesTitle"), st.ips, "removeSplitIp", "splitIp"));
  view.append(routeListPanel(t("splitGuide.hostRoutesTitle"), st.hosts, "removeSplitHost", "splitHost"));
  view.append(actionPanel("Reset", [
    ["Reset IP routes", "resetSplitIps", "resetSplitIps"],
    ["Reset host routes", "resetSplitHosts", "resetSplitHosts"]
  ]));
  const advanced = el("section", "panel routing-advanced");
  advanced.innerHTML = `<div class="panel-heading"><h3>${t("splitGuide.advancedOutput")}</h3><span>warp-cli</span></div>`;
  advanced.append(collapsedOutputPanel("Routing dump", state.snapshot?.commands?.splitTunnelDump, "splitTunnel", "split-dump", "splitTunnelDump"));
  advanced.append(collapsedOutputPanel("IP routes (raw)", state.snapshot?.commands?.splitTunnelIps, "splitIp", "split-ips-raw", "splitTunnelIps"));
  advanced.append(collapsedOutputPanel("Host routes (raw)", state.snapshot?.commands?.splitTunnelHosts, "splitHost", "split-hosts-raw", "splitTunnelHosts"));
  view.append(advanced);
  return view;
}

function diagnosticsPanels() {
  const stack = el("div", "log-diagnostics-stack");
  stack.append(metrics());
  stack.append(outputPanel("Connection status", state.snapshot?.commands?.status, "liveStatus", "status"));
  stack.append(outputPanel("WARP stats", state.snapshot?.commands?.stats, "handshake", "stats"));
  stack.append(outputPanel("Network", state.snapshot?.commands?.network, "networkDebug", "network"));
  stack.append(outputPanel("Posture", state.snapshot?.commands?.posture, "posture", "posture"));
  stack.append(outputPanel("DEX", state.snapshot?.commands?.dex, "dex", "dex"));
  stack.append(actionPanel("Identity and logs", [["Refresh Access auth", "accessReauth", "accessReauth"]]));
  stack.append(outputPanel("Administrative override", state.snapshot?.commands?.override, "overrideShow", "override"));
  stack.append(outputPanel("Local network override", state.snapshot?.commands?.localNetworkOverride, "localNetworkOverride", "localNetworkOverride"));
  return stack;
}

function settingsView() {
  const view = el("div", "view-stack");
  view.append(pageTitle("WARP Settings", "General WARP client settings and administrative controls.", "pageSettings"));
  view.append(killSwitchPanel());
  view.append(segmented("Compliance environment", ["Normal", "FedRAMP-High"], "setEnvironment", setting("Compliance Environment"), tip("environment")));
  view.append(formPanel("Administrative override", [
    ["Override code", "overrideCode", "Apply code", () => action("overrideCode", state.forms.overrideCode, null, true), "overrideCode"],
    ["Unlock code", "overrideCode", "Unlock", () => action("overrideUnlock", state.forms.overrideCode, null, true), "overrideUnlock"]
  ]));
  view.append(choiceSegmented("Local network access", [
    { value: "blocked", label: "Blocked", action: "stopLocalNetworkOverride", tipKey: "stopLocalNetworkOverride" },
    { value: "allowed", label: "Allowed", action: "allowLocalNetwork", confirm: true, tipKey: "allowLocalNetwork" }
  ], setting("Local network access"), tip("localNetworkOverride")));
  view.append(actionPanel("General", [
    ["Reset environment", "environmentReset", "environmentReset"],
    ["Reset all settings", "resetSettings", "resetSettings"]
  ]));
  view.append(outputPanel("Settings list", state.snapshot?.commands?.settings, "pageSettings"));
  view.append(outputPanel("Support URL", state.snapshot?.commands?.supportUrl, "supportUrl"));
  view.append(outputPanel("Mode switch policy", state.snapshot?.commands?.modeSwitchAllowed, "modeSwitchAllowed"));
  view.append(outputPanel("MDM configs", state.snapshot?.commands?.mdm, "mdm"));
  view.append(outputPanel("Alternate network", state.snapshot?.commands?.alternateNetwork, "networkDebug"));
  return view;
}

function appView() {
  const view = el("div", "view-stack");
  view.append(pageTitle(t("app.title"), t("app.copy"), "pageApp"));

  const general = el("section", "panel");
  general.innerHTML = `<div class="panel-heading"><h3${tipMarkup("locale")}>${t("app.general")}</h3><span>locale</span></div>`;
  const localeRow = el("label", "input-row");
  localeRow.innerHTML = `<span class="tip" data-tip="${escapeHtml(tip("locale"))}" tabindex="0">${t("app.locale")}</span><select data-locale><option value="en">English</option></select><button class="secondary" data-save-locale>${t("common.save")}</button>`;
  localeRow.querySelector("[data-locale]").value = getLocale();
  localeRow.querySelector("[data-save-locale]").onclick = async () => {
    const next = localeRow.querySelector("[data-locale]").value;
    await apiFetch("/api/config/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ui: { locale: next } } })
    });
    await loadLocale(next);
    render();
  };
  general.append(localeRow);

  const webuiEnabled = state.health?.webuiEnabled === true;
  const effectivePort = state.health?.effectivePort ?? state.appConfig?.server?.port ?? "…";
  const daemonPanel = el("section", "panel");
  daemonPanel.innerHTML = `<div class="panel-heading"><h3>${t("app.daemon")}</h3><span>HTTP</span></div>`;
  const daemonGrid = el("div", "state-grid");
  daemonGrid.innerHTML = `
    <div class="state-datum"><span>${t("app.webuiMode")}</span><strong>${escapeHtml(webuiEnabled ? t("app.webuiEnabled") : t("app.webuiApiOnly"))}</strong></div>
    <div class="state-datum"><span>${t("app.httpPort")}</span><strong>${escapeHtml(String(effectivePort))}</strong></div>
  `;
  daemonPanel.append(daemonGrid);
  if (isNativeShell()) {
    const settingsBtn = el("button", "secondary", t("app.openSystemSettings"));
    settingsBtn.type = "button";
    settingsBtn.dataset.testid = "open-system-settings";
    settingsBtn.onclick = () => openSystemSettings();
    daemonPanel.append(settingsBtn);
  } else {
    const hint = el("p", "panel-hint", t("app.webuiConfigHint"));
    daemonPanel.append(hint);
  }
  general.append(daemonPanel);
  general.append(desktopAppPanel({ withTips: true }));

  if (isNativeShell()) {
    const expertRow = el("div", "switch-row");
    expertRow.innerHTML = `
      <div class="switch-meta">
        <strong>${t("simple.expertMode")}</strong>
        <p>${t("simple.expertModeOffHint")}</p>
      </div>
    `;
    const expertToggle = el("button", "switch on");
    expertToggle.type = "button";
    expertToggle.setAttribute("role", "switch");
    expertToggle.setAttribute("aria-checked", "true");
    expertToggle.setAttribute("aria-label", t("simple.expertMode"));
    expertToggle.onclick = () => setExpertMode(false);
    expertRow.append(expertToggle);
    general.append(expertRow);
  }

  const about = el("section", "panel");
  const version = state.version?.version || "…";
  const format = state.version?.installFormat || "…";
  about.innerHTML = `
    <div class="panel-heading"><h3${tipMarkup("pageApp")}>${t("app.about")}</h3><span>ThirdFlare One</span></div>
    <div class="state-grid">
      <div class="state-datum"><span>${t("app.currentVersion")}</span><strong>${escapeHtml(version)}</strong></div>
      <div class="state-datum"><span>${t("app.installFormat")}</span><strong>${escapeHtml(format)}</strong></div>
    </div>
  `;

  view.append(general, updatesPanel(), about);
  return view;
}

function updatesPanel() {
  const panel = el("section", "panel updates-panel");
  const channel = state.appConfig?.updates?.channel || "stable";
  const source = state.appConfig?.updates?.source || { owner: "bodencrouch", repo: "thirdflare-one" };
  const owner = state.update.selectedOwner || source.owner;
  const repo = state.update.selectedRepo || source.repo;
  const result = state.update.result;
  const catalog = state.update.forks.length
    ? state.update.forks
    : [{ owner: source.owner, repo: source.repo, fullName: `${source.owner}/${source.repo}`, upstream: true, stars: null }];

  const owners = [...new Set(catalog.map((entry) => entry.owner).filter(Boolean))].sort((a, b) => {
    if (a === (state.update.upstream?.owner || source.owner)) return -1;
    if (b === (state.update.upstream?.owner || source.owner)) return 1;
    return a.localeCompare(b);
  });
  const reposForOwner = catalog
    .filter((entry) => entry.owner === owner)
    .sort((a, b) => {
      if (a.upstream) return -1;
      if (b.upstream) return 1;
      return (b.stars || 0) - (a.stars || 0) || a.repo.localeCompare(b.repo);
    });

  panel.innerHTML = `<div class="panel-heading"><h3 class="tip" data-tip="${escapeHtml(tip("checkUpdates"))}" tabindex="0">${t("app.updates")}</h3><span>${escapeHtml(`${owner}/${repo}`)}</span></div>`;

  const channelRow = el("div", "field-group");
  channelRow.innerHTML = `<label class="tip" data-tip="${escapeHtml(tip("channel"))}" tabindex="0">${t("app.channel")}</label>`;
  const channelSeg = el("div", "segmented");
  ["stable", "beta"].forEach((value) => {
    const button = el("button", channel === value ? "selected" : "", t(`app.${value}`));
    button.onclick = async () => {
      await saveUpdatePrefs({ channel: value });
      await runUpdateCheck();
    };
    channelSeg.append(button);
  });
  channelRow.append(channelSeg);

  const sourceGrid = el("div", "combo-grid");

  const ownerField = el("label", "combo-field");
  ownerField.innerHTML = `<span class="tip" data-tip="${escapeHtml(tip("sourceOwner"))}" tabindex="0">${t("app.sourceOwner")}</span>`;
  const ownerSelect = document.createElement("select");
  ownerSelect.className = "combo";
  ownerSelect.setAttribute("aria-label", t("app.sourceOwner"));
  owners.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === owner) option.selected = true;
    ownerSelect.append(option);
  });
  ownerSelect.onchange = async () => {
    state.update.selectedOwner = ownerSelect.value;
    const nextRepos = catalog.filter((entry) => entry.owner === ownerSelect.value);
    const preferred = nextRepos.find((entry) => entry.upstream) || nextRepos[0];
    state.update.selectedRepo = preferred?.repo || "";
    state.update.selectedTag = "";
    await applySelectedSource();
  };
  ownerField.append(ownerSelect);

  const repoField = el("label", "combo-field");
  repoField.innerHTML = `<span class="tip" data-tip="${escapeHtml(tip("sourceRepo"))}" tabindex="0">${t("app.sourceRepo")}</span>`;
  const repoSelect = document.createElement("select");
  repoSelect.className = "combo";
  repoSelect.setAttribute("aria-label", t("app.sourceRepo"));
  if (!reposForOwner.length) {
    const option = document.createElement("option");
    option.value = repo;
    option.textContent = repo;
    option.selected = true;
    repoSelect.append(option);
  } else {
    reposForOwner.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.repo;
      const star = entry.stars != null ? ` · ★${entry.stars}` : "";
      const mark = entry.upstream ? ` (${t("app.upstream")})` : "";
      option.textContent = `${entry.repo}${mark}${star}`;
      if (entry.repo === repo) option.selected = true;
      repoSelect.append(option);
    });
  }
  repoSelect.onchange = async () => {
    state.update.selectedRepo = repoSelect.value;
    state.update.selectedTag = "";
    await applySelectedSource();
  };
  repoField.append(repoSelect);

  const releaseField = el("label", "combo-field combo-field-wide");
  releaseField.innerHTML = `<span class="tip" data-tip="${escapeHtml(tip("release"))}" tabindex="0">${t("app.release")}</span>`;
  const releaseSelect = document.createElement("select");
  releaseSelect.className = "combo";
  releaseSelect.setAttribute("aria-label", t("app.release"));
  const channelDefault = document.createElement("option");
  channelDefault.value = "";
  channelDefault.textContent = t("app.channelDefault");
  if (!state.update.selectedTag) channelDefault.selected = true;
  releaseSelect.append(channelDefault);
  state.update.releases.forEach((release) => {
    const option = document.createElement("option");
    option.value = release.tag;
    const pre = release.prerelease ? ` · ${t("app.prerelease")}` : "";
    option.textContent = `${release.tag}${pre}`;
    if (release.tag === state.update.selectedTag) option.selected = true;
    releaseSelect.append(option);
  });
  releaseSelect.onchange = () => {
    state.update.selectedTag = releaseSelect.value;
    if (state.update.result && releaseSelect.value) {
      const release = state.update.releases.find((item) => item.tag === releaseSelect.value);
      if (release) {
        const latest = release.tag.replace(/^v/i, "");
        const current = state.update.result.current || "";
        const delta = compareLooseSemver(latest, current);
        state.update.result = {
          ...state.update.result,
          latest,
          release,
          downgrade: delta < 0,
          updateAvailable: delta > 0
        };
      }
    }
    render();
  };
  releaseField.append(releaseSelect);

  sourceGrid.append(ownerField, repoField, releaseField);

  const actions = el("div", "button-row");
  const refreshBtn = el("button", "secondary tip", t("common.refreshSources"));
  refreshBtn.setAttribute("data-tip", tip("refreshSources"));
  refreshBtn.tabIndex = 0;
  refreshBtn.onclick = () => loadUpdateCatalog({ force: true });
  const checkBtn = el("button", "primary tip", t("common.checkNow"));
  checkBtn.setAttribute("data-tip", tip("checkUpdates"));
  checkBtn.tabIndex = 0;
  checkBtn.onclick = () => runUpdateCheck();
  actions.append(refreshBtn, checkBtn);

  panel.append(channelRow, sourceGrid, actions);

  if (state.update.loadingCatalog || state.update.loadingReleases || state.update.checking) {
    panel.append(el("p", "muted", t("common.loading")));
  }

  if (result) {
    const card = el("div", "update-card");
    let statusText = t("app.upToDate");
    if (result.updateAvailable) statusText = t("app.updateAvailable", { version: result.latest });
    if (result.downgrade) statusText = t("app.downgradeWarn");
    card.append(el("strong", "", statusText));
    card.append(el("p", "update-source-line", `${result.source?.owner || owner}/${result.source?.repo || repo}`));
    card.append(el("p", "", result.release?.name || result.latest || ""));

    const notes = el("div", "release-notes");
    const body = result.release?.body || "";
    notes.innerHTML = body.trim()
      ? renderReleaseMarkdown(body)
      : `<p class="muted">${escapeHtml(t("app.releaseNotes"))}</p>`;
    card.append(notes);

    const cta = el("div", "button-row");
    if (result.installFormat === "appimage" && (result.updateAvailable || state.update.selectedTag)) {
      const applyBtn = el("button", "primary", t("common.apply"));
      applyBtn.onclick = () => {
        if (result.downgrade && !window.confirm("Selected release is older than the installed version. Continue?")) {
          return;
        }
        applySelectedUpdate();
      };
      cta.append(applyBtn);
    } else if (result.guidedCommands?.length) {
      const showBtn = el("button", "secondary", t("common.showCommands"));
      showBtn.onclick = () => {
        state.toast = result.guidedCommands.join("\n");
        render();
      };
      cta.append(showBtn);
    }
    card.append(cta);
    panel.append(card);
  }

  return panel;
}

function compareLooseSemver(a, b) {
  const pa = String(a).split(/[.+-]/).map((n) => Number(n) || 0);
  const pb = String(b).split(/[.+-]/).map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function applySelectedSource() {
  const owner = state.update.selectedOwner;
  const repo = state.update.selectedRepo;
  if (!owner || !repo) return;
  state.update.loadingReleases = true;
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/update/source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, repo })
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) {
      state.error = body.error || "Unable to set update source";
      state.update.loadingReleases = false;
      render();
      return;
    }
    state.appConfig = body.config;
    await loadReleases();
    await runUpdateCheck();
  } catch (error) {
    state.error = error.message;
    state.update.loadingReleases = false;
    render();
  }
}

async function saveUpdatePrefs(partial) {
  const response = await apiFetch("/api/config/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { updates: partial } })
  });
  const body = await response.json();
  state.appConfig = body.config;
}

async function setTrayAutostart(enabled) {
  state.busy = true;
  render();
  try {
    const response = await apiFetch("/api/config/tray-autostart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autostart: enabled })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || response.statusText);
    state.appConfig = body.config;
    state.toast = enabled ? t("app.trayAutostartOn") : t("app.trayAutostartOff");
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  render();
}

async function setTrayShell(shell) {
  state.busy = true;
  render();
  try {
    const response = await apiFetch("/api/config/tray-shell", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shell })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || response.statusText);
    state.appConfig = body.config;
    state.toast = shell === "cloudflare" ? t("app.desktopAppCloudflareOn") : t("app.desktopAppThirdflareOn");
    if (body.liveSwap && body.liveSwap.attempted === false) {
      state.toast = `${state.toast} ${t("app.desktopAppRestartHint")}`;
    }
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  render();
}

function desktopAppPanel({ withTips = false } = {}) {
  const tray = state.appConfig?.tray || {};
  const shell = tray.shell === "thirdflare" ? "thirdflare" : "cloudflare";
  const available = tray.cloudflareAvailable === true;
  const panel = el("section", "panel");

  const field = el("label", "combo-field");
  const label = withTips
    ? `<span class="tip" data-tip="${escapeHtml(tip("desktopApp"))}" tabindex="0">${t("app.desktopApp")}</span>`
    : `<strong>${t("app.desktopApp")}</strong>`;
  field.innerHTML = `${label}<p>${t("app.desktopAppHint")}</p>`;
  const select = document.createElement("select");
  select.className = "combo";
  select.setAttribute("aria-label", t("app.desktopApp"));
  select.disabled = state.busy;

  const cloudflare = document.createElement("option");
  cloudflare.value = "cloudflare";
  cloudflare.textContent = available
    ? t("app.desktopAppCloudflare")
    : `${t("app.desktopAppCloudflare")} (${t("app.desktopAppUnavailable")})`;
  cloudflare.disabled = !available;
  if (shell === "cloudflare") cloudflare.selected = true;
  select.append(cloudflare);

  const thirdflare = document.createElement("option");
  thirdflare.value = "thirdflare";
  thirdflare.textContent = t("app.desktopAppThirdflare");
  if (shell === "thirdflare" || !available) thirdflare.selected = true;
  select.append(thirdflare);

  select.onchange = () => setTrayShell(select.value);
  field.append(select);
  panel.append(field);

  if (!available) {
    panel.append(el("p", "panel-hint", t("app.desktopAppMissing")));
  }

  if ((tray.active || shell) === "thirdflare") {
    const trayAutostart = Boolean(tray.autostart);
    const trayRow = el("div", "switch-row");
    const autostartLabel = withTips
      ? `<strong class="tip" data-tip="${escapeHtml(tip("trayAutostart"))}" tabindex="0">${t("app.trayAutostart")}</strong>`
      : `<strong>${t("app.trayAutostart")}</strong>`;
    trayRow.innerHTML = `
      <div class="switch-meta">
        ${autostartLabel}
        <p>${t("app.trayAutostartHint")}</p>
      </div>
    `;
    const trayToggle = el("button", `switch ${trayAutostart ? "on" : ""}`);
    trayToggle.type = "button";
    trayToggle.setAttribute("role", "switch");
    trayToggle.setAttribute("aria-checked", trayAutostart ? "true" : "false");
    trayToggle.setAttribute("aria-label", t("app.trayAutostart"));
    trayToggle.disabled = state.busy;
    trayToggle.onclick = () => setTrayAutostart(!trayAutostart);
    trayRow.append(trayToggle);
    panel.append(trayRow);
  }

  return panel;
}

async function loadUpdateCatalog({ force = false } = {}) {
  if (state.update.forks.length && !force) return;
  state.update.loadingCatalog = true;
  render();
  try {
    const response = await apiFetch("/api/update/forks");
    const body = await response.json();
    state.update.upstream = body.upstream || null;
    state.update.forks = body.forks || [];
    const source = state.appConfig?.updates?.source || body.upstream;
    state.update.selectedOwner = source?.owner || body.upstream?.owner || "";
    state.update.selectedRepo = source?.repo || body.upstream?.repo || "";
  } catch (error) {
    state.error = error.message;
  }
  state.update.loadingCatalog = false;
  render();
}

async function loadAppPanel() {
  try {
    const [versionRes, configRes, healthRes] = await Promise.all([
      apiFetch("/api/version"),
      apiFetch("/api/config"),
      apiFetch("/api/health")
    ]);
    state.version = await versionRes.json();
    const configBody = await configRes.json();
    state.appConfig = configBody.config;
    state.health = await healthRes.json();
    const source = state.appConfig?.updates?.source;
    if (source) {
      state.update.selectedOwner = source.owner;
      state.update.selectedRepo = source.repo;
    }
  } catch (error) {
    state.error = error.message;
  }
  render();
  await loadUpdateCatalog();
  await loadReleases();
}

async function runUpdateCheck() {
  state.update.checking = true;
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/update/check");
    state.update.result = await response.json();
    if (state.update.result?.applyConfirmToken) {
      state.update.confirmToken = state.update.result.applyConfirmToken;
    }
    if (state.update.result?.source) {
      state.update.selectedOwner = state.update.result.source.owner;
      state.update.selectedRepo = state.update.result.source.repo;
    }
  } catch (error) {
    state.error = error.message;
  }
  state.update.checking = false;
  render();
}

async function loadForks() {
  await loadUpdateCatalog({ force: true });
}

async function loadReleases() {
  state.update.loadingReleases = true;
  try {
    const owner = state.update.selectedOwner;
    const repo = state.update.selectedRepo;
    const query = owner && repo ? `?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}` : "";
    const response = await apiFetch(`/api/update/releases${query}`);
    const body = await response.json();
    state.update.releases = body.releases || [];
  } catch (error) {
    state.error = error.message;
  }
  state.update.loadingReleases = false;
  render();
}

async function applySelectedUpdate() {
  state.busy = true;
  render();
  try {
    const tag = state.update.selectedTag || undefined;
    const prepRes = await apiFetch("/api/update/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag })
    });
    const prep = await prepRes.json();
    if (prep.ok === false) {
      state.error = prep.error || "Prepare failed";
      state.busy = false;
      render();
      return;
    }
    if (prep.mode === "guided") {
      state.toast = (prep.commands || []).join("\n");
      state.busy = false;
      render();
      return;
    }
    const response = await apiFetch("/api/update/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tag,
        confirmToken: prep.applyConfirmToken || state.update.confirmToken
      })
    });
    const body = await response.json();
    if (body.mode === "guided") {
      state.toast = (body.commands || []).join("\n");
    } else if (body.applied) {
      state.toast = t("app.restartRequired");
    } else if (body.error) {
      state.error = body.error;
    }
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  render();
}

async function maybeStartupUpdateCheck() {
  try {
    const configRes = await apiFetch("/api/config");
    const configBody = await configRes.json();
    state.appConfig = configBody.config;
    if (!configBody.config?.updates?.checkOnStartup) return;
    const response = await apiFetch("/api/update/check");
    const result = await response.json();
    if (result.updateAvailable) {
      state.toast = t("app.updateAvailable", { version: result.latest });
      state.update.result = result;
      render();
    }
  } catch {
    // non-blocking
  }
}

function trustedView() {
  const view = el("div", "view-stack");
  view.append(pageTitle("Trusted networks", "Automatically disable WARP on trusted Wi-Fi, Ethernet, and named SSIDs when supported by the account.", "pageTrusted"));
  view.append(formPanel("Trusted SSIDs", [
    ["SSID", "trustedSsid", "Add SSID", () => action("addTrustedSsid", state.forms.trustedSsid), "trustedSsid"]
  ], "trustedNetworks"));
  view.append(choiceSegmented("On Wi-Fi", [
    { value: "keep", label: "Keep WARP on", action: "trustedWifiDisable", tipKey: "trustedWifiDisable" },
    { value: "disable", label: "Disable WARP", action: "trustedWifiEnable", confirm: true, tipKey: "trustedWifiEnable" }
  ], setting("Wi-Fi WARP"), tip("trustedNetworks")));
  view.append(choiceSegmented("On Ethernet", [
    { value: "keep", label: "Keep WARP on", action: "trustedEthernetDisable", tipKey: "trustedEthernetDisable" },
    { value: "disable", label: "Disable WARP", action: "trustedEthernetEnable", confirm: true, tipKey: "trustedEthernetEnable" }
  ], setting("Ethernet WARP"), tip("trustedNetworks")));
  view.append(actionPanel("SSID list", [
    ["Reset SSIDs", "resetTrustedSsids", "resetTrustedSsids"]
  ]));
  view.append(outputPanel("Trusted SSIDs", state.snapshot?.commands?.trustedSsids, "trustedSsid"));
  return view;
}

function advancedView() {
  const view = el("div", "view-stack");
  view.append(pageTitle("Advanced command center", "Run less common warp-cli commands without a shell and inspect raw output.", "pageAdvanced"));
  view.append(formPanel("Custom warp-cli arguments", [
    ["Arguments", "customCommand", "Run command", () => {
      if (!window.confirm(`Run warp-cli ${state.forms.customCommand}?`)) return;
      action("runCustom", state.forms.customCommand);
    }, "customCommand"]
  ]));
  view.append(outputPanel("Last command", state.lastAction, "rawOutput"));
  view.append(outputPanel("Certificates", state.snapshot?.commands?.certs, "certs"));
  view.append(outputPanel("Command coverage", {
    ok: true,
    code: 0,
    stdout: [
      "Mode: warp, doh, warp+doh, dot, warp+dot, proxy, tunnel_only",
      "Connection: connect, disconnect, status",
      "Registration: show, new, delete, organization, devices, license, token",
      "DNS: families, log, stats, default-fallbacks",
      "Tunnel: stats, dump, protocol, MASQUE options, endpoint, host/ip split tunnel, rotate-keys",
      "Zero Trust: vnet, MDM configs, support URL, mode switch policy, environment, overrides",
      "Trusted networks: Wi-Fi, Ethernet, SSID list/add/reset",
      "Diagnostics: stats, certs, network, posture, DEX, alternate network, Access reauth",
      "Use the custom arguments box for uncommon commands such as: debug speed-test, trusted ssid remove <name>, dns fallback remove <domain>"
    ].join("\\n")
  }, "pageAdvanced"));
  return view;
}

function actionPanel(title, actions, titleTipKey = "") {
  const panel = el("section", "panel action-panel");
  panel.innerHTML = `<div class="panel-heading"><h3${tipMarkup(titleTipKey)}>${title}</h3><span>warp-cli actions</span></div>`;
  const row = el("div", "button-row");
  actions.forEach(([label, actionName, tipKey]) => {
    const risky = /delete|reset|rotate|allow|stop|trusted|environment|unlock|override/i.test(actionName);
    const button = el("button", risky ? "secondary danger" : "secondary", label);
    if (tipKey) applyTip(button, tipKey);
    button.onclick = () => {
      if (risky && !window.confirm(`Run warp-cli action: ${label}?`)) return;
      action(actionName);
    };
    row.append(button);
  });
  panel.append(row);
  return panel;
}

function formPanel(title, fields, titleTipKey = "") {
  const panel = el("section", "panel form-panel");
  panel.innerHTML = `<div class="panel-heading"><h3${tipMarkup(titleTipKey)}>${title}</h3><span>editable values</span></div>`;
  fields.forEach(([label, key, buttonLabel, onSubmit, tipKey]) => {
    const row = el("label", "input-row");
    row.innerHTML = `<span${tipMarkup(tipKey)}>${label}</span><input value="${escapeHtml(state.forms[key])}" /><button class="secondary">${buttonLabel}</button>`;
    const input = row.querySelector("input");
    input.oninput = () => {
      state.forms[key] = input.value;
    };
    row.querySelector("button").onclick = onSubmit;
    panel.append(row);
  });
  return panel;
}

function outputPanel(title, result, tipKey = "", outputKey = null) {
  const panel = el("section", "panel output-panel");
  const ok = result?.ok;
  const output = result ? (result.stdout || result.stderr || "No output.") : "No command has run yet.";
  if (outputKey) panel.setAttribute("data-output-key", outputKey);
  panel.innerHTML = `
    <div class="panel-heading">
      <h3${tipMarkup(tipKey)}>${title}</h3>
      <span class="${ok ? "ok" : "fail"}">${result ? (ok ? "ok" : `exit ${result.code ?? "error"}`) : "waiting"}</span>
    </div>
    <pre>${escapeHtml(output)}</pre>
  `;
  return panel;
}

function renderReleaseMarkdown(raw) {
  const text = String(raw || "").slice(0, 4000);
  if (!text.trim()) return "";

  const lines = text.split(/\r?\n/);
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  const inline = (line) => {
    let html = escapeHtml(line);
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const href = /^https?:\/\//i.test(url.trim()) ? url.trim() : "#";
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    return html;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^### /.test(trimmed)) {
      closeList();
      out.push(`<h4>${inline(trimmed.slice(4))}</h4>`);
      continue;
    }
    if (/^## /.test(trimmed)) {
      closeList();
      out.push(`<h3>${inline(trimmed.slice(3))}</h3>`);
      continue;
    }
    if (/^# /.test(trimmed)) {
      closeList();
      out.push(`<h2>${inline(trimmed.slice(2))}</h2>`);
      continue;
    }
    if (/^[*-] /.test(trimmed)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(trimmed.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (!trimmed.trim()) continue;
    out.push(`<p>${inline(trimmed)}</p>`);
  }

  closeList();
  return out.join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function contentScrollEl() {
  return app.querySelector(".content") || app.querySelector(".simple-content");
}

function captureScroll() {
  const content = contentScrollEl();
  return {
    contentTop: content ? content.scrollTop : 0,
    contentLeft: content ? content.scrollLeft : 0
  };
}

function restoreScroll(saved) {
  if (!saved) return;
  const apply = () => {
    const content = contentScrollEl();
    if (!content) return;
    content.scrollTop = saved.contentTop;
    content.scrollLeft = saved.contentLeft;
  };
  apply();
  requestAnimationFrame(apply);
}

function patchLiveChrome() {
  const pill = app.querySelector(".live-pill");
  if (pill) {
    pill.classList.toggle("online", state.live.connected);
    pill.classList.toggle("offline", !state.live.connected);
    const label = state.live.connected ? t("common.live") : t("common.polling");
    const textNode = [...pill.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = label;
    else {
      const span = pill.querySelector("span");
      pill.textContent = "";
      if (span) pill.append(span);
      pill.append(document.createTextNode(label));
    }
  }

  applyConnectionToggle(app.querySelector("[data-header-connection-toggle]"));
  const headerToggle = app.querySelector("[data-header-connection-toggle]");
  if (headerToggle) headerToggle.classList.add("header-connection-toggle");

  if (useExpertLayout()) {
    if (state.view !== "home" || !state.snapshot) return;
  } else if (state.view !== "home" && state.view !== "connectivity") {
    return;
  }

  const orb = app.querySelector(".status-orb");
  if (orb) orb.className = `status-orb ${statusKind()}`;

  const statusLabel = app.querySelector(".status-label");
  if (statusLabel) statusLabel.textContent = statusText();

  applyConnectionToggle(app.querySelector("[data-connection-toggle]"));

  const liveDatum = [...app.querySelectorAll(".state-datum")].find((node) => {
    const label = node.querySelector("span");
    return label && label.textContent === "Live event";
  });
  if (liveDatum) {
    const strong = liveDatum.querySelector("strong");
    if (strong) strong.textContent = String(state.live.lastLine || "Waiting").slice(0, 96);
  }

  const eventMeta = app.querySelector(".state-panel .panel-heading span");
  if (eventMeta && state.live.lastEvent) {
    eventMeta.textContent = `event ${new Date(state.live.lastEvent).toLocaleTimeString()}`;
  }
}

function statusFingerprint(status) {
  if (!status) return "";
  return [
    status.connected ? "1" : "0",
    status.connecting ? "1" : "0",
    status.disconnected ? "1" : "0",
    status.registrationMissing ? "1" : "0",
    status.label || ""
  ].join(":");
}

function render() {
  captureOpenPanels();
  const scroll = captureScroll();
  const previousView = render.lastView;
  app.innerHTML = "";
  app.append(useExpertLayout() ? shell() : simpleShell());
  if (state.busy) app.append(el("div", "busy", "Running warp-cli command..."));
  if (state.error) app.append(el("div", "toast", escapeHtml(state.error)));
  if (state.toast) {
    const toast = el("div", "toast info", `<pre>${escapeHtml(state.toast)}</pre><button class="ghost" data-dismiss>Dismiss</button>`);
    toast.querySelector("[data-dismiss]").onclick = () => {
      state.toast = null;
      render();
    };
    app.append(toast);
  }
  const stack = app.querySelector(".view-stack");
  if (stack && previousView !== state.view) {
    stack.classList.add("enter");
  }
  render.lastView = state.view;
  restoreScroll(scroll);
  if (state.pendingScrollId) {
    const targetId = state.pendingScrollId;
    state.pendingScrollId = null;
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}
render.lastView = null;

function applyRouteFromHash() {
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (hash === "diagnostics") {
    if (useExpertLayout()) state.view = "home";
    openLogDockTab(state, "diagnostics");
    render();
  }
}

async function boot() {
  let locale = "en";
  try {
    const configRes = await apiFetch("/api/config");
    const configBody = await configRes.json();
    state.appConfig = configBody.config;
    locale = configBody.config?.ui?.locale || "en";
  } catch {
    // defaults
  }
  await loadLocale(locale);
  state.killswitch.desired = Boolean(state.appConfig?.warp?.killSwitch);
  state.killswitch.allowLan = Boolean(state.appConfig?.warp?.killSwitchAllowLan);
  if (isNativeShell() && !useExpertLayout()) {
    state.view = "connectivity";
  }
  if (isNativeShell()) {
    document.body.classList.add("native-shell");
    initNativeBridge();
  }
  render();
  applyRouteFromHash();
  await refresh();
  await pollConsoleLogs(state);
  connectLiveEvents();
  window.addEventListener("hashchange", applyRouteFromHash);
  registerServiceWorker();
  setInterval(() => refresh({ silent: true }), 20000);
  maybeStartupUpdateCheck();
}

boot();

function connectLiveEvents() {
  if (!window.EventSource) {
    state.live.label = "Live status unavailable";
    return;
  }

  if (connectLiveEvents.source) {
    connectLiveEvents.source.close();
    connectLiveEvents.source = null;
  }

  const events = new EventSource("/api/events");
  connectLiveEvents.source = events;

  events.addEventListener("ready", () => {
    state.live.connected = true;
    state.live.label = "Live status connected";
    state.live.lastEvent = Date.now();
    patchLiveChrome();
  });

  events.addEventListener("warp", (event) => {
    const data = JSON.parse(event.data);
    const before = statusFingerprint(state.snapshot?.status);
    state.live.connected = true;
    state.live.lastEvent = Date.now();
    state.live.lastLine = data.line || "";
    if (data.line) {
      appendStatusLine(state, {
        ts: data.generatedAt || new Date().toISOString(),
        line: data.line,
        kind: "warp"
      });
    }
    if (
      data.status
      && state.snapshot
      && (data.status.connected || data.status.connecting || data.status.disconnected || data.status.registrationMissing)
    ) {
      state.snapshot.status = data.status;
    }
    const after = statusFingerprint(state.snapshot?.status);
    const statusChanged = before !== after;

    patchLiveChrome();
    patchLogStatusTab(state);

    if (statusChanged) {
      window.clearTimeout(connectLiveEvents.refreshTimer);
      connectLiveEvents.refreshTimer = window.setTimeout(() => refresh({ silent: true }), 2000);
    }
  });

  events.addEventListener("error", (event) => {
    state.live.failures += 1;
    state.live.connected = false;
    if (event.data) {
      try {
        const data = JSON.parse(event.data);
        state.live.lastLine = data.line || state.live.lastLine;
        if (data.line) {
          appendStatusLine(state, {
            ts: data.generatedAt || new Date().toISOString(),
            line: data.line,
            kind: "error"
          });
        }
      } catch {
        state.live.lastLine = state.live.lastLine || "Live status stream error";
      }
    }
    patchLiveChrome();
    patchLogStatusTab(state);
  });

  events.addEventListener("closed", () => {
    state.live.connected = false;
    state.live.label = "Live status closed";
    patchLiveChrome();
  });
}

connectLiveEvents.source = null;

window.addEventListener("pagehide", () => {
  connectLiveEvents.source?.close();
  connectLiveEvents.source = null;
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // Service worker support is best-effort; warp-cli state still requires the local server.
    });
  });
}
