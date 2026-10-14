/**
 * Authenticity gate for the local HTTP control plane.
 *
 * The daemon listens on loopback, so any web page the user visits can reach it.
 * Protected API requests authenticate possession of the owner's private daemon
 * credential. Loopback alone does not identify an OS user. Host, browser-origin
 * and JSON checks add defense against drive-by pages; they never replace the
 * credential requirement for reads, streams, or writes.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPaths } from "../config.mjs";
import { assertPrivateDirectory, assertPrivateFile, ensurePrivateDirectory, ensurePrivateFile } from "../security/private-files.mjs";

export const SESSION_HEADER = "x-cloudflare-one-warp-session";
export const SESSION_ROUTE = "/api/session";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/** Headers applied to every API response. API payloads never need to load anything. */
export const API_SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
};

/**
 * Headers applied to Web UI assets. `qrc:` keeps the Qt WebChannel bridge loadable
 * when the UI is embedded in the tray shell; inline styles are used for layout sizing.
 */
export const WEB_SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' qrc:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'"
  ].join("; ")
};

/** Per-daemon token file, beside the user config so clients resolve it the same way. */
export function sessionTokenPath(port, env = process.env) {
  return join(dirname(configPaths(env).user), `session-${Number(port) || 0}.token`);
}

/** Validate only the dedicated app directory, leaving XDG ancestors untouched. */
function credentialDirectory(path, { create = false } = {}) {
  if (create) ensurePrivateDirectory(dirname(path));
  else assertPrivateDirectory(dirname(path));
}

/** Mint a fresh token for this process and write it where local clients can read it. */
export function createSessionToken(port, env = process.env) {
  const token = randomBytes(32).toString("hex");
  const path = sessionTokenPath(port, env);
  credentialDirectory(path, { create: true });
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${token}\n`, { mode: 0o600, flag: "wx" });
    ensurePrivateFile(temporary, { created: true });
    // Replace the directory entry without following an existing token symlink.
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { token, path };
}

export function readSessionToken(port, env = process.env) {
  let descriptor;
  try {
    const path = sessionTokenPath(port, env);
    credentialDirectory(path);
    assertPrivateFile(path);
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = fstatSync(descriptor);
    if (!info.isFile() || (process.getuid && info.uid !== process.getuid())
        || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) return null;
    const value = readFileSync(descriptor, "utf8").trim();
    return value || null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function removeSessionToken(port, env = process.env, expectedToken = null) {
  try {
    credentialDirectory(sessionTokenPath(port, env));
    if (expectedToken && readSessionToken(port, env) !== expectedToken) return false;
    rmSync(sessionTokenPath(port, env), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function isMutation(method, pathname) {
  return MUTATION_METHODS.has(String(method || "").toUpperCase())
    && String(pathname || "").startsWith("/api/");
}

export function isLoopbackPeer(address) {
  if (!address) return false;
  const value = String(address).toLowerCase().replace(/^::ffff:/, "");
  return value === "::1" || value === "127.0.0.1" || value.startsWith("127.");
}

function splitHostHeader(hostHeader) {
  const raw = String(hostHeader).trim().toLowerCase();
  const match = /^(\[[0-9a-f:]+\]|[^:[\]]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!match) return null;
  return {
    hostname: match[1].replace(/^\[|\]$/g, ""),
    port: match[2] ? Number(match[2]) : null
  };
}

/**
 * Reject Host headers that are not this daemon's loopback address. A rebound DNS
 * name resolving to 127.0.0.1 still arrives with the attacker's Host header.
 */
export function isAllowedHost(hostHeader, port) {
  if (!hostHeader) return true; // Browsers always send Host; local CLI clients may not.
  const parts = splitHostHeader(hostHeader);
  if (!parts) return false;
  if (!LOOPBACK_HOSTNAMES.has(parts.hostname)) return false;
  if (parts.port != null && port != null && parts.port !== Number(port)) return false;
  return true;
}

/** True when `value` is a loopback origin served by this daemon. */
export function isAllowedOrigin(value, port) {
  if (!value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTNAMES.has(hostname)) return false;
  const originPort = url.port ? Number(url.port) : 80;
  return port == null || originPort === Number(port);
}

function isJsonContentType(value) {
  return /^application\/json(?:\s*;|\s*$)/i.test(String(value || "").trim());
}

function tokensMatch(expected, received) {
  if (!expected || !received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function reject(status, reason, message) {
  return { allowed: false, status, reason, message };
}

/**
 * Decide whether a request may reach the route handlers.
 *
 * @param {{
 *   method: string,
 *   pathname: string,
 *   headers?: Record<string, string | string[] | undefined>,
 *   remoteAddress?: string,
 *   port?: number,
 *   sessionToken?: string | null
 * }} request
 * @returns {{ allowed: true } | { allowed: false, status: number, reason: string, message: string }}
 */
export function evaluateRequest({
  method,
  pathname,
  headers = {},
  remoteAddress,
  port,
  sessionToken
}) {
  const header = (name) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };

  if (!isAllowedHost(header("host"), port)) {
    return reject(403, "host_not_allowed", "Cloudflare One WARP only answers requests addressed to this computer.");
  }

  const site = header("sec-fetch-site");
  const crossSite = Boolean(site) && site !== "same-origin" && site !== "none";
  const origin = header("origin");
  const referer = header("referer");
  const sessionRoute = String(pathname) === SESSION_ROUTE;

  if (String(pathname).startsWith("/api/") || sessionRoute || isMutation(method, pathname)) {
    if (!isLoopbackPeer(remoteAddress)) {
      return reject(403, "remote_peer_denied", "The control plane is only available from this computer.");
    }
    if (crossSite) {
      return reject(403, "cross_site_denied", "That request came from another website.");
    }
    if (origin && !isAllowedOrigin(origin, port)) {
      return reject(403, "cross_origin_denied", "That request came from another website.");
    }
    if (!origin && referer && !isAllowedOrigin(referer, port)) {
      return reject(403, "cross_origin_denied", "That request came from another website.");
    }
  }

  const publicProbe = ["GET", "HEAD"].includes(String(method || "").toUpperCase())
    && ["/api/health", "/api/version"].includes(String(pathname));
  if (String(pathname).startsWith("/api/") && !publicProbe
      && !tokensMatch(sessionToken, header(SESSION_HEADER))) {
    return reject(401, "session_required", "Open Cloudflare One WARP from its launcher to authenticate this session.");
  }

  if (isMutation(method, pathname)) {
    if (!isJsonContentType(header("content-type"))) {
      return reject(415, "json_required", "Requests that change settings must send JSON.");
    }
  }

  return { allowed: true };
}
