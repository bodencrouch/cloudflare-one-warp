import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function stagedPayload(run) {
  const destination = mkdtempSync(join(tmpdir(), "warp-payload-"));
  try {
    const result = spawnSync("bash", [join(root, "packaging/scripts/stage-payload.sh")], { cwd: root, encoding: "utf8", env: { ...process.env, PAYLOAD_DIR: destination } });
    assert.equal(result.status, 0, result.stderr);
    run(join(destination, "usr/lib/cloudflare-one-warp"));
  } finally { rmSync(destination, { recursive: true, force: true }); }
}

/** Every relative import reachable from an entry point, as repo-relative paths. */
function localImportClosure(entries) {
  const seen = new Set();
  const walk = (file) => {
    const rel = relative(root, file).split("\\").join("/");
    if (seen.has(rel)) return;
    seen.add(rel);
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return;
    }
    const pattern = /(?:^|\s)(?:import|export)[^;\n]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = pattern.exec(source))) {
      const target = resolve(dirname(file), match[1] || match[2]);
      if (existsSync(target)) walk(target);
    }
  };
  for (const entry of entries) {
    const path = join(root, entry);
    if (existsSync(path)) walk(path);
  }
  return seen;
}

/** Files the packaged tree must contain for the daemon and launchers to run. */
const ENTRY_POINTS = [
  "server.js",
  "scripts/daemon-ready.mjs",
  "scripts/health-check.mjs",
  "scripts/health-webui-check.mjs",
  "scripts/webui-handoff.mjs",
  "scripts/proxy-launcher-cleanup.mjs",
  "scripts/port-open.mjs",
  "scripts/sync-nm-profiles.mjs",
  "scripts/sync-tray-autostart.mjs",
  "scripts/tray-shell-cli.mjs"
];

test("stage-payload.sh installs every lib/ module the daemon imports", { skip: process.platform === "win32" }, () => {
  const needed = [...localImportClosure(ENTRY_POINTS)].filter((f) => f.startsWith("lib/")).sort();
  assert.ok(needed.length > 10, "import walk found suspiciously few modules");

  stagedPayload((payload) => {
  const missing = needed.filter((file) => !existsSync(join(payload, file)));
  assert.deepEqual(
    missing,
    [],
    `packaging/scripts/stage-payload.sh does not install: ${missing.join(", ")}. ` +
      "A missing module makes the installed package fail at startup with ERR_MODULE_NOT_FOUND."
  );
  });
});

test("stage-payload.sh installs every script the launchers invoke", { skip: process.platform === "win32" }, () => {
  const launchers = ["bin/cloudflare-one-warp", "bin/cloudflare-one-warp-tray"];
  const referenced = new Set();
  for (const launcher of launchers) {
    const source = readFileSync(join(root, launcher), "utf8");
    const pattern = /\$\{?APP_DIR\}?\/(scripts\/[A-Za-z0-9_.-]+)/g;
    let match;
    while ((match = pattern.exec(source))) referenced.add(match[1]);
  }
  assert.ok(referenced.size > 3, "launcher scan found suspiciously few scripts");

  stagedPayload((payload) => {
  const missing = [...referenced]
    .filter((file) => existsSync(join(root, file)))
    .filter((file) => !existsSync(join(payload, file)))
    .sort();
  assert.deepEqual(missing, [], `stage-payload.sh does not install: ${missing.join(", ")}`);
  });
});

