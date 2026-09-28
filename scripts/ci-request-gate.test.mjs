import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  API_SECURITY_HEADERS,
  createSessionToken,
  evaluateRequest,
  isAllowedHost,
  isAllowedOrigin,
  isLoopbackPeer,
  isMutation,
  readSessionToken,
  removeSessionToken,
  SESSION_HEADER,
  SESSION_ROUTE,
  sessionTokenPath,
  WEB_SECURITY_HEADERS
} from "../lib/http/request-gate.mjs";

const PORT = 4173;
const TOKEN = "a".repeat(64);

function evaluate(overrides = {}) {
  const { headers: headerOverrides, ...rest } = overrides;
  return evaluateRequest({
    method: "POST",
    pathname: "/api/action",
    remoteAddress: "127.0.0.1",
    port: PORT,
    sessionToken: TOKEN,
    ...rest,
    headers: {
      host: `127.0.0.1:${PORT}`,
      origin: `http://127.0.0.1:${PORT}`,
      "content-type": "application/json",
      [SESSION_HEADER]: TOKEN,
      ...headerOverrides
    }
  });
}

test("isAllowedHost accepts this daemon's loopback names only", () => {
  assert.equal(isAllowedHost(`127.0.0.1:${PORT}`, PORT), true);
  assert.equal(isAllowedHost(`localhost:${PORT}`, PORT), true);
  assert.equal(isAllowedHost(`[::1]:${PORT}`, PORT), true);
  assert.equal(isAllowedHost("127.0.0.1", PORT), true);
  assert.equal(isAllowedHost(undefined, PORT), true);

  assert.equal(isAllowedHost(`attacker.example:${PORT}`, PORT), false);
  assert.equal(isAllowedHost("127.0.0.1:9999", PORT), false);
  assert.equal(isAllowedHost("localhost.attacker.example", PORT), false);
  assert.equal(isAllowedHost("not a host", PORT), false);
});

