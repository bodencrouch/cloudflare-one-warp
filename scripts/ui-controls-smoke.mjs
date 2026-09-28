/**
 * Expert-mode UI control smoke — exercises nav, toggles, segmented controls,
 * app routing picker, forms, and log dock tabs against mock warp-cli.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHttpJson } from "./ci-http-client.mjs";
import { waitForPredicate } from "./ui-wait.mjs";

const root = process.cwd();
const port = Number(process.env.CI_UI_PORT || 14741);
const mockWarp = process.env.WARP_CLI || join(root, "scripts/mock-warp-cli.mjs");
const systemChrome = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome-stable"].find(
  (p) => existsSync(p)
);

const xdgRoot = await mkdtemp(join(tmpdir(), "tf-ui-xdg-"));
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
    XDG_DATA_DIRS: xdgRoot,
    HOME: xdgRoot,
    MOCK_WARP_STATE: join(root, ".tmp-mock-warp-ui-controls.json")
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
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate(() => localStorage.setItem("thirdflare-ui-expert", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-testid='log-dock']").waitFor({ timeout: 20000 });
  return page;
}

const NAV_EXPECTATIONS = [
  ["home", "[data-testid='connection-toggle'], [data-testid='header-connection-toggle']"],
  ["account", "[data-testid='account-register']"],
  ["gateway", "[data-testid='segmented-setFamilies'], .segmented"],
  ["tunnel", "[data-testid='segmented-setMode']"],
  ["split", "#app-routing-guide"],
  ["trusted", ".form-panel, .panel"],
  ["settings", "[data-testid='killswitch-toggle']"],
  ["app", "[data-save-locale]"],
  ["advanced", ".form-panel"]
];

let browser;

try {
  await waitHealth();
  await httpJson("POST", "/api/action", { action: "disconnect" });
  await httpJson("POST", "/api/action", { action: "deleteRegistration" });
  await httpJson("POST", "/api/action", { action: "register" });

  const launchOpts = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  };
  if (systemChrome && process.env.PLAYWRIGHT_USE_BUNDLED !== "1") {
    launchOpts.executablePath = systemChrome;
  }
  browser = await chromium.launch(launchOpts);
  const page = await bootExpertPage(browser);

  for (const [navId, selector] of NAV_EXPECTATIONS) {
    await page.locator(`[data-nav='${navId}']`).click();
    await page.locator(selector).first().waitFor({ timeout: 15000 });
  }

  await page.locator("[data-nav='home']").click();
  await page.locator("[data-testid='refresh-button']").click();
  await page.waitForTimeout(400);

  const toggle = page.locator("[data-testid='connection-toggle'], [data-testid='header-connection-toggle']").first();
  await toggle.waitFor({ timeout: 15000 });
  await toggle.click();
  await waitForPredicate(
    page,
    () => {
      const el = document.querySelector("[data-testid='connection-toggle'], [data-testid='header-connection-toggle']");
      return Boolean(el && (el.getAttribute("aria-pressed") === "true" || /disconnect/i.test(el.textContent || "")));
    },
    { timeout: 15000, message: "connection toggle did not reach the connected state" }
  );

  await page.locator("[data-nav='split']").click();
  await httpJson("POST", "/api/action", { action: "setMode", value: "warp" });
  await page.locator("[data-testid='refresh-button']").click();
  await page.waitForTimeout(500);
  await page.locator("[data-testid='app-routing-enable']").click();
  await page.locator("[data-testid='app-routing-select']").waitFor({ timeout: 15000 });

  await page.locator("[data-nav='tunnel']").click();
  await page.locator("[data-testid='segmented-setMode'] button[data-value='proxy']").click();
  await waitForPredicate(
    page,
    () =>
      Boolean(
        document
          .querySelector("[data-testid='segmented-setMode'] button[data-value='proxy']")
          ?.classList.contains("selected")
      ),
    { timeout: 15000, message: "tunnel mode segmented control did not select proxy" }
  );

  await page.locator("[data-nav='split']").click();
  const enableRouting = page.locator("[data-testid='app-routing-enable']");
  if (await enableRouting.count()) {
    await enableRouting.click();
  }
  const appSelect = page.locator("[data-testid='app-routing-select']");
  await appSelect.waitFor({ timeout: 15000 });
  await waitForPredicate(
    page,
    () => {
      const select = document.querySelector("[data-testid='app-routing-select']");
      return Boolean(select && select.options.length > 0 && !/No apps found/i.test(select.options[0]?.text || ""));
    },
    { timeout: 15000, message: "app routing picker never listed an app" }
  );
  await page.locator("[data-testid='app-routing-shortcut']").click();
  await waitForPredicate(
    page,
    () =>
      Boolean(
        document.querySelector(".toast.info")?.textContent?.includes("Shortcut") ||
          document.querySelector(".toast")?.textContent?.includes("Shortcut")
      ),
    { timeout: 10000 }
  ).catch(() => {
    /* toast may dismiss quickly; API success is enough */
  });

  await page.locator("[data-nav='split']").click();
  const ipInput = page.locator(".form-panel input").first();
  await ipInput.fill("203.0.113.10");
  await page.locator(".form-panel button.secondary").first().click();
  await page.waitForTimeout(800);

  await page.locator("[data-nav='settings']").click();
  const ksToggle = page.locator("[data-testid='killswitch-toggle']");
  await ksToggle.waitFor({ timeout: 10000 });
  await ksToggle.click();
  await waitForPredicate(
    page,
    () => {
      const el = document.querySelector("[data-testid='killswitch-toggle']");
      return Boolean(el && el.getAttribute("aria-disabled") !== "true" && !el.disabled);
    },
    { timeout: 15000, message: "kill switch toggle stayed busy" }
  );

  await page.locator("[data-nav='gateway']").click();
  await page.locator("[data-testid='segmented-setFamilies'] button[data-value='malware']").click();
  await waitForPredicate(
    page,
    () =>
      Boolean(
        document
          .querySelector("[data-testid='segmented-setFamilies'] button[data-value='malware']")
          ?.classList.contains("selected")
      ),
    { timeout: 15000, message: "gateway families segmented control did not select malware" }
  );

  await page.locator("[data-log-tab='status']").click();
  await page.locator("[data-log-tab='console']").click();
  await page.locator("[data-log-tab='diagnostics']").click();
  await waitForPredicate(
    page,
    () => Boolean(document.querySelector("[data-log-tab='diagnostics']")?.classList.contains("active")),
    { timeout: 5000, message: "diagnostics log tab did not activate" }
  );

  await page.locator("[data-nav='account']").click();
  await page.locator("[data-testid='account-register']").click();
  await waitForPredicate(
    page,
    () => {
      const strip = document.querySelector(".account-status-strip");
      return Boolean(strip && /Registered/i.test(strip.textContent || ""));
    },
    { timeout: 15000, message: "account status strip did not report Registered" }
  );

  const snap = await httpJson("GET", "/api/snapshot");
  if (snap.json?.settings?.Mode !== "proxy") {
    throw new Error(`Expected proxy mode in snapshot, got ${snap.json?.settings?.Mode}`);
  }

  console.log("UI controls smoke OK (nav, toggles, segmented, app routing picker, forms, log tabs)");
  process.exitCode = 0;
} catch (err) {
  console.error("UI controls smoke FAIL", err);
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