test("source staging excludes local credentials and includes offline installation prerequisites", { skip: process.platform === "win32" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-source-"));
  try {
    const result = spawnSync("bash", [join(root, "packaging/scripts/stage-source.sh"), destination], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const path of ["SECURITY.md", "package-lock.json", "openapi/cloudflare-one-warp-api.json", "scripts/install-local.sh", "packaging/scripts/stage-source.sh", "config/config.example.json"]) {
      assert.ok(existsSync(join(destination, path)), path);
    }
    assert.equal(existsSync(join(destination, ".git")), false);
    assert.equal(existsSync(join(destination, "node_modules")), false);
    assert.equal(existsSync(join(destination, "config/config.json")), false);
    assert.equal(existsSync(join(destination, "dist")), false);
    // Exercise exclusions with actual credentials in otherwise distributable directories.
    writeFileSync(join(destination, "scripts/.env"), "TOKEN=must-not-ship");
    writeFileSync(join(destination, "lib/private.pem"), "private-key");
    writeFileSync(join(destination, "config/config.json"), '{"organization":"private"}');
    const second = join(destination, "restaged");
    const restage = spawnSync("bash", [join(destination, "packaging/scripts/stage-source.sh"), second], { encoding: "utf8" });
    assert.equal(restage.status, 0, restage.stderr);
    for (const secret of ["scripts/.env", "lib/private.pem", "config/config.json"]) assert.equal(existsSync(join(second, secret)), false, secret);
    writeFileSync(join(destination, "public/.env"), "TOKEN=must-not-ship");
    const native = join(destination, "native-payload");
    const nativeStage = spawnSync("bash", [join(destination, "packaging/scripts/stage-payload.sh")], { encoding: "utf8", env: { ...process.env, PAYLOAD_DIR: native } });
    assert.equal(nativeStage.status, 0, nativeStage.stderr);
    for (const secret of ["lib/private.pem", "public/.env"]) assert.equal(existsSync(join(native, "usr/lib/cloudflare-one-warp", secret)), false, secret);


  } finally { rmSync(destination, { recursive: true, force: true }); }
});

test("local install helpers reject destructive trees and preserve unrelated commands", { skip: process.platform === "win32" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-install-safety-"));
  try {
    const script = `source "${join(root, "scripts/lib/common.sh")}"\ncloudflare_one_warp_validate_install_dir /`;
    assert.notEqual(spawnSync("bash", ["-c", script], { encoding: "utf8" }).status, 0);
    const unrelated = join(destination, "command");
    const create = spawnSync("bash", ["-c", 'printf "preserve" > "$1"; source "$2"; cloudflare_one_warp_link_or_copy /different/program "$1"', "test", unrelated, join(root, "scripts/lib/common.sh")], { encoding: "utf8" });
    assert.notEqual(create.status, 0);
    assert.equal(readFileSync(unrelated, "utf8"), "preserve");
    const quote = spawnSync("bash", ["-c", 'source "$1"; cloudflare_one_warp_desktop_exec_path "$2"', "test", join(root, "scripts/lib/common.sh"), '/tmp/a "quote" % space/bin/app'], { encoding: "utf8" });
    assert.equal(quote.status, 0, quote.stderr);
    assert.equal(quote.stdout, '"/tmp/a \\"quote\\" %% space/bin/app"');
  } finally { rmSync(destination, { recursive: true, force: true }); }
});


