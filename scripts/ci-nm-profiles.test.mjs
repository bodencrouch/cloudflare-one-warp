import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allProfileKeyfiles,
  buildNmKeyfile,
  profileBySlug,
  PROFILE_IDS,
  WARP_PROFILES
} from "../lib/networkmanager/profiles.mjs";

test("WARP profiles cover MASQUE, WireGuard, and local proxy", () => {
  assert.equal(WARP_PROFILES.length, 3);
  assert.ok(profileBySlug("masque"));
  assert.ok(profileBySlug("wireguard"));
  assert.ok(profileBySlug("proxy"));
});

test("NetworkManager owns isolated addressless markers instead of configuring the WARP tunnel", () => {
  const keyfile = buildNmKeyfile(profileBySlug("masque"));
  assert.match(keyfile, /type=dummy/);
  assert.match(keyfile, /interface-name=cfw-masque/);
  assert.doesNotMatch(keyfile, /CloudflareWARP|method=auto/);
  assert.equal((keyfile.match(/method=disabled/g) || []).length, 2);
});

test("WireGuard profile sets WireGuard protocol", () => {
  const profile = profileBySlug("wireguard");
  const keyfile = buildNmKeyfile(profile);
  assert.equal(profile.protocol, "WireGuard");
  assert.ok(keyfile.includes(`id=${PROFILE_IDS.wireguard}`));
});

test("proxy profile includes proxy port", () => {
  const profile = profileBySlug("proxy");
  assert.equal(profile.mode, "proxy");
  assert.equal(profile.proxyPort, 40000);
});

test("allProfileKeyfiles yields stable filenames", () => {
  const files = allProfileKeyfiles();
  assert.equal(files.length, 3);
  assert.ok(files.some((f) => f.filename.includes("masque")));
  assert.ok(files.some((f) => f.filename.includes("wireguard")));
  assert.ok(files.some((f) => f.filename.includes("proxy")));
});

test("KDE synchronization keeps the event loop responsive and uses selected port", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX script fixture");
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { syncKdeProxy } = await import("../lib/networkmanager/sync.mjs");
  const root = await mkdtemp(join(tmpdir(), "warp-kde-"));
  try {
    await mkdir(join(root, "scripts"));
    const log = join(root, "args");
    await writeFile(join(root, "scripts", "cloudflare-one-warp-kde-proxy-sync"),
      '#!/bin/sh\nsleep 0.1\nprintf "%s\\n" "$@" > "$CLOUDFLARE_ONE_WARP_HOME/args"\n', { mode: 0o755 });
    let finished = false;
    const pending = syncKdeProxy({ appRoot: root, enabled: true, port: 42421 }).then(r => { finished = true; return r; });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(finished, false);
    assert.equal((await pending).ok, true);
    assert.equal(await readFile(log, "utf8"), "on\n42421\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installer loads every generated NM profile including filenames with spaces", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX installer");
  const { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(join(tmpdir(), "warp-nm-"));
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    for (const directory of ["bin", "home", "app/scripts", "app/lib/networkmanager"]) await mkdir(join(root, directory), { recursive: true });
    for (const path of ["scripts/sync-nm-profiles.mjs", "lib/networkmanager/profiles.mjs"]) await copyFile(join(repo, path), join(root, "app", path));
    await writeFile(join(root, "bin", "nmcli"), '#!/bin/sh\nprintf "%s|%s|%s\\n" "$1" "$2" "$3" >> "$HOME/nm-log"\n', { mode: 0o755 });
    await promisify(execFile)("bash", [join(repo, "scripts/cloudflare-one-warp-nm"), "--install-dir", join(root, "app")], {
      env: { ...process.env, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "home", ".config"), PATH: join(root, "bin") + ":" + process.env.PATH }, timeout: 10000
    });
    const lines = (await readFile(join(root, "home", "nm-log"), "utf8")).split("\n").filter(l => l.startsWith("connection|load|"));
    assert.equal(lines.length, 3);
    for (const slug of ["masque", "wireguard", "proxy"]) assert.ok(lines.some(l => l.endsWith(`Cloudflare One WARP-WARP-${slug}.nmconnection`)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("parsed connected boolean activates the matching NM profile", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX fake nmcli");
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { syncNmForWarpState } = await import("../lib/networkmanager/sync.mjs");
  const root = await mkdtemp(join(tmpdir(), "warp-nm-sync-"));
  const savedPath = process.env.PATH;
  const savedLog = process.env.WARP_TEST_NM_LOG;
  try {
    process.env.PATH = root + ":" + savedPath;
    process.env.WARP_TEST_NM_LOG = join(root, "log");
    await writeFile(join(root, "nmcli"), '#!/bin/sh\nif [ "$1" = "connection" ] && [ "$2" = "up" ]; then printf "%s\\n" "$3" >> "$WARP_TEST_NM_LOG"; fi\n', { mode: 0o755 });
    const result = await syncNmForWarpState({ status: { connected: true, label: "Connected" }, settings: { Mode: "proxy" } });
    assert.equal(result.ok, true);
    assert.equal((await readFile(process.env.WARP_TEST_NM_LOG, "utf8")).trim(), PROFILE_IDS.proxy);
  } finally {
    process.env.PATH = savedPath;
    if (savedLog === undefined) delete process.env.WARP_TEST_NM_LOG;
    else process.env.WARP_TEST_NM_LOG = savedLog;
    await rm(root, { recursive: true, force: true });
  }
});
