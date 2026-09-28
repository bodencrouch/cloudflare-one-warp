/**
 * Single entry point for talking to the ThirdFlare One daemon.
 *
 * The daemon rejects anything that changes settings unless it carries this
 * browser session's credential, so every UI request goes through here.
 */

let sessionToken = null;
let pending = null;

async function requestSession() {
  const response = await window.fetch("/api/session", {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`session bootstrap failed (${response.status})`);
  const body = await response.json();
  if (!body?.session) throw new Error("session bootstrap returned no credential");
  return body.session;
}

/** Fetch the session credential once and reuse it for the life of the page. */
export function primeSession() {
  if (sessionToken) return Promise.resolve(sessionToken);
  if (!pending) {
    pending = requestSession()
      .then((token) => {
        sessionToken = token;
        return token;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

function isMutation(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "GET").toUpperCase());
}

/**
 * `fetch` for daemon endpoints. Attaches the session credential to writes and
 * retries once if the daemon restarted with a new credential.
 *
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function apiFetch(path, options = {}) {
  if (!isMutation(options.method)) return window.fetch(path, options);

  let token = await primeSession();
  let response = await window.fetch(path, withSession(options, token));
  if (response.status === 403) {
    sessionToken = null;
    token = await primeSession();
    response = await window.fetch(path, withSession(options, token));
  }
  return response;
}

function withSession(options, token) {
  return {
    ...options,
    headers: { ...(options.headers || {}), "x-thirdflare-session": token }
  };
}
