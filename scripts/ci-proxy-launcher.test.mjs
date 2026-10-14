import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createProxyLauncher,
  listDesktopApps,
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

test("listDesktopApps reads XDG applications", xdgOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-one-warp-apps-"));
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

test("createProxyLauncher writes script and desktop entry", xdgOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-one-warp-launch-"));
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
  assert.match(script, /ALL_PROXY="socks5:\/\/127\.0\.0\.1:40000"/);
  assert.match(script, /exec demo-browser/);
  const desktop = await readFile(result.desktopPath, "utf8");
  assert.match(desktop, /Demo Browser \(through WARP\)/);
});

test("desktop Exec arguments remain literal shell metacharacters", () => {
  assert.equal(sanitizeExec('demo "$(touch /tmp/injected)" "a; b" %%'), "demo '$(touch /tmp/injected)' 'a; b' '%'");
  assert.throws(() => sanitizeExec('demo "unclosed'));
  assert.throws(() => sanitizeExec('demo --file=%u'));
});

test("user XDG apps override system apps including Hidden masks", xdgOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "warp-xdg-apps-"));
  const env = { HOME: root, XDG_DATA_HOME: join(root, "user"), XDG_DATA_DIRS: join(root, "system") };
  for (const dir of [env.XDG_DATA_HOME, env.XDG_DATA_DIRS]) {
    await mkdir(join(dir, "applications"), { recursive: true });
    await writeFile(join(dir, "applications", "demo.desktop"), `[Desktop Entry]\nType=Application\nName=Demo\nExec=demo\n${dir === env.XDG_DATA_HOME ? "Hidden=true\n" : ""}`);
  }
  assert.deepEqual(await listDesktopApps(env), []);
});

test("generated proxy script preserves argv without command substitution", xdgOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "warp proxy argv "));
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
