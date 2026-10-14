import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Execute in an isolated browser-like realm so tests never change global.window.
const ownerToken = "a".repeat(64);
async function client(fetch, token = ownerToken) {
  const source = (await readFile(new URL("../public/api-client.js", import.meta.url), "utf8")).replaceAll("export ", "");
  const stored = new Map();
  const window = { fetch, location: { origin: "http://127.0.0.1:8787", pathname: "/", search: "", hash: token ? `#session=${token}` : "" },
    sessionStorage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    history: { replaceState: (_, __, url) => { window.cleanedUrl = url; } }, setTimeout, clearTimeout };
  const context = vm.createContext({ window, Headers, URL, URLSearchParams, AbortController, TextDecoder });
  vm.runInContext(`${source}\nglobalThis.apiFetch = apiFetch; globalThis.Stream = AuthorizedEventSource; globalThis.onLost = onAuthorizationLost;`, context);
  return { apiFetch: context.apiFetch, Stream: context.Stream, onLost: context.onLost, window, stored };
}

test("handoff is removed and all private reads/writes preserve Headers with owner credential", async () => {
  let calls = 0;
  const { apiFetch, window } = await client(async (path, options) => {
    assert.equal(options.headers.get("x-cloudflare-one-warp-session"), ownerToken);
    assert.equal(path.includes(ownerToken), false);
    calls++;
    return Response.json({ ok: true });
  });
  assert.equal(window.cleanedUrl, "/");
  await apiFetch("/api/account");
  await apiFetch("/api/version");
  await apiFetch("/api/action", { method: "POST", headers: new Headers({ "content-type": "application/json", "x-cloudflare-one-warp-session": "wrong" }), body: "{}" });
  assert.equal(calls, 3);
});

test("direct browser has no private API bootstrap and cannot leak credentials to foreign origins", async () => {
  let calls = 0;
  const { apiFetch } = await client(async (_, options) => { assert.equal(options.headers.has("x-cloudflare-one-warp-session"), false); calls++; return Response.json({}); }, null);
  await assert.rejects(apiFetch("/api/account"), /--webui/);
  await assert.rejects(apiFetch("/api/session"), /--webui/);
  await assert.rejects(apiFetch("https://example.com/api/account"), /local daemon/);
  assert.equal(calls, 0);
  await apiFetch("/api/health");
  await apiFetch("/api/version");
  assert.equal(calls, 2);
});

test("expired authorization clears browser credential without replay or unauthenticated refresh", async () => {
  let calls = 0;
  const { apiFetch, stored } = await client(async () => { calls++; return new Response("{}", { status: 401 }); });
  await assert.rejects(apiFetch("/api/action", { method: "POST" }), /reopen/);
  await assert.rejects(apiFetch("/api/account"), /--webui/);
  assert.equal(calls, 1);
  assert.equal(stored.size, 0);
});

test("live status stream authenticates header and parses split SSE frames", async () => {
  const { Stream } = await client(async (path, options) => {
    assert.equal(path, "/api/events");
    assert.equal(options.headers.get("x-cloudflare-one-warp-session"), ownerToken);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: warp\ndata: {"line":'));
      controller.enqueue(new TextEncoder().encode('"connected"}\n\n'));
      controller.close();
    } }));
  });
  await new Promise((resolve, reject) => {
    const stream = new Stream("/api/events");
    const timeout = setTimeout(() => { stream.close(); reject(new Error("No stream event")); }, 1000);
    stream.addEventListener("warp", (event) => { clearTimeout(timeout); stream.close(); assert.equal(JSON.parse(event.data).line, "connected"); resolve(); });
  });
});

test("authorization loss notifies UI and invalidates already-started JSON responses", async () => {
  let release;
  const body = new Promise((resolve) => release = resolve);
  const { apiFetch, onLost } = await client(async (path) => path === "/api/account" ? { status: 200, json: () => body } : new Response("{}", { status: 401 }));
  let revoked = 0;
  onLost(() => revoked++);
  const response = await apiFetch("/api/account");
  const pendingJson = response.json();
  await assert.rejects(apiFetch("/api/config"), /--webui/);
  release({ privateAccount: "must not be committed" });
  await assert.rejects(pendingJson, /--webui/);
  assert.equal(revoked, 1);
});

test("clean live-stream EOF reports connection loss before reconnecting", async () => {
  const { Stream } = await client(async () => new Response(new ReadableStream({ start(controller) { controller.close(); } })));
  await new Promise((resolve, reject) => {
    const stream = new Stream("/api/events");
    const timeout = setTimeout(() => { stream.close(); reject(new Error("No EOF notice")); }, 1000);
    stream.addEventListener("error", (event) => {
      clearTimeout(timeout);
      stream.close();
      assert.match(JSON.parse(event.data).line, /closed/);
      resolve();
    });
  });
});

test("blocked preference storage falls back to page-local memory", async () => {
  const source = (await readFile(new URL("../public/storage.js", import.meta.url), "utf8")).replaceAll("export ", "");
  const context = vm.createContext({ window: { get localStorage() { throw new Error("blocked"); } } });
  vm.runInContext(`${source}\nglobalThis.preferences = preferences;`, context);
  assert.equal(context.preferences.getItem("mode"), null);
  context.preferences.setItem("mode", "expert");
  assert.equal(context.preferences.getItem("mode"), "expert");
  context.preferences.removeItem("mode");
  assert.equal(context.preferences.getItem("mode"), null);
});

async function worker() {
  const listeners = new Map();
  const deleted = [];
  const context = vm.createContext({
    self: { location: { origin: "http://127.0.0.1:8787" }, addEventListener: (type, handler) => listeners.set(type, handler), clients: { claim: async () => {} } },
    URL, Response,
    caches: { keys: async () => ["other-app-cache", "cloudflare-one-warp-shell-v3", "cloudflare-one-warp-shell-v5", "cloudflare-one-warp-shell-v6"], delete: async (key) => deleted.push(key), match: async () => undefined },
    fetch: async () => { throw new Error("offline"); }
  });
  vm.runInContext(await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8"), context);
  return { listeners, deleted };
}

test("shell worker leaves private API, foreign resources and unrelated caches alone", async () => {
  const { listeners, deleted } = await worker();
  let intercepted = 0;
  for (const url of ["http://127.0.0.1:8787/api/account", "https://example.com/app.js", "http://127.0.0.1:8787/private-document", "http://127.0.0.1:8787/app.js?private=value"]) {
    listeners.get("fetch")({ request: { url, method: "GET" }, respondWith: () => intercepted++ });
  }
  assert.equal(intercepted, 0);
  let activated;
  listeners.get("activate")({ waitUntil: (promise) => activated = promise });
  await activated;
  assert.deepEqual(deleted, ["cloudflare-one-warp-shell-v3", "cloudflare-one-warp-shell-v5"]);
});

test("offline missing JavaScript returns a failed response instead of HTML", async () => {
  const { listeners } = await worker();
  let promise;
  listeners.get("fetch")({ request: { url: "http://127.0.0.1:8787/app.js?clientRevision=9", method: "GET", mode: "cors" }, respondWith: (value) => promise = value });
  assert.equal((await promise).type, "error");
});
