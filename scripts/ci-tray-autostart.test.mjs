import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  clearSessionOverrides,
  getConfig,
  persistUserTrayAutostart,
  persistUserTrayShell,
  reloadConfig
} from "../lib/config.mjs";
import {
  buildTrayAutostartDesktop,
  resolveTrayExec,
  syncTrayAutostart,
  trayAutostartPath
} from "../lib/tray/autostart.mjs";
import {
  buildCloudflareHiddenDesktop,
  buildManagedWarpDesktopSvcUnit,
  cloudflareAutostartOverridePath,
  detectCloudflareGui,
  describeTrayShell,
  isThirdflareManagedCloudflareOverride,
  managedWarpDesktopSvcUnitPath,
  resolveWarpGuiBinary,
  shouldWatchStatusNotifications,
  syncCloudflareAutostartOverride,
  syncManagedWarpDesktopSvcUnit,
  syncWarpDesktopSvcUnit,
  syncTrayShell,
  underFlatpak,
  warpGuiSpawnCommand,
  warpProcessPattern,
  WARP_DESKTOP_SVC_PATH,
  WARP_TASKBAR_PATH
} from "../lib/tray/shell.mjs";

test("buildTrayAutostartDesktop is an autostart entry the session will honour", () => {
  const desktop = buildTrayAutostartDesktop({ exec: "/usr/bin/thirdflare-one-tray", icon: "thirdflare" });
  assert.match(desktop, /^Type=Application/m);
  assert.match(desktop, /^Exec=\/usr\/bin\/thirdflare-one-tray/m);
  assert.match(desktop, /^X-GNOME-Autostart-enabled=true/m);
  // Hidden=true in an autostart dir means "ignore this entry" — it is how we
  // disable Cloudflare's autostart, so it must never appear in our own.
  assert.doesNotMatch(desktop, /^Hidden=true/m);
  assert.doesNotMatch(desktop, /^NoDisplay=true/m);
  // The Cloudflare override is the opposite: it exists to be ignored.
  assert.match(buildCloudflareHiddenDesktop(), /^Hidden=true/m);
});

test("syncTrayAutostart writes and removes the desktop file", { skip: process.platform !== "linux" ? "linux-only" : false }, () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-auto-"));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config") };
  const appRoot = join(root, "app");
  mkdirSync(join(appRoot, "bin"), { recursive: true });
  writeFileSync(join(appRoot, "bin", "thirdflare-tray"), "#!/bin/sh\n", { mode: 0o755 });

  try {
    const path = trayAutostartPath(env);
    assert.equal(existsSync(path), false);

    const enabled = syncTrayAutostart({ autostart: true, env, appRoot });
    assert.equal(enabled.written, true);
    assert.equal(existsSync(path), true);
    assert.match(readFileSync(path, "utf8"), new RegExp(`Exec=${join(appRoot, "bin", "thirdflare-tray").replace(/\//g, "\\/")}`));

    const again = syncTrayAutostart({ autostart: true, env, appRoot });
    assert.equal(again.unchanged, true);

    const disabled = syncTrayAutostart({ autostart: false, env, appRoot });
    assert.equal(disabled.removed, true);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserTrayAutostart writes user config and survives reload", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-persist-"));
  const userPath = join(root, ".config", "thirdflare", "config.json");
  mkdirSync(join(root, ".config", "thirdflare"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ ui: { locale: "en" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root };

  try {
    clearSessionOverrides();
    const cfg = persistUserTrayAutostart({ autostart: true }, { env });
    assert.equal(cfg.tray.autostart, true);

    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.ui.locale, "en");
    assert.equal(onDisk.tray.autostart, true);

    clearSessionOverrides();
    const reloaded = reloadConfig(env);
    assert.equal(reloaded.tray.autostart, true);
    assert.equal(getConfig().tray.autostart, true);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveTrayExec prefers FHS wrapper when present", () => {
  if (!existsSync("/usr/bin/thirdflare-one-tray")) {
    assert.equal(resolveTrayExec({}, "/tmp/nope"), "thirdflare-one-tray");
    return;
  }
  assert.equal(resolveTrayExec({}), "/usr/bin/thirdflare-one-tray");
});