test("local installation handles spaces and preserves the working tree when staging fails", { skip: process.platform === "win32" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-install-flow-"));
  try {
    const source = join(destination, "source's directory");
    const stage = spawnSync("bash", [join(root, "packaging/scripts/stage-source.sh"), source], { encoding: "utf8" });
    assert.equal(stage.status, 0, stage.stderr);
    const home = join(destination, "home");
    const install = join(home, "app with spaces %");
    const mockBin = join(destination, "mockbin");
    mkdirSync(mockBin);
    for (const executable of ["systemctl", "nmcli"]) writeFileSync(join(mockBin, executable), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const env = { ...process.env, HOME: home, PATH: `${mockBin}:${process.env.PATH}`, XDG_CONFIG_HOME: join(home, "config with spaces"), XDG_DATA_HOME: join(home, "data with spaces") };
    const result = spawnSync("bash", [join(source, "scripts/install-local.sh"), "--install-dir", install, "--service"], { encoding: "utf8", env, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(install, ".cloudflare-one-warp-install")));
    const desktop = readFileSync(join(env.XDG_DATA_HOME, "applications/cloudflare-one-warp.desktop"), "utf8");
    assert.ok(desktop.includes(`Exec="${install.replaceAll("%", "%%")}/bin/cloudflare-one-warp"`));
    const unit = readFileSync(join(env.XDG_CONFIG_HOME, "systemd/user/cloudflare-one-warp.service"), "utf8");
    assert.ok(unit.includes(`ExecStart=/usr/bin/env node "${install.replaceAll("%", "%%")}/server.js"`));
    const metadata = join(install, "proxy-launchers");
    mkdirSync(metadata);
    writeFileSync(join(metadata, "routing-state.json"), '{"preserve":true}');
    const reinstall = spawnSync("bash", [join(source, "scripts/install-local.sh"), "--install-dir", install, "--no-desktop", "--no-bin-links"], { encoding: "utf8", env, timeout: 30000 });
    assert.equal(reinstall.status, 0, reinstall.stderr);
    assert.equal(readFileSync(join(metadata, "routing-state.json"), "utf8"), '{"preserve":true}');
    const victim = join(home, "unrelated-file");
    writeFileSync(victim, "preserve unrelated contents");
    const settings = join(env.XDG_DATA_HOME, "applications/cloudflare-one-warp-settings.desktop");
    rmSync(settings);
    symlinkSync(victim, settings);
    const desktopRefresh = spawnSync("bash", [join(source, "scripts/install-local.sh"), "--install-dir", install, "--no-bin-links"], { encoding: "utf8", env, timeout: 30000 });
    assert.equal(desktopRefresh.status, 0, desktopRefresh.stderr);
    assert.equal(readFileSync(victim, "utf8"), "preserve unrelated contents");
    const commandPath = join(home, ".local/bin/cloudflare-one-warp");
    rmSync(commandPath);
    writeFileSync(commandPath, "unrelated command");
    const currentServer = readFileSync(join(install, "server.js"), "utf8");
    const collision = spawnSync("bash", [join(source, "scripts/install-local.sh"), "--install-dir", install, "--no-desktop"], { encoding: "utf8", env, timeout: 30000 });
    assert.notEqual(collision.status, 0);
    assert.equal(readFileSync(commandPath, "utf8"), "unrelated command");
    assert.equal(readFileSync(join(install, "server.js"), "utf8"), currentServer);
    const oldServer = readFileSync(join(install, "server.js"), "utf8");
    writeFileSync(join(source, "server.js"), "this is invalid JavaScript {");
    const failure = spawnSync("bash", [join(source, "scripts/install-local.sh"), "--install-dir", install, "--no-desktop", "--no-bin-links"], { encoding: "utf8", env, timeout: 30000 });
    assert.notEqual(failure.status, 0);
    assert.equal(readFileSync(join(install, "server.js"), "utf8"), oldServer);
    assert.equal(existsSync(`${install}.install-lock`), false);
    const purge = spawnSync("bash", [join(source, "scripts/uninstall-local.sh"), "--install-dir", "/", "--purge"], { encoding: "utf8", env, timeout: 30000 });
    assert.notEqual(purge.status, 0);
    assert.ok(existsSync(join(install, "server.js")));
    // Exercise the ordinary user path, not the checkout's uninstaller.
    const uninstall = spawnSync("bash", [join(install, "scripts/uninstall-local.sh"), "--install-dir", install, "--purge"], { encoding: "utf8", env, timeout: 30000 });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(existsSync(install), false);
  } finally { rmSync(destination, { recursive: true, force: true }); }
});


test("packages do not advertise a nonexistent NetworkManager VPN D-Bus service", { skip: process.platform === "win32" }, () => {
  stagedPayload((payload) => {
    assert.equal(existsSync(resolve(payload, "../NetworkManager/VPN/nm-cloudflare-one-warp-service.name")), false);
  });
  for (const recipe of ["packaging/nfpm.yaml", "packaging/fedora/cloudflare-one-warp.spec"]) {
    const source = readFileSync(join(root, recipe), "utf8").split("%post")[0];
    assert.doesNotMatch(source, /nm-cloudflare-one-warp-service\.name/);
  }
});


test("publishing credentials are returned through askpass rather than stored in git URLs", { skip: process.platform === "win32" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-credentials-"));
  try {
    const command = 'source "$1"; cloudflare_one_warp_setup_git_credentials "$2" "test-only-token"; "$GIT_ASKPASS" "Username for https://github.com"; "$GIT_ASKPASS" "Password for https://github.com"';
    const result = spawnSync("bash", ["-c", command, "test", join(root, "scripts/lib/common.sh"), destination], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "x-access-token\ntest-only-token\n");
    assert.doesNotMatch(readFileSync(join(destination, "git-askpass"), "utf8"), /test-only-token/);
    for (const script of ["scripts/publish-flathub-pr.sh", "scripts/publish-appimagehub-pr.sh"]) {
      assert.doesNotMatch(readFileSync(join(root, script), "utf8"), /https:\/\/x-access-token:/);
    }
  } finally { rmSync(destination, { recursive: true, force: true }); }
});


test("source archives are reproducible and generated Arch recipes verify their exact digest", { skip: process.platform !== "linux" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-source-repeat-"));
  try {
    const stage = spawnSync("bash", [join(root, "packaging/scripts/stage-source.sh"), destination], { encoding: "utf8" });
    assert.equal(stage.status, 0, stage.stderr);
    const env = { ...process.env, SOURCE_DATE_EPOCH: "1700000000" };
    const build = () => spawnSync("bash", [join(destination, "packaging/scripts/build-source.sh")], { encoding: "utf8", env, timeout: 30000 });
    const first = build();
    assert.equal(first.status, 0, first.stderr);
    const version = JSON.parse(readFileSync(join(destination, "package.json"), "utf8")).version;
    const archivePath = join(destination, `dist/packages/cloudflare-one-warp-${version}-src.tar.gz`);
    const archive = readFileSync(archivePath);
    const payloadPath = join(destination, `dist/packages/cloudflare-one-warp-${version}.tar.gz`);
    const payload = readFileSync(payloadPath);
    const second = build();
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readFileSync(archivePath), archive);
    assert.deepEqual(readFileSync(payloadPath), payload);
    const digest = spawnSync("sha256sum", [archivePath], { encoding: "utf8" }).stdout.split(" ")[0];
    assert.ok(readFileSync(join(destination, "dist/packages/PKGBUILD"), "utf8").includes(`sha256sums=('${digest}')`));
  } finally { rmSync(destination, { recursive: true, force: true }); }
});

