/**
 * Vendor-grade frontend regressions: untrusted release metadata, keyboard state,
 * concurrent command suppression, and accessible command failures.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSessionToken } from "../lib/http/request-gate.mjs";
import { createHttpJson } from "./ci-http-client.mjs";
import { waitForPredicate } from "./ui-wait.mjs";

const root = process.cwd();
const legacyWorkerPath = join(root, "public", `.tmp-legacy-owner-cache-${process.pid}.js`);
const port = Number(process.env.CI_UI_PORT || 14742);
const mockWarp = process.env.WARP_CLI || join(root, "scripts/mock-warp-cli.mjs");
const systemChrome = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome-stable"].find(
  (p) => existsSync(p)
);

const xdgRoot = await mkdtemp(join(tmpdir(), "cf-one-warp-ui-xdg-"));
const appsDir = join(xdgRoot, "applications");
await mkdir(appsDir, { recursive: true });
await writeFile(
  join(appsDir, "demo-browser.desktop"),
  `[Desktop Entry]
Type=Application
Name=Demo Browser
Exec=demo-browser %u
Icon=web-browser
`,
  "utf8"
);

const httpJson = createHttpJson(`http://127.0.0.1:${port}`, { env: { ...process.env, HOME: xdgRoot, XDG_CONFIG_HOME: join(xdgRoot, "config") } });

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    WARP_CLI: mockWarp,
    CLOUDFLARE_ONE_WARP_WEBUI: "1",
    CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0",
    CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: "1",
    CLOUDFLARE_ONE_WARP_TRAY_SKIP_SYSTEMD: "1",
    CLOUDFLARE_ONE_WARP_TRAY_LIVE: "0",
    XDG_DATA_DIRS: xdgRoot,
    HOME: xdgRoot,
    XDG_CONFIG_HOME: join(xdgRoot, "config"),
    XDG_DATA_HOME: join(xdgRoot, "data"),
    XDG_STATE_HOME: join(xdgRoot, "state"),
    XDG_CACHE_HOME: join(xdgRoot, "cache"),
    MOCK_WARP_STATE: join(xdgRoot, "mock-warp.json")
  },
  stdio: "ignore"
});

async function waitHealth() {
  for (let i = 0; i < 75; i++) {
    try {
      const res = await httpJson("GET", "/api/health");
      if (res.status === 200) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not become healthy in time");
}

async function bootExpertPage(browser) {
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const ownerToken = readSessionToken(port, { ...process.env, HOME: xdgRoot, XDG_CONFIG_HOME: join(xdgRoot, "config") });
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request);
  });
  await page.goto(`http://127.0.0.1:${port}/#session=${ownerToken}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate(() => localStorage.setItem("cloudflare-one-warp-ui-expert", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-testid='log-dock']").waitFor({ timeout: 20000 });
  if (new URL(page.url()).hash.includes("session")) throw new Error("Owner fragment retained in browser history");
  if ((await page.content()).includes(ownerToken)) throw new Error("Owner credential leaked into DOM");
  if ((await page.locator("body").innerText()).includes(ownerToken)) throw new Error("Owner credential leaked into visible text");
  await page.waitForRequest((request) => new URL(request.url()).pathname === "/api/events", { timeout: 10000 }).catch(() => {});
  if (!apiRequests.some((request) => new URL(request.url()).pathname === "/api/events")) throw new Error("Authenticated live-status stream was not opened");
  for (const request of apiRequests) {
    if (request.url().includes(ownerToken)) throw new Error("Owner credential leaked into HTTP URL");
    if (!["/api/health", "/api/version"].includes(new URL(request.url()).pathname) && request.headers()["x-cloudflare-one-warp-session"] !== ownerToken) throw new Error("Private API request lacks owner header");
  }
  return page;
}

let browser;
try {
  await waitHealth();
  await httpJson("POST", "/api/action", { action: "register" });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], ...(systemChrome && process.env.PLAYWRIGHT_USE_BUNDLED !== "1" ? { executablePath: systemChrome } : {}) });
  // Model the oldest installed cache-first worker. A revisioned handoff must
  // load current authorization modules on its very first navigation.
  await writeFile(legacyWorkerPath, `
    self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
    self.addEventListener("fetch", (event) => {
      if (new URL(event.request.url).pathname.startsWith("/api/")) return;
      event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
    });
  `);
  const migration = await browser.newPage();
  await migration.goto(`http://127.0.0.1:${port}/icon.svg`);
  await migration.evaluate(async (workerName) => {
    const cache = await caches.open("cloudflare-one-warp-shell-v1");
    const staleHtml = '<!doctype html><div id="legacy-shell">Old client</div><script src="/app.js"></script>';
    await cache.put("/", new Response(staleHtml, { headers: { "content-type": "text/html" } }));
    await cache.put("/index.html", new Response(staleHtml, { headers: { "content-type": "text/html" } }));
    for (const path of ["/app.js", "/api-client.js", "/log-widget.js", "/i18n.js"]) await cache.put(path, new Response("window.legacyOwnerClientExecuted = true;", { headers: { "content-type": "application/javascript" } }));
    await navigator.serviceWorker.register(`/${workerName}`, { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  }, legacyWorkerPath.split("/").at(-1));
  if (!await migration.evaluate(async () => (await (await fetch("/")).text()).includes("legacy-shell"))) throw new Error("Legacy cache-first worker did not intercept the unrevisioned shell");
  const ownerToken = readSessionToken(port, { ...process.env, HOME: xdgRoot, XDG_CONFIG_HOME: join(xdgRoot, "config") });
  const migrationRequests = [];
  migration.on("request", (request) => migrationRequests.push(request));
  await migration.goto(`http://127.0.0.1:${port}/?clientRevision=9#session=${ownerToken}`, { waitUntil: "domcontentloaded" });
  await migration.locator("[data-testid='log-dock']").waitFor({ timeout: 20000 });
  if (await migration.evaluate(() => Boolean(window.legacyOwnerClientExecuted))) throw new Error("Cached legacy authorization module executed");
  if (new URL(migration.url()).hash.includes("session")) throw new Error("Migration retained owner fragment");
  await waitForPredicate(migration, () => Boolean(document.querySelector("[data-connection-toggle]")), { timeout: 10000 });
  for (const request of migrationRequests) if (request.url().includes(ownerToken)) throw new Error("Migration credential entered an HTTP request URL");
  if (!migrationRequests.some((request) => new URL(request.url()).pathname === "/api/snapshot" && request.headers()["x-cloudflare-one-warp-session"] === ownerToken)) throw new Error("Migrated shell did not authorize private API");
  if (!migrationRequests.some((request) => new URL(request.url()).pathname === "/api-client.js" && new URL(request.url()).searchParams.get("clientRevision") === "9")) throw new Error("Owner authorization module was not revisioned");
  await migration.close();
  await rm(legacyWorkerPath, { force: true });
  const blocked = await browser.newPage();
  const blockedErrors = [];
  blocked.on("pageerror", (error) => blockedErrors.push(error.message));
  await blocked.addInitScript(() => {
    for (const storage of ["localStorage", "sessionStorage"]) Object.defineProperty(window, storage, { configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await blocked.goto(`http://127.0.0.1:${port}/?shell=1#session=${ownerToken}`, { waitUntil: "domcontentloaded" });
  await blocked.locator(".simple-shell").waitFor();
  await blocked.locator("[data-log-tab='console']").click();
  if (blockedErrors.length) throw new Error(`Storage policy broke UI: ${blockedErrors.join("; ")}`);
  await blocked.close();
  const narrow = await browser.newPage({ viewport: { width: 320, height: 760 } });
  await narrow.goto(`http://127.0.0.1:${port}/?shell=1#session=${readSessionToken(port, { ...process.env, HOME: xdgRoot, XDG_CONFIG_HOME: join(xdgRoot, "config") })}`, { waitUntil: "domcontentloaded" });
  await narrow.locator(".simple-shell").waitFor();
  if (await narrow.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Simple layout overflows a narrow viewport");
  await narrow.close();
  const page = await bootExpertPage(browser);
  const resize = page.getByRole("slider", { name: "Log panel height" });
  await resize.focus();
  await resize.press("End");
  if (await resize.getAttribute("aria-valuenow") !== "480") throw new Error("Log panel resize is not keyboard operable");
  await resize.press("Home");
  if (await resize.getAttribute("aria-valuenow") !== "120") throw new Error("Log panel resize minimum not enforced");
  const malicious = '<img src="/missing-regression-image" onerror="window.metadataExecuted=true">';
  await page.route("**/api/update/forks", (route) => route.fulfill({ json: { upstream: { owner: "bodencrouch", repo: "cloudflare-one-warp" }, forks: [{ owner: "bodencrouch", repo: "cloudflare-one-warp", upstream: true }, { owner: "test-fork", repo: "cloudflare-one-warp", upstream: false }] } }));
  await page.route("**/api/update/releases?*", (route) => route.fulfill({ json: { releases: [] } }));
  await page.route("**/api/update/check", (route) => route.fulfill({ json: { ok: true, current: "0.3.4", latest: "0.4.0", updateAvailable: true, installFormat: "source", canApply: false, source: { owner: "bodencrouch", repo: "cloudflare-one-warp" }, release: { name: malicious, body: "Reviewed release" } } }));
  await page.locator("[data-nav='app']").click();
  await page.getByRole("button", { name: "Check now", exact: true }).click();
  await page.getByText(malicious, { exact: true }).waitFor();
  if (await page.evaluate(() => Boolean(window.metadataExecuted))) throw new Error("Release metadata executed as markup");
  if (await page.locator(".update-card img").count()) throw new Error("Release metadata created an HTML element");
  await page.route("**/api/update/source", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 503, json: { error: "Update source save failed" } });
  });
  await page.getByRole("combobox", { name: "Owner", exact: true }).selectOption("test-fork");
  if (!await page.getByRole("combobox", { name: "Owner", exact: true }).isDisabled()) throw new Error("Publisher control remained writable during source save");
  if (!await page.getByRole("button", { name: "Check now", exact: true }).isDisabled()) throw new Error("Update check could race unsaved publisher");
  await page.getByRole("alert").filter({ hasText: "Update source save failed" }).waitFor();
  if (await page.getByRole("combobox", { name: "Owner", exact: true }).inputValue() !== "bodencrouch") throw new Error("Failed source save left unsaved publisher selected");
  await page.locator("[data-nav='tunnel']").click();
  if (await page.locator("[data-nav='tunnel']").getAttribute("aria-current") !== "page") throw new Error("Navigation does not announce current page");
  if (!await page.locator("[data-nav='tunnel']").evaluate((node) => node === document.activeElement)) throw new Error("Navigation lost keyboard focus during render");
  const modes = page.locator("[data-testid='segmented-setMode']");
  if (await modes.getAttribute("role") !== "group") throw new Error("Mode options missing group semantics");
  let delayedSnapshotFinished = false;
  let snapshotRequests = 0;
  await page.route("**/api/snapshot", async (route) => {
    snapshotRequests++;
    if (snapshotRequests !== 1) return route.continue();
    const response = await route.fetch();
    const snapshot = await response.json();
    snapshot.settings = { ...snapshot.settings, Mode: "proxy" };
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ json: snapshot });
    delayedSnapshotFinished = true;
  });
  await page.locator("[data-testid='refresh-button']").click();
  for (let i = 0; i < 30 && snapshotRequests === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!snapshotRequests) throw new Error("Manual refresh never started");
  let commands = 0;
  await page.route("**/api/action", async (route) => {
    commands++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ json: { result: { ok: false, stderr: "Account policy rejected this change.", code: 1 } } });
  });
  await modes.getByRole("button", { name: "doh", exact: true }).click();
  await page.locator("[data-testid='segmented-setMode'] button:disabled").first().waitFor();
  await page.getByRole("alert").filter({ hasText: "Account policy rejected this change." }).waitFor();
  for (let i = 0; i < 30 && !delayedSnapshotFinished; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!delayedSnapshotFinished) throw new Error("Delayed snapshot did not complete");
  if (await page.locator("[data-testid='segmented-setMode'] button[data-value='proxy']").getAttribute("aria-pressed") === "true") throw new Error("Pre-command snapshot overwrote fresh state");
  if (commands !== 1) throw new Error(`Unexpected parallel command count: ${commands}`);
  await page.locator("[data-nav='account']").click();
  const license = page.locator("[data-testid='account-license-input']");
  if (await license.getAttribute("type") !== "password") throw new Error("License entry is exposed as plain text");
  await license.fill("private-license-regression");
  await page.locator("[data-testid='account-apply-license']").click();
  await waitForPredicate(page, () => document.querySelector("[data-testid='account-license-input']")?.value === "", { timeout: 10000, message: "Consumed credential remained in the input" });
  await page.route("**/api/account", (route) => route.fulfill({ json: { registered: true, accountType: "PRIVATE-ACCOUNT-REGRESSION", consumer: true, license: "private-license-sentinel" } }));
  await page.locator("[data-nav='tunnel']").click();
  await page.locator("[data-nav='account']").click();
  await page.getByText("PRIVATE-ACCOUNT-REGRESSION", { exact: true }).waitFor();
  await page.route("**/api/snapshot", (route) => route.fulfill({ status: 401, json: { error: "Owner authorization expired" } }));
  await page.locator("[data-testid='refresh-button']").click();
  await page.getByRole("alert").filter({ hasText: "--webui" }).waitFor();
  if ((await page.locator("body").innerText()).includes("PRIVATE-ACCOUNT-REGRESSION")) throw new Error("Expired authorization left private account visible");
  const refreshFailure = await bootExpertPage(browser);
  await refreshFailure.route("**/api/snapshot", (route) => route.fulfill({ status: 503, json: { error: "Temporary snapshot outage" } }));
  await refreshFailure.route("**/api/events", (route) => route.fulfill({ contentType: "text/event-stream", body: 'event: warp\ndata: {"line":"Connection changed","status":{"connected":true,"label":"Connected"}}\n\n' }));
  await refreshFailure.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await refreshFailure.getByRole("alert").filter({ hasText: "Temporary snapshot outage" }).waitFor({ timeout: 10000 });
  await refreshFailure.close();
  console.log("Frontend expert regressions OK (metadata escaping, keyboard focus, selection semantics, command suppression, failure announcement)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const force = setTimeout(() => child.kill("SIGKILL"), 1000);
    child.once("exit", () => { clearTimeout(force); resolve(); });
    child.kill("SIGTERM");
  });
  await rm(legacyWorkerPath, { force: true });
  await rm(xdgRoot, { recursive: true, force: true });
}
