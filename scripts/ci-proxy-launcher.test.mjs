import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createProxyLauncher,
  cleanupOwnedProxyLaunchers,
  listDesktopApps,
  desktopExecArgs,
  sanitizeExec
} from "../lib/apps/proxy-launcher.mjs";

// listDesktopApps() returns [] anywhere but Linux/FreeBSD by design, so the
// XDG cases cannot pass on macOS or Windows. sanitizeExec is pure and still runs.
const xdgOnly = {
  skip: process.platform !== "linux" && process.platform !== "freebsd"
    ? "XDG desktop entries are Linux/FreeBSD only"
    : false
};

test("sanitizeExec strips desktop field codes", () => {
  assert.equal(sanitizeExec("firefox %u"), "firefox");
  assert.equal(sanitizeExec("konsole -e %f"), "konsole -e");
});

test("listDesktopApps reads XDG applications", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cf-one-warp-apps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appsDir = join(root, "applications");
  await mkdir(appsDir, { recursive: true });
  await writeFile(
    join(appsDir, "demo-app.desktop"),
    `[Desktop Entry]
Type=Application
Name=Demo Browser
Exec=demo-browser %u
Icon=demo
`,
    "utf8"
  );
  const env = { XDG_DATA_DIRS: root, HOME: root };
  const apps = await listDesktopApps(env);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].id, "demo-app");
  assert.equal(apps[0].name, "Demo Browser");
});

test("createProxyLauncher writes script and desktop entry", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cf-one-warp-launch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appsDir = join(root, "share", "applications");
  await mkdir(appsDir, { recursive: true });
  await writeFile(
    join(appsDir, "demo-app.desktop"),
    `[Desktop Entry]
Type=Application
Name=Demo Browser
Exec=demo-browser %u
Icon=demo
`,
    "utf8"
  );
  const env = {
    HOME: root,
    XDG_DATA_HOME: join(root, ".local/share"),
    XDG_DATA_DIRS: join(root, "share")
  };
  const result = await createProxyLauncher({ appId: "demo-app", port: 40000, env });
  assert.equal(result.ok, true);
  const script = await readFile(result.scriptPath, "utf8");
  assert.match(script, /ALL_PROXY="socks5h:\/\/127\.0\.0\.1:40000"/);
  assert.match(script, /exec demo-browser/);
  const desktop = await readFile(result.desktopPath, "utf8");
  assert.match(desktop, /Demo Browser \(through WARP\)/);
});

test("desktop Exec arguments remain literal shell metacharacters", () => {
  assert.equal(sanitizeExec('demo "$(touch /tmp/injected)" "a; b" %%'), "demo '$(touch /tmp/injected)' 'a; b' '%'");
  assert.throws(() => sanitizeExec('demo "unclosed'));
  assert.throws(() => sanitizeExec('demo --file=%u'));
});

test("user XDG apps override system apps including Hidden masks", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp-xdg-apps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "user"), XDG_DATA_DIRS: join(root, "system") };
  for (const dir of [env.XDG_DATA_HOME, env.XDG_DATA_DIRS]) {
    await mkdir(join(dir, "applications"), { recursive: true });
    await writeFile(join(dir, "applications", "demo.desktop"), `[Desktop Entry]\nType=Application\nName=Demo\nExec=demo\n${dir === env.XDG_DATA_HOME ? "Hidden=true\n" : ""}`);
  }
  assert.deepEqual(await listDesktopApps(env), []);
});

test("generated proxy script preserves argv without command substitution", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp proxy argv "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "user data"), XDG_DATA_DIRS: join(root, "system") };
  const appsDir = join(env.XDG_DATA_HOME, "applications");
  await mkdir(appsDir, { recursive: true });
  const recorder = join(root, "argv.mjs");
  await writeFile(recorder, "console.log(JSON.stringify(process.argv.slice(2)))");
  await writeFile(join(appsDir, "demo.desktop"), `[Desktop Entry]\nType=Application\nName=Literal Args\nExec="${process.execPath}" "${recorder}" "$(echo injected)" "a; b" "it's literal" %u\n`);
  const result = await createProxyLauncher({ appId: "demo", env });
  assert.equal(result.ok, true);
  const output = execFileSync("sh", [result.scriptPath], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), ["$(echo injected)", "a; b", "it's literal"]);
  assert.match(await readFile(result.desktopPath, "utf8"), /Exec=".*user data.*"/);
});


