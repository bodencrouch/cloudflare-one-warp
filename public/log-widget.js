import { apiFetch } from "./api-client.js";
import { t } from "./i18n.js";

export const LOG_WIDGET_HEIGHT_KEY = "thirdflare-log-height";
export const LOG_WIDGET_COLLAPSED_KEY = "thirdflare-log-collapsed";
export const LOG_WIDGET_TAB_KEY = "thirdflare-log-tab";
export const STATUS_LINES_CAP = 1000;

export function createDefaultLogWidgetState() {
  const collapsed = localStorage.getItem(LOG_WIDGET_COLLAPSED_KEY) === "1";
  const height = Number(localStorage.getItem(LOG_WIDGET_HEIGHT_KEY)) || 220;
  const tab = localStorage.getItem(LOG_WIDGET_TAB_KEY) || "status";
  return {
    tab: ["status", "console", "diagnostics"].includes(tab) ? tab : "status",
    collapsed,
    height: Number.isFinite(height) && height >= 120 && height <= 480 ? height : 220,
    statusLines: [],
    statusSeeded: false,
    statusPinnedBottom: true,
    consoleCursor: 0,
    consoleEntries: [],
    consoleLoading: false,
    collapsedConsoleEntries: new Set()
  };
}

export function seedStatusFromSnapshot(state) {
  if (!state.logWidget || state.logWidget.statusSeeded) return;
  const stdout = state.snapshot?.commands?.status?.stdout;
  if (!stdout) return;
  const ts = state.snapshot?.generatedAt || new Date().toISOString();
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) appendStatusLine(state, { ts, line: trimmed, kind: "seed" });
  }
  state.logWidget.statusSeeded = true;
}

export function appendStatusLine(state, { ts, line, kind = "warp" }) {
  if (!state.logWidget || !line) return;
  state.logWidget.statusLines.push({
    ts: ts || new Date().toISOString(),
    line,
    kind
  });
  if (state.logWidget.statusLines.length > STATUS_LINES_CAP) {
    state.logWidget.statusLines.splice(0, state.logWidget.statusLines.length - STATUS_LINES_CAP);
  }
}

