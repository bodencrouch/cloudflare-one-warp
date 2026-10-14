import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  clearSessionOverrides,
  getConfig,
  isValidServerPort,
  persistUserServer,
  persistUserWebUi,
  persistUserUi,
  reloadConfig,
  setSessionOverrides
} from "../lib/config.mjs";

test("isValidServerPort accepts 1024-65535", () => {
  assert.equal(isValidServerPort(4173), true);
  assert.equal(isValidServerPort(1023), false);
  assert.equal(isValidServerPort(65536), false);
});

test("persistUserWebUi writes user config without clobbering other keys", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-one-warp-webui-persist-"));
  const userPath = join(root, ".config", "cloudflare-one-warp", "config.json");
  mkdirSync(join(root, ".config", "cloudflare-one-warp"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ ui: { locale: "en" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config") };

  try {
    clearSessionOverrides();
    const cfg = persistUserWebUi({ enabled: true }, { env });
    assert.equal(cfg.webui.enabled, true);

    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.ui.locale, "en");
    assert.equal(onDisk.webui.enabled, true);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserServer validates port range via caller", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-one-warp-server-persist-"));
  const userPath = join(root, ".config", "cloudflare-one-warp", "config.json");
  mkdirSync(join(root, ".config", "cloudflare-one-warp"), { recursive: true });
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config") };

  try {
    clearSessionOverrides();
    const cfg = persistUserServer({ port: 4180 }, { env });
    assert.equal(cfg.server.port, 4180);
    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.server.port, 4180);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("session override ignores webui.enabled", () => {
  clearSessionOverrides();
  const before = getConfig().webui?.enabled;
  setSessionOverrides({ webui: { enabled: true } });
  assert.equal(getConfig().webui?.enabled, before);
  clearSessionOverrides();
});

test("CLOUDFLARE_ONE_WARP_WEBUI=1 overrides file enabled:false at process start", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-one-warp-webui-env-"));
  const userPath = join(root, ".config", "cloudflare-one-warp", "config.json");
  mkdirSync(join(root, ".config", "cloudflare-one-warp"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ webui: { enabled: false } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config"), CLOUDFLARE_ONE_WARP_WEBUI: "1" };

  try {
    clearSessionOverrides();
    const cfg = reloadConfig(env);
    assert.equal(cfg.webui.enabled, true);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserUi writes notifications preference", () => {
  const root = mkdtempSync(join(tmpdir(), "cf-one-warp-ui-persist-"));
  const userPath = join(root, ".config", "cloudflare-one-warp", "config.json");
  mkdirSync(join(root, ".config", "cloudflare-one-warp"), { recursive: true });
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config") };

  try {
    clearSessionOverrides();
    const cfg = persistUserUi({ notifications: false }, { env });
    assert.equal(cfg.ui.notifications, false);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persisted notifications replace session override immediately and failed writes preserve it", () => {
  const root = mkdtempSync(join(tmpdir(), "warp-ui-session-"));
  const env = { HOME: root };
  try {
    clearSessionOverrides();
    setSessionOverrides({ ui: { notifications: false } });
    assert.equal(persistUserUi({ notifications: true }, { env }).ui.notifications, true);
    assert.equal(getConfig().ui.notifications, true);
    setSessionOverrides({ ui: { notifications: false } });
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory");
    assert.throws(() => persistUserUi({ notifications: true }, { env, userPath: join(blocker, "config.json") }));
    assert.equal(getConfig().ui.notifications, false);
  } finally { clearSessionOverrides(); reloadConfig(); rmSync(root, { recursive: true, force: true }); }
});

test("XDG configuration migrates prior user settings and rejects corrupt writes", () => {
  const root = mkdtempSync(join(tmpdir(), "warp-xdg-config-"));
  const prior = join(root, ".config/cloudflare-one-warp/config.json");
  const current = join(root, "custom/cloudflare-one-warp/config.json");
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, "custom") };
  try {
    mkdirSync(join(root, ".config/cloudflare-one-warp"), { recursive: true });
    writeFileSync(prior, JSON.stringify({ server: { port: 49871 }, ui: { locale: "fr" } }));
    const cfg = persistUserUi({ notifications: false }, { env });
    assert.equal(cfg.server.port, 49871);
    assert.equal(JSON.parse(readFileSync(current)).ui.locale, "fr");
    writeFileSync(current, "{broken");
    assert.throws(() => persistUserUi({ notifications: true }, { env }));
    assert.equal(readFileSync(current, "utf8"), "{broken");
  } finally { clearSessionOverrides(); reloadConfig(); rmSync(root, { recursive: true, force: true }); }
});

test("legacy remote settings cannot expose the control plane", async () => {
  const { effectiveBind, isValidServerBind } = await import("../lib/config.mjs");
  assert.equal(effectiveBind({server:{bind:"0.0.0.0"},webui:{enabled:true,allowRemote:true}}), "127.0.0.1");
  assert.equal(effectiveBind({server:{bind:"localhost"}}), "127.0.0.1");
  assert.equal(effectiveBind({server:{bind:"::1"}}), "::1");
  assert.equal(isValidServerBind("192.168.1.2"), false);
});

test("launcher reuses unmanaged API daemon and separately starts requested Web UI", { skip: process.platform === "win32", timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "warp-unmanaged-launcher-"));
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"),
    XDG_RUNTIME_DIR: join(root, "run"), XDG_CACHE_HOME: join(root, "cache"),
    CLOUDFLARE_ONE_WARP_PORT: String(port), CLOUDFLARE_ONE_WARP_WEBUI: "0",
    CLOUDFLARE_ONE_WARP_CLI: join(repository, "scripts/mock-warp-cli.mjs") };
  const daemon = spawn(process.execPath, [join(repository, "server.js")], { env, stdio: "ignore" });
  const run = promisify(execFile);
  const launcher = join(repository, "bin/cloudflare-one-warp");
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  let managedPid;
  try {
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      try { ready = (await (await fetch(healthUrl)).json()).ok; if (ready) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    const tokenPath = join(root, "config/cloudflare-one-warp", `session-${port}.token`);
    const token = readFileSync(tokenPath, "utf8");
    const api = await run(launcher, ["--no-open"], { env });
    assert.equal(api.stdout.trim(), `http://127.0.0.1:${port}`);
    assert.match((await run(launcher, ["--status"], { env })).stdout, new RegExp(`:${port}`));
    const ui = await run(launcher, ["--daemon"], { env });
    assert.notEqual(ui.stdout.trim(), `http://127.0.0.1:${port}`);
    managedPid = Number(readFileSync(join(root, "run/cloudflare-one-warp/server.pid"), "utf8"));
    const uiHealth = await (await fetch(`${ui.stdout.trim()}/api/health`)).json();
    assert.equal(uiHealth.webuiEnabled, true);
    assert.equal((await (await fetch(healthUrl)).json()).webuiEnabled, false);
    assert.equal(readFileSync(tokenPath, "utf8"), token);
    const repeated = await run(launcher, ["--daemon"], { env });
    assert.equal(repeated.stdout, ui.stdout);
    assert.equal(Number(readFileSync(join(root, "run/cloudflare-one-warp/server.pid"), "utf8")), managedPid);
  } finally {
    if (managedPid) { try { process.kill(managedPid); } catch {} }
    daemon.kill();
    await once(daemon, "exit").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed saved configuration cannot destroy typed defaults or pollute merged prototypes", async () => {
  const { deepMerge, loadConfig } = await import("../lib/config.mjs");
  const merged = deepMerge({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(merged.polluted, undefined);
  assert.equal(Object.hasOwn(merged, "constructor"), false);
  const directory = mkdtempSync(join(tmpdir(), "warp-invalid-config-"));
  const configHome = join(directory, "config");
  mkdirSync(join(configHome, "cloudflare-one-warp"), { recursive: true });
  writeFileSync(join(configHome, "cloudflare-one-warp", "config.json"), JSON.stringify({
    server: { port: 1.5 }, ui: { notifications: "false", theme: {} }, warp: null, tray: []
  }));
  try {
    const config = loadConfig({ HOME: directory, XDG_CONFIG_HOME: configHome });
    assert.equal(config.server.port, 4173);
    assert.equal(config.warp.cli, "warp-cli");
    assert.equal(config.warp.killSwitch, false);
    assert.equal(config.ui.notifications, true);
    assert.equal(config.ui.theme, "system");
    assert.equal(config.tray.shell, "cloudflare");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