test("desktop metadata expands as literal separate arguments", () => {
  assert.deepEqual(desktopExecArgs("demo %c %i %k %U", { name: "A $(bad) name", icon: "some icon", path: "/a b.desktop" }),
    ["demo", "A $(bad) name", "--icon", "some icon", "/a b.desktop"]);
  assert.deepEqual(desktopExecArgs("demo %i", {}), ["demo"]);
  assert.throws(() => desktopExecArgs("demo %c"));
});

test("nested and Flatpak symlink desktop entries are discovered with XDG IDs", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const apps = join(root, "data", "applications");
  await mkdir(join(apps, "nested"), { recursive: true });
  const entry = "[Desktop Entry]\nType=Application\nName=Flatpak\nExec=flatpak run demo\n";
  await writeFile(join(root, "export.desktop"), entry);
  await symlink(join(root, "export.desktop"), join(apps, "flatpak.desktop"));
  await writeFile(join(apps, "nested", "app.desktop"), entry);
  await writeFile(join(apps, "huge.desktop"), "x".repeat(300000));
  execFileSync("mkfifo", [join(apps, "fifo.desktop")]);
  assert.deepEqual((await listDesktopApps({ HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_DATA_DIRS: "relative" })).map(app => app.id).sort(), ["flatpak", "nested-app"]);
});

test("launcher clears bypass settings and exports lowercase proxy variables", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_DATA_DIRS: "relative" };
  await mkdir(join(env.XDG_DATA_HOME, "applications"), { recursive: true });
  const recorder = join(root, "record.mjs");
  await writeFile(recorder, "console.log(JSON.stringify(Object.fromEntries(['http_proxy','https_proxy','all_proxy','NO_PROXY','no_proxy'].map(k=>[k,process.env[k] ?? null]))))");
  await writeFile(join(env.XDG_DATA_HOME, "applications", "demo.desktop"), `[Desktop Entry]\nType=Application\nName=Demo\nExec="${process.execPath}" "${recorder}"\n`);
  const launcher = await createProxyLauncher({ appId: "demo", env });
  const output = JSON.parse(execFileSync("sh", [launcher.scriptPath], { encoding: "utf8", env: { ...process.env, NO_PROXY: "*", no_proxy: "*" } }));
  assert.deepEqual(output, { http_proxy: "http://127.0.0.1:40000", https_proxy: "http://127.0.0.1:40000", all_proxy: "socks5h://127.0.0.1:40000", NO_PROXY: null, no_proxy: null });
  assert.equal((await stat(launcher.scriptPath)).mode & 0o777, 0o700);
  assert.equal((await createProxyLauncher({ appId: "demo", port: 40001, env })).ok, true);
  const victim = join(root, "victim");
  await writeFile(victim, "untouched");
  await rm(launcher.scriptPath);
  await symlink(victim, launcher.scriptPath);
  assert.equal((await createProxyLauncher({ appId: "demo", env })).ok, false);
  assert.equal(await readFile(victim, "utf8"), "untouched");
  await rm(launcher.scriptPath);
  await writeFile(launcher.desktopPath, "unowned");
  assert.equal((await createProxyLauncher({ appId: "demo", env })).ok, false);
  assert.equal(await readFile(launcher.desktopPath, "utf8"), "unowned");
});

test("exact owned legacy launcher pairs migrate and modified pairs remain untouched", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_DATA_DIRS: "relative" };
  const apps = join(env.XDG_DATA_HOME, "applications");
  await mkdir(apps, { recursive: true });
  await writeFile(join(apps, "demo.desktop"), "[Desktop Entry]\nType=Application\nName=Demo\nIcon=demo-icon\nExec=demo %c %i %k %u\n");
  const initial = await createProxyLauncher({ appId: "demo", env });
  const legacyDesktop = (await readFile(initial.desktopPath, "utf8")).split("\n").slice(1).join("\n");
  const legacyScript = '#!/bin/sh\n# Cloudflare One WARP — launch Demo through WARP local proxy\nexport ALL_PROXY="socks5://127.0.0.1:12345"\nexport HTTP_PROXY="http://127.0.0.1:12345"\nexport HTTPS_PROXY="http://127.0.0.1:12345"\nexec demo\n';
  await writeFile(initial.scriptPath, legacyScript);
  await writeFile(initial.desktopPath, legacyDesktop);
  assert.equal((await createProxyLauncher({ appId: "demo", port: 23456, env })).ok, true);
  assert.match(await readFile(initial.scriptPath, "utf8"), /socks5h:\/\/127\.0\.0\.1:23456/);
  assert.match(await readFile(initial.scriptPath, "utf8"), /exec demo Demo --icon demo-icon/);
  for (const changed of ["script", "desktop", "missing"]) {
    await writeFile(initial.scriptPath, legacyScript + (changed === "script" ? "# edited\n" : ""));
    await writeFile(initial.desktopPath, legacyDesktop + (changed === "desktop" ? "# edited\n" : ""));
    if (changed === "missing") await rm(initial.desktopPath);
    const before = await readFile(initial.scriptPath, "utf8");
    assert.equal((await createProxyLauncher({ appId: "demo", port: 23456, env })).ok, false);
    assert.equal(await readFile(initial.scriptPath, "utf8"), before);
    if (changed !== "missing") assert.equal(await readFile(initial.desktopPath, "utf8"), legacyDesktop + (changed === "desktop" ? "# edited\n" : ""));
  }
});

