/**
 * Shared HTTP helper for daemon tests and smokes.
 *
 * Reads the private owner credential from the daemon fixture, so tests
 * exercise the real request gate instead of a bypass.
 */

import { request } from "node:http";
import { readSessionToken } from "../lib/http/request-gate.mjs";

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

/** Read the owner credential from the isolated daemon fixture, never HTTP. */
export function createHttpJson(baseUrl, { env = process.env, tokenResolver } = {}) {
  return async function httpJson(method, path, body, options = {}) {
    const headers = { ...(options.headers || {}) };
    const supplied = Object.keys(headers).some((key) => key.toLowerCase() === "x-cloudflare-one-warp-session");
    if (options.session !== false && !supplied) {
      const token = tokenResolver ? await tokenResolver() : readSessionToken(Number(new URL(baseUrl).port), env);
      if (token) headers["x-cloudflare-one-warp-session"] = token;
    }
    return send(baseUrl, String(method).toUpperCase(), path, body, headers);
  };
}
