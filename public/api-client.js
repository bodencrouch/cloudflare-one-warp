/** Owner-authorized local daemon client. Credentials never enter request URLs. */
const STORAGE_KEY = "cloudflare-one-warp-owner-session";
export const AUTH_HELP = "Open Cloudflare One WARP with --webui to authorize this browser. If the daemon restarted, reopen the app to authorize it again.";
let sessionToken = null;
const authorizationLost = new Set();
export function onAuthorizationLost(handler) {
  authorizationLost.add(handler);
  return () => authorizationLost.delete(handler);
}


function remember(token) {
  sessionToken = token;
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Memory-only authorization remains usable when storage is blocked. */ }
}

// Fragments are not sent to HTTP servers. Remove the handoff before rendering,
// navigation, external links, or browser history can retain it.
const fragment = new URLSearchParams(window.location.hash.slice(1));
const handoff = fragment.get("session");
if (handoff) {
  fragment.delete("session");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${fragment.size ? `#${fragment}` : ""}`);
  if (/^[a-f0-9]{64}$/i.test(handoff)) remember(handoff);
} else {
  try { sessionToken = window.sessionStorage.getItem(STORAGE_KEY); } catch { /* Storage unavailable. */ }
}

export function primeSession() {
  return sessionToken ? Promise.resolve(sessionToken) : Promise.reject(new Error(AUTH_HELP));
}

export async function apiFetch(path, options = {}) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) throw new Error("Only local daemon API requests are allowed.");
  const publicRead = ["/api/health", "/api/version"].includes(url.pathname) && String(options.method || "GET").toUpperCase() === "GET";
  const headers = new Headers(options.headers);
  if (!publicRead || sessionToken) headers.set("x-cloudflare-one-warp-session", await primeSession());
  const requestToken = headers.get("x-cloudflare-one-warp-session");
  const response = await window.fetch(`${url.pathname}${url.search}`, { ...options, headers, cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) {
    remember(null);
    for (const handler of authorizationLost) {
      try { handler(); } catch { /* Authorization revocation must still finish. */ }
    }
    throw new Error(AUTH_HELP);
  }
  if (requestToken && requestToken !== sessionToken) throw new Error(AUTH_HELP);
  if (requestToken) {
    const readJson = response.json.bind(response);
    response.json = async (...args) => {
      const result = await readJson(...args);
      if (requestToken !== sessionToken) throw new Error(AUTH_HELP);
      return result;
    };
  }
  return response;
}

/** EventSource-compatible subset backed by fetch, because EventSource cannot
 * carry an authorization header. No query-string credentials or cookies. */
export class AuthorizedEventSource {
  constructor(path) {
    this.path = path;
    this.listeners = new Map();
    this.closed = false;
    this.connect();
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  emit(type, data = "") {
    for (const handler of this.listeners.get(type) || []) handler({ type, data });
  }
  async connect() {
    if (this.closed) return;
    this.controller = new AbortController();
    try {
      const response = await apiFetch(this.path, { signal: this.controller.signal, headers: { accept: "text/event-stream" } });
      if (!response.ok || !response.body) throw new Error("Live status unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let type = "message";
      let data = [];
      try {
        while (!this.closed) {
          const chunk = await reader.read();
          if (chunk.done) {
            if (!this.closed) this.emit("error", JSON.stringify({ line: "Live status connection closed. Reconnecting…" }));
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 65536) throw new Error("Live status event exceeds limit");
          let end;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end).replace(/\r$/, "");
            buffer = buffer.slice(end + 1);
            if (!line) {
              if (data.length) this.emit(type, data.join("\n"));
              type = "message"; data = [];
            } else if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) {
              data.push(line.slice(5).replace(/^ /, ""));
              if (data.join("\n").length > 65536) throw new Error("Live status event exceeds limit");
            }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (!this.closed) this.emit("error", JSON.stringify({ line: error.message }));
    }
    if (!this.closed && sessionToken) this.timer = window.setTimeout(() => this.connect(), 3000);
  }
  close() {
    this.closed = true;
    this.controller?.abort();
    window.clearTimeout(this.timer);
  }
}
