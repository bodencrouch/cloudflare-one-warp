/**
 * Thin UI smoke using Playwright library (Plane M).
 * Boots the daemon with mock warp-cli, opens Chromium, checks Home + Account outcomes.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createHttpJson } from "./ci-http-client.mjs";
import { waitForPredicate } from "./ui-wait.mjs";

const root = process.cwd();
const port = Number(process.env.CI_UI_PORT || 14740);
const mockWarp = process.env.WARP_CLI || join(root, "scripts/mock-warp-cli.mjs");
const systemChrome = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome-stable"].find(
  (p) => existsSync(p)
);

const httpJson = createHttpJson(`http://127.0.0.1:${port}`);

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    WARP_CLI: mockWarp,
    THIRDFLARE_WEBUI: "1",
    THIRDFLARE_NOTIFICATIONS: "0",
    THIRDFLARE_NFT_NO_PKEXEC: "1",
    THIRDFLARE_TRAY_SKIP_SYSTEMD: "1",
    THIRDFLARE_TRAY_LIVE: "0",
    MOCK_WARP_STATE: join(root, ".tmp-mock-warp-ui.json")
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

let browser;

try {
  await waitHealth();
  await httpJson("POST", "/api/action", { action: "disconnect" });
  await httpJson("POST", "/api/action", { action: "deleteRegistration" });

  const launchOpts = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  };
  if (systemChrome && process.env.PLAYWRIGHT_USE_BUNDLED !== "1") {
    launchOpts.executablePath = systemChrome;
  }
  browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("[data-testid='log-dock']").waitFor({ timeout: 20000 });
  await page.goto(`http://127.0.0.1:${port}/?shell=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate(() => localStorage.setItem("thirdflare-ui-expert", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-testid='log-dock']").waitFor({ timeout: 20000 });
  const dockPinned = await page.evaluate(() => {
    const dock = document.querySelector("[data-testid='log-dock']");
    if (!dock) return false;
    const rect = dock.getBoundingClientRect();
    return rect.bottom <= window.innerHeight + 1 && rect.top < window.innerHeight;
  });
  if (!dockPinned) throw new Error("log-dock not pinned to viewport in native expert shell");
  await page.locator("[data-log-tab='console']").click();
  await waitForPredicate(
    page,
    () => {
      const tab = document.querySelector("[data-log-tab='console']");
      const body = document.querySelector(".log-dock-body");
      return Boolean(tab?.classList.contains("active") && body?.querySelector(".log-dock-console, .log-console-empty"));
    },
    { timeout: 10000, message: "console log tab did not activate" }
  );
  const toggle = page.locator("[data-testid='connection-toggle']");
  await toggle.waitFor({ timeout: 20000 });
  await httpJson("POST", "/api/action", { action: "register" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await toggle.waitFor({ timeout: 20000 });
  await toggle.click();
  await waitForPredicate(
    page,
    () => {
      const el = document.querySelector("[data-testid='connection-toggle']");
      return Boolean(el && (el.getAttribute("aria-pressed") === "true" || /disconnect/i.test(el.textContent || "")));
    },
    { timeout: 15000, message: "connection toggle did not reach the connected state" }
  );

  await page.locator("[data-nav='account']").click();
  await page.locator("[data-testid='account-register']").waitFor({ timeout: 20000 });
  await page.locator("[data-nav='split']").click();
  await page.getByText("Everything through WARP except certain sites").waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "App routing" }).waitFor({ timeout: 15000 });
  const routingDump = page.locator("details[data-panel-id='split-dump'] summary");
  await routingDump.click();
  const dumpOpen = () => document.querySelector("details[data-panel-id='split-dump']")?.open === true;
  await waitForPredicate(page, dumpOpen, { timeout: 5000, message: "split dump panel did not open" });
  await page.waitForTimeout(3500);
  await waitForPredicate(page, dumpOpen, { timeout: 5000, message: "split dump panel closed itself on refresh" });
  await httpJson("POST", "/api/action", { action: "deleteRegistration" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-nav='account']").click();
  await page.locator("[data-testid='account-register']").click();
  await waitForPredicate(
    page,
    () => {
      const strip = document.querySelector(".account-status-strip");
      return Boolean(
        strip && /Registered/i.test(strip.textContent || "") && !/Not registered/i.test(strip.textContent || "")
      );
    },
    { timeout: 15000, message: "account status strip did not report Registered" }
  );
  console.log("UI smoke OK (connect toggle + account register outcomes)");
  process.exitCode = 0;
} catch (err) {
  console.error("UI smoke FAIL", err);
  process.exitCode = 1;
} finally {
  // Without this the browser keeps the event loop alive and a failing run hangs
  // instead of reporting.
  await browser?.close().catch(() => {});
  child.kill("SIGTERM");
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 500).unref();
}
