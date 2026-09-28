/**
 * Shared HTTP helper for daemon tests and smokes.
 *
 * Bootstraps the local session credential the same way the Web UI does, so tests
 * exercise the real request gate instead of a bypass.
 */

import { request } from "node:http";

function send(baseUrl, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...extraHeaders };
    if (payload) {
      if (!("content-type" in headers)) headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = request(`${baseUrl}${path}`, { method, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = { raw: text };
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * @param {string} baseUrl e.g. `http://127.0.0.1:14733`
 * @returns {(method: string, path: string, body?: unknown, options?: { headers?: Record<string, string>, session?: boolean }) => Promise<{ status: number, json: any }>}
 */
export function createHttpJson(baseUrl) {
  let token = null;

  async function session(refresh = false) {
    if (token && !refresh) return token;
    const res = await send(baseUrl, "GET", "/api/session", null);
    token = res.json?.session || null;
    return token;
  }

  return async function httpJson(method, path, body, options = {}) {
    const upper = String(method).toUpperCase();
    const headers = { ...(options.headers || {}) };
    const callerSuppliedToken = "x-thirdflare-session" in headers;
    const wantSession = options.session !== false && MUTATIONS.has(upper) && !callerSuppliedToken;
    if (wantSession) {
      const value = await session();
      if (value) headers["x-thirdflare-session"] = value;
    }
    let result = await send(baseUrl, upper, path, body, headers);
    if (result.status === 403 && wantSession && result.json?.reason === "session_required") {
      const value = await session(true);
      if (value) {
        headers["x-thirdflare-session"] = value;
        result = await send(baseUrl, upper, path, body, headers);
      }
    }
    return result;
  };
}