test("purge removes only unchanged owned complete shortcut pairs", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_DATA_DIRS: "relative" };
  const apps = join(env.XDG_DATA_HOME, "applications");
  await mkdir(apps, { recursive: true });
  const pairs = {};
  for (const id of ["owned", "modified", "foreign", "symlinked", "incomplete", "legacy"]) {
    await writeFile(join(apps, `${id}.desktop`), `[Desktop Entry]\nType=Application\nName=${id}\nExec=demo %u\n`);
    pairs[id] = await createProxyLauncher({ appId: id, env });
  }
  await writeFile(pairs.modified.scriptPath, (await readFile(pairs.modified.scriptPath, "utf8")) + "# user edit\n");
  await writeFile(pairs.foreign.desktopPath, "foreign file\n");
  const victim = join(root, "victim");
  await writeFile(victim, "untouched\n");
  await rm(pairs.symlinked.scriptPath);
  await symlink(victim, pairs.symlinked.scriptPath);
  await rm(pairs.incomplete.desktopPath);
  await writeFile(pairs.legacy.desktopPath, (await readFile(pairs.legacy.desktopPath, "utf8")).split("\n").slice(1).join("\n"));
  await writeFile(pairs.legacy.scriptPath, '#!/bin/sh\n# Cloudflare One WARP — launch legacy through WARP local proxy\nexport ALL_PROXY="socks5://127.0.0.1:40000"\nexport HTTP_PROXY="http://127.0.0.1:40000"\nexport HTTPS_PROXY="http://127.0.0.1:40000"\nexec demo\n');
  const result = await cleanupOwnedProxyLaunchers({ env });
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed.sort(), [pairs.owned.desktopName, pairs.legacy.desktopName].sort());
  for (const id of ["owned", "legacy"]) {
    await assert.rejects(readFile(pairs[id].scriptPath), { code: "ENOENT" });
    await assert.rejects(readFile(pairs[id].desktopPath), { code: "ENOENT" });
  }
  for (const id of ["modified", "foreign", "symlinked", "incomplete"]) await stat(pairs[id].scriptPath);
  assert.equal(await readFile(victim, "utf8"), "untouched\n");
  assert.equal(await readFile(pairs.foreign.desktopPath, "utf8"), "foreign file\n");
  assert.equal(await readFile(join(apps, "owned.desktop"), "utf8"), "[Desktop Entry]\nType=Application\nName=owned\nExec=demo %u\n");
  assert.deepEqual((await cleanupOwnedProxyLaunchers({ env })).removed, []);
});

test("shortcut preserves terminal and working directory and escapes desktop field codes", xdgOnly, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp %u newline\n"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_DATA_DIRS: "relative" };
  const apps = join(env.XDG_DATA_HOME, "applications");
  const cwd = join(root, "work folder");
  await mkdir(apps, { recursive: true });
  await mkdir(cwd);
  const recorder = join(root, "record.mjs");
  await writeFile(recorder, "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }))");
  // Desktop values escape a literal newline in an otherwise valid executable path.
  const escape = text => text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
  await writeFile(join(apps, "demo.desktop"), `[Desktop Entry]\nType=Application\nName=Demo\\sTerminal\nExec="${escape(process.execPath)}" "${escape(recorder).replaceAll("%", "%%")}" %c\nTerminal=true\nPath=${escape(cwd)}\n`);
  const result = await createProxyLauncher({ appId: "demo", env });
  assert.equal(result.ok, true);
  const desktop = await readFile(result.desktopPath, "utf8");
  assert.match(desktop, /Terminal=true/);
  const exec = desktop.split("\n").find(line => line.startsWith("Exec=")).slice(5);
  assert.deepEqual(desktopExecArgs(exec), [result.scriptPath]);
  const output = JSON.parse(execFileSync("sh", [result.scriptPath], { encoding: "utf8" }));
  assert.deepEqual(output, { cwd, args: ["Demo Terminal"] });
  assert.equal((await cleanupOwnedProxyLaunchers({ env })).removed.length, 1);
});