test("default tray.shell is cloudflare", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-default-"));
  const env = { ...process.env, HOME: root };
  try {
    clearSessionOverrides();
    const cfg = reloadConfig(env);
    assert.equal(cfg.tray.shell, "cloudflare");
    assert.equal(cfg.tray.autostart, false);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserTrayShell writes shell and survives reload", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-shell-persist-"));
  const userPath = join(root, ".config", "thirdflare", "config.json");
  mkdirSync(join(root, ".config", "thirdflare"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ ui: { locale: "en" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root };

  try {
    clearSessionOverrides();
    const cfg = persistUserTrayShell({ shell: "thirdflare" }, { env });
    assert.equal(cfg.tray.shell, "thirdflare");

    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.ui.locale, "en");
    assert.equal(onDisk.tray.shell, "thirdflare");

    clearSessionOverrides();
    const reloaded = reloadConfig(env);
    assert.equal(reloaded.tray.shell, "thirdflare");
    assert.equal(getConfig().tray.shell, "thirdflare");
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserTrayShell rejects unknown values", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-shell-bad-"));
  const userPath = join(root, ".config", "thirdflare", "config.json");
  mkdirSync(join(root, ".config", "thirdflare"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ ui: { locale: "en" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root };

  try {
    clearSessionOverrides();
    reloadConfig(env);
    const rejected = persistUserTrayShell({ shell: "nope" }, { env });
    assert.equal(rejected, null);
    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.ui.locale, "en");
    assert.equal(onDisk.tray, undefined);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistUserTrayShell keeps the autostart preference across a shell round trip", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-shell-clear-"));
  const userPath = join(root, ".config", "thirdflare", "config.json");
  mkdirSync(join(root, ".config", "thirdflare"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ tray: { autostart: true, shell: "thirdflare" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root };

  try {
    clearSessionOverrides();
    reloadConfig(env);
    const cfg = persistUserTrayShell({ shell: "cloudflare" }, { env });
    assert.equal(cfg.tray.shell, "cloudflare");
    // Remembered, not applied: syncTrayShell writes no entry while Cloudflare is active.
    assert.equal(cfg.tray.autostart, true);
    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));
    assert.equal(onDisk.tray.autostart, true);
    assert.equal(
      describeTrayShell({ shell: "cloudflare", autostart: true, detect: { exists: () => true } }).active,
      "cloudflare"
    );

    const back = persistUserTrayShell({ shell: "thirdflare" }, { env });
    assert.equal(back.tray.shell, "thirdflare");
    assert.equal(back.tray.autostart, true);
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid tray.shell in user JSON falls back to cloudflare", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-shell-norm-"));
  const userPath = join(root, ".config", "thirdflare", "config.json");
  mkdirSync(join(root, ".config", "thirdflare"), { recursive: true });
  writeFileSync(userPath, `${JSON.stringify({ tray: { shell: "nope" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: root };

  try {
    clearSessionOverrides();
    const cfg = reloadConfig(env);
    assert.equal(cfg.tray.shell, "cloudflare");
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectCloudflareGui is true only when both stubs exist", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-cf-detect-"));
  const taskbarPath = join(root, "warp-taskbar");
  const desktopSvcPath = join(root, "warp-desktop-svc");
  try {
    assert.equal(detectCloudflareGui({ taskbarPath, desktopSvcPath }), false);
    writeFileSync(taskbarPath, "");
    assert.equal(detectCloudflareGui({ taskbarPath, desktopSvcPath }), false);
    writeFileSync(desktopSvcPath, "");
    assert.equal(detectCloudflareGui({ taskbarPath, desktopSvcPath }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeTrayShell falls back to thirdflare when Cloudflare GUI is missing", () => {
  const info = describeTrayShell({
    shell: "cloudflare",
    detect: { taskbarPath: "/tmp/missing-warp-taskbar", desktopSvcPath: "/tmp/missing-warp-desktop-svc" }
  });
  assert.equal(info.shell, "cloudflare");
  assert.equal(info.cloudflareAvailable, false);
  assert.equal(info.active, "thirdflare");
});

test("resolveWarpGuiBinary allow-lists host WARP GUI paths", () => {
  const fakeExists = () => true;
  assert.equal(
    resolveWarpGuiBinary("/usr/bin/warp-taskbar", {
      exists: fakeExists,
      realpath: () => "/usr/lib/warp/warp-taskbar"
    }),
    "/usr/lib/warp/warp-taskbar"
  );
  assert.equal(
    resolveWarpGuiBinary("/usr/bin/warp-desktop-svc", {
      exists: fakeExists,
      realpath: () => "/usr/bin/warp-desktop-svc"
    }),
    "/usr/bin/warp-desktop-svc"
  );
  assert.equal(
    resolveWarpGuiBinary("/tmp/evil", { exists: fakeExists, realpath: () => "/tmp/evil" }),
    null
  );
  assert.equal(
    resolveWarpGuiBinary("/usr/bin/warp-taskbar", {
      exists: fakeExists,
      realpath: () => "/tmp/evil"
    }),
    null
  );
});

test("buildCloudflareHiddenDesktop is a managed Hidden override", () => {
  const desktop = buildCloudflareHiddenDesktop();
  assert.match(desktop, /Managed by ThirdFlare One/);
  assert.match(desktop, /^Hidden=true/m);
  assert.match(desktop, /^Exec=\/usr\/bin\/warp-taskbar/m);
  assert.equal(isThirdflareManagedCloudflareOverride(desktop), true);
  assert.equal(isThirdflareManagedCloudflareOverride("[Desktop Entry]\nName=Other\n"), false);
});

test("syncTrayShell writes and removes the Cloudflare Hidden override", {
  skip: process.platform !== "linux" ? "linux-only" : false
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "tf-tray-shell-sync-"));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config") };
  const appRoot = join(root, "app");
  mkdirSync(join(appRoot, "bin"), { recursive: true });
  writeFileSync(join(appRoot, "bin", "thirdflare-tray"), "#!/bin/sh\n", { mode: 0o755 });
  const detect = {
    taskbarPath: join(root, "missing-taskbar"),
    desktopSvcPath: join(root, "missing-svc")
  };

  try {
    const overridePath = cloudflareAutostartOverridePath(env);
    const trayPath = trayAutostartPath(env);

    const thirdflare = await syncTrayShell({
      shell: "thirdflare",
      autostart: true,
      env,
      appRoot,
      manageUnit: false,
      detect
    });
    assert.equal(thirdflare.active, "thirdflare");
    assert.equal(thirdflare.cloudflare.written, true);
    assert.equal(existsSync(overridePath), true);
    assert.match(readFileSync(overridePath, "utf8"), /Hidden=true/);
    assert.equal(existsSync(trayPath), true);

    const cloudflareMissing = await syncTrayShell({
      shell: "cloudflare",
      autostart: true,
      env,
      appRoot,
      manageUnit: false,
      detect
    });
    assert.equal(cloudflareMissing.active, "thirdflare");
    assert.equal(existsSync(overridePath), true);

    writeFileSync(join(root, "warp-taskbar"), "");
    writeFileSync(join(root, "warp-desktop-svc"), "");
    const cloudflare = await syncTrayShell({
      shell: "cloudflare",
      autostart: true,
      env,
      appRoot,
      manageUnit: false,
      detect: {
        taskbarPath: join(root, "warp-taskbar"),
        desktopSvcPath: join(root, "warp-desktop-svc")
      }
    });
    assert.equal(cloudflare.active, "cloudflare");
    assert.equal(cloudflare.cloudflare.removed, true);
    assert.equal(existsSync(overridePath), false);
    assert.equal(existsSync(trayPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncCloudflareAutostartOverride preserves unmanaged user files", {
  skip: process.platform !== "linux" ? "linux-only" : false
}, () => {
  const root = mkdtempSync(join(tmpdir(), "tf-cf-preserve-"));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, ".config") };
  const path = cloudflareAutostartOverridePath(env);
  mkdirSync(join(root, ".config", "autostart"), { recursive: true });
  writeFileSync(path, "[Desktop Entry]\nName=Custom\n");

  try {
    const result = syncCloudflareAutostartOverride({ hide: false, env });
    assert.equal(result.preserved, true);
    assert.equal(existsSync(path), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncTrayShell is a no-op on non-linux", async () => {
  const result = await syncTrayShell({ shell: "thirdflare", platform: "darwin", manageUnit: false });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "non-linux");
});

test("sync-tray-autostart --shell thirdflare persists without prompting", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-sync-shell-"));
  const userDir = join(root, ".config", "thirdflare");
  mkdirSync(userDir, { recursive: true });
  const env = {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: join(root, ".config"),
    THIRDFLARE_TRAY_SKIP_SYSTEMD: "1",
    THIRDFLARE_TRAY_LIVE: "0"
  };
  const syncScript = join(dirname(fileURLToPath(import.meta.url)), "sync-tray-autostart.mjs");
  try {
    execFileSync(process.execPath, [syncScript, "--shell", "thirdflare"], { env, encoding: "utf8" });
    const onDisk = JSON.parse(readFileSync(join(userDir, "config.json"), "utf8"));
    assert.equal(onDisk.tray.shell, "thirdflare");
    assert.equal(onDisk.tray.autostart, true);

    execFileSync(process.execPath, [syncScript, "--shell", "cloudflare"], { env, encoding: "utf8" });
    const cloudflare = JSON.parse(readFileSync(join(userDir, "config.json"), "utf8"));
    assert.equal(cloudflare.tray.shell, "cloudflare");
    // The preference is remembered on every platform.
    assert.equal(cloudflare.tray.autostart, true);
    // The entry itself is Linux-only (syncTrayAutostart no-ops elsewhere), and
    // whether it belongs there depends on whether this host actually has
    // Cloudflare One Client — without it the active shell is thirdflare.
    if (process.platform === "linux") {
      const active = describeTrayShell({ shell: "cloudflare", autostart: true }).active;
      assert.equal(existsSync(trayAutostartPath(env)), active === "thirdflare");
    }

    // --if-unset seeds a default; it must never overwrite an existing choice.
    execFileSync(process.execPath, [syncScript, "--shell", "thirdflare", "--if-unset"], { env, encoding: "utf8" });
    const kept = JSON.parse(readFileSync(join(userDir, "config.json"), "utf8"));
    assert.equal(kept.tray.shell, "cloudflare");
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-tray-autostart --shell rejects unknown values", () => {
  const syncScript = join(dirname(fileURLToPath(import.meta.url)), "sync-tray-autostart.mjs");
  try {
    execFileSync(process.execPath, [syncScript, "--shell", "nope"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"]
    });
    assert.fail("expected non-zero exit");
  } catch (error) {
    assert.equal(error.status, 2);
  }
});

test("Cloudflare One Client owns status notifications while it is active", () => {
  assert.equal(shouldWatchStatusNotifications({ notifications: true, active: "cloudflare" }), false);
  assert.equal(shouldWatchStatusNotifications({ notifications: true, active: "thirdflare" }), true);
  assert.equal(shouldWatchStatusNotifications({ notifications: false, active: "thirdflare" }), false);
  assert.equal(shouldWatchStatusNotifications({ notifications: false, active: "cloudflare" }), false);
});

test("underFlatpak follows FLATPAK_ID", () => {
  assert.equal(underFlatpak({}), false);
  assert.equal(underFlatpak({ FLATPAK_ID: "one.thirdflare.One" }), true);
});

test("warpGuiSpawnCommand allow-lists and resolves the host binary", () => {
  const exists = (path) => path === WARP_TASKBAR_PATH;
  const realpath = () => "/usr/lib/warp/warp-taskbar";

  const taskbar = warpGuiSpawnCommand(WARP_TASKBAR_PATH, { env: {}, exists, realpath });
  assert.deepEqual(taskbar, {
    command: "/usr/lib/warp/warp-taskbar",
    args: [],
    path: "/usr/lib/warp/warp-taskbar",
    host: false
  });

  assert.equal(warpGuiSpawnCommand("/usr/bin/warp-cli", { env: {}, exists, realpath }), null);
  assert.equal(warpGuiSpawnCommand("/tmp/evil", { env: {}, exists, realpath }), null);
  assert.equal(warpGuiSpawnCommand(WARP_DESKTOP_SVC_PATH, { env: {}, exists, realpath }), null);
});

test("warpGuiSpawnCommand hops to the host under Flatpak", () => {
  const env = { FLATPAK_ID: "one.thirdflare.One" };
  const hostExists = (path) => path === WARP_TASKBAR_PATH;

  assert.deepEqual(warpGuiSpawnCommand(WARP_TASKBAR_PATH, { env, hostExists }), {
    command: "flatpak-spawn",
    args: ["--host", WARP_TASKBAR_PATH],
    path: WARP_TASKBAR_PATH,
    host: true
  });
  assert.equal(warpGuiSpawnCommand(WARP_DESKTOP_SVC_PATH, { env, hostExists }), null);
});

test("detectCloudflareGui probes the host filesystem under Flatpak", () => {
  const env = { FLATPAK_ID: "one.thirdflare.One" };
  const sandboxOnly = () => false;

  assert.equal(
    detectCloudflareGui({ env, exists: sandboxOnly, hostExists: () => true }),
    true
  );
  assert.equal(
    detectCloudflareGui({ env, exists: () => true, hostExists: sandboxOnly }),
    false
  );
});

test("buildManagedWarpDesktopSvcUnit runs warp-desktop-svc and carries the managed marker", () => {
  const unit = buildManagedWarpDesktopSvcUnit(WARP_DESKTOP_SVC_PATH);
  assert.equal(isThirdflareManagedCloudflareOverride(unit), true);
  assert.match(unit, new RegExp(`^ExecStart=${WARP_DESKTOP_SVC_PATH}$`, "m"));
  assert.match(unit, /^WantedBy=graphical-session.target$/m);
});

test("syncManagedWarpDesktopSvcUnit writes, reuses, and removes the fallback unit", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-warp-unit-"));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, ".config") };

  try {
    const path = managedWarpDesktopSvcUnitPath(env);
    assert.equal(existsSync(path), false);

    const written = syncManagedWarpDesktopSvcUnit({ install: true, env });
    assert.equal(written.written, true);
    assert.equal(existsSync(path), true);

    const again = syncManagedWarpDesktopSvcUnit({ install: true, env });
    assert.equal(again.unchanged, true);

    const removed = syncManagedWarpDesktopSvcUnit({ install: false, env });
    assert.equal(removed.removed, true);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncManagedWarpDesktopSvcUnit never deletes a unit it did not write", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-warp-unit-keep-"));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, ".config") };
  const path = managedWarpDesktopSvcUnitPath(env);

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "[Unit]\nDescription=hand written\n");

    const result = syncManagedWarpDesktopSvcUnit({ install: false, env });
    assert.equal(result.preserved, true);
    assert.equal(existsSync(path), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("warpProcessPattern matches the symlink and its WARP-tree target", () => {
  const pattern = warpProcessPattern(WARP_TASKBAR_PATH, { realpath: () => "/usr/lib/warp/warp-taskbar" });
  const matches = new RegExp(`^${pattern}$`);

  assert.equal(matches.test(WARP_TASKBAR_PATH), true);
  assert.equal(matches.test("/usr/lib/warp/warp-taskbar"), true);
  assert.equal(matches.test("/usr/bin/warp-taskbar --debug"), true);
  assert.equal(matches.test("/tmp/warp-taskbar"), false);
  assert.equal(matches.test("warp-taskbar"), false);
});

test("warpProcessPattern ignores a link target outside the WARP tree", () => {
  const pattern = warpProcessPattern(WARP_TASKBAR_PATH, { realpath: () => "/tmp/evil" });
  assert.equal(new RegExp(`^${pattern}$`).test("/tmp/evil"), false);
});

test("warpProcessPattern covers the 16-character warp-desktop-svc name", () => {
  const pattern = warpProcessPattern(WARP_DESKTOP_SVC_PATH, {
    realpath: () => WARP_DESKTOP_SVC_PATH
  });
  assert.equal(new RegExp(`^${pattern}$`).test(WARP_DESKTOP_SVC_PATH), true);
});

test("syncWarpDesktopSvcUnit leaves unit management to the host under Flatpak", {
  skip: process.platform !== "linux" ? "linux-only" : false
}, async () => {
  const result = await syncWarpDesktopSvcUnit({
    enable: true,
    env: { ...process.env, FLATPAK_ID: "one.thirdflare.One" }
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "flatpak");
});

test("describeTrayShell threads env into Cloudflare detection", () => {
  const flatpak = { FLATPAK_ID: "one.thirdflare.One" };

  // Sandbox paths are empty; the host has WARP. Detection must follow env.
  const onHost = describeTrayShell({
    shell: "cloudflare",
    env: flatpak,
    detect: { exists: () => false, hostExists: () => true }
  });
  assert.equal(onHost.cloudflareAvailable, true);
  assert.equal(onHost.active, "cloudflare");

  const noHostWarp = describeTrayShell({
    shell: "cloudflare",
    env: flatpak,
    detect: { exists: () => true, hostExists: () => false }
  });
  assert.equal(noHostWarp.cloudflareAvailable, false);
  assert.equal(noHostWarp.active, "thirdflare");
});

test("sync-tray-autostart --if-unset seeds a first choice", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-sync-seed-"));
  const userDir = join(root, ".config", "thirdflare");
  mkdirSync(userDir, { recursive: true });
  const env = {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: join(root, ".config"),
    THIRDFLARE_TRAY_SKIP_SYSTEMD: "1",
    THIRDFLARE_TRAY_LIVE: "0"
  };
  const syncScript = join(dirname(fileURLToPath(import.meta.url)), "sync-tray-autostart.mjs");
  try {
    execFileSync(process.execPath, [syncScript, "--shell", "thirdflare", "--if-unset"], { env, encoding: "utf8" });
    const onDisk = JSON.parse(readFileSync(join(userDir, "config.json"), "utf8"));
    assert.equal(onDisk.tray.shell, "thirdflare");
  } finally {
    clearSessionOverrides();
    reloadConfig(process.env);
    rmSync(root, { recursive: true, force: true });
  }
});