test("AppImage verification rejects a foreign ELF without touching caller extraction directories", { skip: process.platform !== "linux" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-invalid-appimage-"));
  try {
    const verifier = join(destination, "packaging/scripts/verify-packages.sh");
    mkdirSync(dirname(verifier), { recursive: true });
    writeFileSync(verifier, readFileSync(join(root, "packaging/scripts/verify-packages.sh")));
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    writeFileSync(join(destination, "package.json"), JSON.stringify({ version }));
    const packages = join(destination, "dist/packages");
    mkdirSync(packages, { recursive: true });
    const artifact = join(packages, `cloudflare-one-warp-${version}-x86_64.AppImage`);
    writeFileSync(artifact, readFileSync("/bin/true"), { mode: 0o755 });
    const existing = join(destination, "squashfs-root");
    mkdirSync(existing);
    writeFileSync(join(existing, "preserve"), "user extraction");
    const result = spawnSync("bash", [verifier, "appimage"], { cwd: destination, encoding: "utf8", timeout: 30000 });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(readFileSync(join(existing, "preserve"), "utf8"), "user extraction");
  } finally { rmSync(destination, { recursive: true, force: true }); }
});

test("Flatpak verification fails closed when bundle import rejects malformed data", { skip: process.platform === "win32" }, () => {
  const destination = mkdtempSync(join(tmpdir(), "warp-invalid-flatpak-"));
  try {
    const verifier = join(destination, "packaging/scripts/verify-packages.sh");
    mkdirSync(dirname(verifier), { recursive: true });
    writeFileSync(verifier, readFileSync(join(root, "packaging/scripts/verify-packages.sh")));
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    writeFileSync(join(destination, "package.json"), JSON.stringify({ version }));
    const packages = join(destination, "dist/packages");
    mkdirSync(packages, { recursive: true });
    writeFileSync(join(packages, `cloudflare-one-warp-${version}-x86_64.flatpak`), Buffer.from([0,1,2,3,4]));
    const bin = join(destination, "tools");
    mkdirSync(bin);
    writeFileSync(join(bin, "flatpak"), '#!/bin/sh\nexit 42\n', { mode: 0o755 });
    writeFileSync(join(bin, "ostree"), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = spawnSync("bash", [verifier, "flatpak"], { cwd: destination, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: 30000 });
    assert.equal(result.status, 42, result.stdout + result.stderr);
  } finally { rmSync(destination, { recursive: true, force: true }); }
});