test("isAllowedOrigin requires http loopback on the listen port", () => {
  assert.equal(isAllowedOrigin(`http://127.0.0.1:${PORT}`, PORT), true);
  assert.equal(isAllowedOrigin(`http://localhost:${PORT}`, PORT), true);
  assert.equal(isAllowedOrigin(`http://[::1]:${PORT}`, PORT), true);

  assert.equal(isAllowedOrigin(`https://127.0.0.1:${PORT}`, PORT), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:9999", PORT), false);
  assert.equal(isAllowedOrigin("http://attacker.example", PORT), false);
  assert.equal(isAllowedOrigin("null", PORT), false);
  assert.equal(isAllowedOrigin("", PORT), false);
});

test("isLoopbackPeer handles IPv4-mapped addresses", () => {
  assert.equal(isLoopbackPeer("127.0.0.1"), true);
  assert.equal(isLoopbackPeer("127.0.0.53"), true);
  assert.equal(isLoopbackPeer("::1"), true);
  assert.equal(isLoopbackPeer("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackPeer("192.168.1.20"), false);
  assert.equal(isLoopbackPeer(undefined), false);
});

test("isMutation covers write methods under /api/ only", () => {
  assert.equal(isMutation("POST", "/api/action"), true);
  assert.equal(isMutation("delete", "/api/config/ui"), true);
  assert.equal(isMutation("GET", "/api/action"), false);
  assert.equal(isMutation("POST", "/index.html"), false);
});

test("a valid same-origin mutation from the Web UI passes", () => {
  assert.deepEqual(evaluate(), { allowed: true });
});

test("a mutation without an Origin header passes for local CLI clients", () => {
  const verdict = evaluate({ headers: { origin: undefined } });
  assert.equal(verdict.allowed, true);
});

test("Host headers from rebound DNS names are rejected before routing", () => {
  const verdict = evaluate({
    method: "GET",
    pathname: "/api/snapshot",
    headers: { host: "attacker.example", origin: undefined }
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.status, 403);
  assert.equal(verdict.reason, "host_not_allowed");
});

test("cross-origin mutations are rejected", () => {
  const verdict = evaluate({ headers: { origin: "http://attacker.example" } });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.status, 403);
  assert.equal(verdict.reason, "cross_origin_denied");
});

test("cross-site fetch metadata is rejected even with a stolen origin header", () => {
  const verdict = evaluate({ headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "cross_site_denied");
});

test("a cross-origin Referer is rejected when Origin is absent", () => {
  const verdict = evaluate({
    headers: { origin: undefined, referer: "http://attacker.example/page" }
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "cross_origin_denied");
});

test("non-JSON mutations are rejected with 415", () => {
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", undefined]) {
    const verdict = evaluate({ headers: { "content-type": contentType } });
    assert.equal(verdict.allowed, false, `expected ${contentType} to be rejected`);
    assert.equal(verdict.status, 415);
    assert.equal(verdict.reason, "json_required");
  }
});

test("JSON content type with charset is accepted", () => {
  const verdict = evaluate({ headers: { "content-type": "application/json; charset=utf-8" } });
  assert.equal(verdict.allowed, true);
});

test("mutations without the session header are rejected", () => {
  const missing = evaluate({ headers: { [SESSION_HEADER]: undefined } });
  assert.equal(missing.allowed, false);
  assert.equal(missing.status, 403);
  assert.equal(missing.reason, "session_required");

  const wrong = evaluate({ headers: { [SESSION_HEADER]: "b".repeat(64) } });
  assert.equal(wrong.allowed, false);
  assert.equal(wrong.reason, "session_required");

  const shortToken = evaluate({ headers: { [SESSION_HEADER]: "abc" } });
  assert.equal(shortToken.allowed, false);
});

test("mutations from non-loopback peers are rejected even with a valid session", () => {
  const verdict = evaluate({ remoteAddress: "192.168.1.20", headers: { origin: undefined } });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.status, 403);
  assert.equal(verdict.reason, "remote_peer_denied");
});

test("read-only requests do not need a session token", () => {
  const verdict = evaluate({
    method: "GET",
    pathname: "/api/snapshot",
    headers: { origin: undefined, "content-type": undefined, [SESSION_HEADER]: undefined }
  });
  assert.equal(verdict.allowed, true);
});

test("remote read-only requests stay available for diagnostics", () => {
  const verdict = evaluate({
    method: "GET",
    pathname: "/api/health",
    remoteAddress: "192.168.1.20",
    headers: { host: undefined, origin: undefined, "content-type": undefined, [SESSION_HEADER]: undefined }
  });
  assert.equal(verdict.allowed, true);
});

test("session bootstrap requires a same-origin loopback caller", () => {
  const ok = evaluate({
    method: "GET",
    pathname: SESSION_ROUTE,
    headers: { "content-type": undefined, [SESSION_HEADER]: undefined, "sec-fetch-site": "same-origin" }
  });
  assert.equal(ok.allowed, true);

  const crossSite = evaluate({
    method: "GET",
    pathname: SESSION_ROUTE,
    headers: { "content-type": undefined, [SESSION_HEADER]: undefined, "sec-fetch-site": "cross-site" }
  });
  assert.equal(crossSite.allowed, false);
  assert.equal(crossSite.reason, "cross_site_denied");

  const remote = evaluate({
    method: "GET",
    pathname: SESSION_ROUTE,
    remoteAddress: "192.168.1.20",
    headers: { host: undefined, origin: undefined, "content-type": undefined, [SESSION_HEADER]: undefined }
  });
  assert.equal(remote.allowed, false);
  assert.equal(remote.reason, "remote_peer_denied");
});

test("session token file is per-port, private, and removable", () => {
  const home = mkdtempSync(join(tmpdir(), "tf-session-"));
  const env = { HOME: home };
  try {
    const created = createSessionToken(4173, env);
    assert.equal(created.path, sessionTokenPath(4173, env));
    assert.match(created.token, /^[0-9a-f]{64}$/);
    assert.equal(readSessionToken(4173, env), created.token);
    assert.equal(statSync(created.path).mode & 0o777, 0o600);

    const second = createSessionToken(4180, env);
    assert.notEqual(second.path, created.path);
    assert.notEqual(second.token, created.token);
    assert.equal(readSessionToken(4173, env), created.token);

    removeSessionToken(4173, env);
    assert.equal(readSessionToken(4173, env), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("security headers deny embedding and sniffing", () => {
  assert.equal(API_SECURITY_HEADERS["x-content-type-options"], "nosniff");
  assert.equal(API_SECURITY_HEADERS["x-frame-options"], "DENY");
  assert.match(API_SECURITY_HEADERS["content-security-policy"], /default-src 'none'/);
  assert.match(WEB_SECURITY_HEADERS["content-security-policy"], /connect-src 'self'/);
  assert.match(WEB_SECURITY_HEADERS["content-security-policy"], /frame-ancestors 'none'/);
});