function el(tag, className, html = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function statusLineClass(kind) {
  if (kind === "error") return "log-status-line error";
  if (kind === "seed") return "log-status-line seed";
  return "log-status-line";
}

function renderStatusTab(state) {
  const wrap = el("div", "log-dock-pane log-dock-status");
  const toolbar = el("div", "log-dock-toolbar");
  const clearBtn = el("button", "ghost log-dock-clear", t("logWidget.clear"));
  clearBtn.type = "button";
  clearBtn.onclick = () => {
    state.logWidget.statusLines = [];
    state.logWidget.statusSeeded = true;
    renderStatusBody(state, wrap);
  };
  toolbar.append(clearBtn);
  wrap.append(toolbar);
  renderStatusBody(state, wrap);
  return wrap;
}

function renderStatusBody(state, wrap) {
  let pre = wrap.querySelector("[data-log-status-pre]");
  if (!pre) {
    pre = el("pre", "log-status-pre");
    pre.setAttribute("data-log-status-pre", "");
    wrap.append(pre);
  }
  const lines = state.logWidget.statusLines;
  if (!lines.length) {
    pre.textContent = t("logWidget.emptyStatus");
    return;
  }
  pre.innerHTML = lines
    .map(({ ts, line, kind }) => `<div class="${statusLineClass(kind)}"><span class="log-ts">${escapeHtml(formatTime(ts))}</span> ${escapeHtml(line)}</div>`)
    .join("");
  if (state.logWidget.statusPinnedBottom) {
    pre.scrollTop = pre.scrollHeight;
  }
  pre.onscroll = () => {
    const pinned = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
    state.logWidget.statusPinnedBottom = pinned;
  };
}

export function patchLogStatusTab(state) {
  const pre = document.querySelector("[data-log-status-pre]");
  if (!pre || state.logWidget.tab !== "status" || state.logWidget.collapsed) return;
  const lines = state.logWidget.statusLines;
  if (!lines.length) return;
  const last = lines.at(-1);
  const row = el("div", statusLineClass(last.kind));
  row.innerHTML = `<span class="log-ts">${escapeHtml(formatTime(last.ts))}</span> ${escapeHtml(last.line)}`;
  pre.append(row);
  if (state.logWidget.statusPinnedBottom) {
    pre.scrollTop = pre.scrollHeight;
  }
}

function renderConsoleTab(state, handlers) {
  const wrap = el("div", "log-dock-pane log-dock-console");
  if (state.logWidget.consoleLoading) {
    wrap.append(el("p", "muted log-console-empty", t("common.loading")));
    return wrap;
  }
  const entries = state.logWidget.consoleEntries || [];
  if (!entries.length) {
    wrap.append(el("p", "muted log-console-empty", t("logWidget.emptyConsole")));
    return wrap;
  }
  for (const entry of entries) {
    wrap.append(renderConsoleEntry(state, entry, handlers));
  }
  return wrap;
}

function renderConsoleEntry(state, entry, handlers) {
  const row = el("article", `log-console-entry ${entry.ok ? "ok" : "fail"}`);
  const head = el("div", "log-console-head");
  const codeLabel = entry.code == null ? "error" : t("logWidget.exitCode", { code: entry.code });
  head.innerHTML = `
    <span class="log-console-time">${escapeHtml(formatTime(entry.ts))}</span>
    <code class="log-console-cmd">${escapeHtml(entry.command)}</code>
    <span class="log-console-meta">${escapeHtml(t("logWidget.duration", { ms: entry.durationMs }))} · ${escapeHtml(codeLabel)}</span>
  `;
  row.append(head);
  const body = el("div", "log-console-body");
  const output = [entry.stdout, entry.stderr].filter(Boolean).join("\n").trim() || t("logWidget.noOutput");
  const pre = el("pre", "log-console-output");
  pre.textContent = output;
  body.append(pre);
  if (!state.logWidget.collapsedConsoleEntries) state.logWidget.collapsedConsoleEntries = new Set();
  if (state.logWidget.collapsedConsoleEntries.has(entry.id)) body.classList.add("collapsed");
  const actions = el("div", "log-console-actions");
  const copyBtn = el("button", "ghost", t("logWidget.copyEntry"));
  copyBtn.type = "button";
  copyBtn.onclick = () => handlers.onCopyConsoleEntry?.(entry);
  const toggleBtn = el("button", "ghost", body.classList.contains("collapsed")
    ? t("logWidget.expandOutput")
    : t("logWidget.toggleOutput"));
  toggleBtn.type = "button";
  toggleBtn.onclick = () => {
    body.classList.toggle("collapsed");
    if (body.classList.contains("collapsed")) state.logWidget.collapsedConsoleEntries.add(entry.id);
    else state.logWidget.collapsedConsoleEntries.delete(entry.id);
    toggleBtn.textContent = body.classList.contains("collapsed")
      ? t("logWidget.expandOutput")
      : t("logWidget.toggleOutput");
  };
  actions.append(copyBtn, toggleBtn);
  row.append(body, actions);
  return row;
}

function renderDiagnosticsTab(state, handlers) {
  const wrap = el("div", "log-dock-pane log-dock-diagnostics");
  const content = handlers.renderDiagnostics?.(state);
  if (content) wrap.append(content);
  else wrap.append(el("p", "muted", t("common.loading")));
  return wrap;
}

export async function pollConsoleLogs(state) {
  if (!state.logWidget) return;
  state.logWidget.consoleLoading = true;
  try {
    const since = state.logWidget.consoleCursor || 0;
    const path = since > 0 ? `/api/logs?since=${since}` : "/api/logs";
    const response = await apiFetch(path);
    const body = await response.json();
    if (!response.ok || !body.ok) return;
    const incoming = body.entries || [];
    if (since > 0) {
      state.logWidget.consoleEntries = [...state.logWidget.consoleEntries, ...incoming];
    } else {
      state.logWidget.consoleEntries = incoming;
    }
    const last = state.logWidget.consoleEntries.at(-1);
    if (last) state.logWidget.consoleCursor = last.id;
    const cap = 500;
    if (state.logWidget.consoleEntries.length > cap) {
      state.logWidget.consoleEntries = state.logWidget.consoleEntries.slice(-cap);
    }
  } catch {
    /* non-blocking */
  } finally {
    state.logWidget.consoleLoading = false;
  }
}

export function renderLogDock(state, handlers = {}) {
  const lw = state.logWidget;
  const dock = el("section", `log-dock ${lw.collapsed ? "collapsed" : ""}`);
  dock.setAttribute("data-testid", "log-dock");
  if (!lw.collapsed) dock.style.height = `${lw.height}px`;

  const resize = el("div", "log-dock-resize");
  resize.setAttribute("aria-hidden", "true");
  if (!lw.collapsed) {
    resize.onmousedown = (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startH = lw.height;
      const onMove = (moveEvent) => {
        const next = Math.min(480, Math.max(120, startH + (startY - moveEvent.clientY)));
        lw.height = next;
        dock.style.height = `${next}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        localStorage.setItem(LOG_WIDGET_HEIGHT_KEY, String(lw.height));
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const bar = el("div", "log-dock-bar");
  const tabs = el("div", "log-dock-tabs");
  for (const [id, labelKey] of [
    ["status", "logWidget.status"],
    ["console", "logWidget.console"],
    ["diagnostics", "logWidget.diagnostics"]
  ]) {
    const tab = el("button", `log-dock-tab ${lw.tab === id ? "active" : ""}`, t(labelKey));
    tab.type = "button";
    tab.setAttribute("data-log-tab", id);
    tab.onclick = () => handlers.onTabChange?.(id);
    tabs.append(tab);
  }
  const collapseBtn = el(
    "button",
    "ghost log-dock-collapse",
    lw.collapsed ? t("logWidget.expand") : t("logWidget.collapse")
  );
  collapseBtn.type = "button";
  collapseBtn.onclick = () => handlers.onToggleCollapse?.();
  bar.append(tabs, collapseBtn);

  dock.append(resize, bar);

  if (!lw.collapsed) {
    const body = el("div", "log-dock-body");
    if (lw.tab === "status") body.append(renderStatusTab(state));
    else if (lw.tab === "console") body.append(renderConsoleTab(state, handlers));
    else body.append(renderDiagnosticsTab(state, handlers));
    dock.append(body);
  }

  return dock;
}

export function openLogDockTab(state, tab) {
  if (!state.logWidget) return;
  state.logWidget.tab = tab;
  state.logWidget.collapsed = false;
  localStorage.setItem(LOG_WIDGET_TAB_KEY, tab);
  localStorage.setItem(LOG_WIDGET_COLLAPSED_KEY, "0");
}

export function isLogPanelFocused() {
  const active = document.activeElement;
  return Boolean(active?.closest?.(".log-dock"));
}
