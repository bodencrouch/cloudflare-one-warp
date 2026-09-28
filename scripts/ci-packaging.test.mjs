import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stagePayload = readFileSync(join(root, "packaging/scripts/stage-payload.sh"), "utf8");

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
  "scripts/port-open.mjs",
  "scripts/sync-nm-profiles.mjs",
  "scripts/sync-tray-autostart.mjs",
  "scripts/tray-shell-cli.mjs"
];

test("stage-payload.sh installs every lib/ module the daemon imports", () => {
  const needed = [...localImportClosure(ENTRY_POINTS)].filter((f) => f.startsWith("lib/")).sort();
  assert.ok(needed.length > 10, "import walk found suspiciously few modules");

  const missing = needed.filter((file) => !stagePayload.includes(`/${file}"`));
  assert.deepEqual(
    missing,
    [],
    `packaging/scripts/stage-payload.sh does not install: ${missing.join(", ")}. ` +
      "A missing module makes the installed package fail at startup with ERR_MODULE_NOT_FOUND."
  );
});

test("stage-payload.sh installs every script the launchers invoke", () => {
  const launchers = ["bin/thirdflare", "bin/thirdflare-tray"];
  const referenced = new Set();
  for (const launcher of launchers) {
    const source = readFileSync(join(root, launcher), "utf8");
    const pattern = /\$\{?APP_DIR\}?\/(scripts\/[A-Za-z0-9_.-]+)/g;
    let match;
    while ((match = pattern.exec(source))) referenced.add(match[1]);
  }
  assert.ok(referenced.size > 3, "launcher scan found suspiciously few scripts");

  const missing = [...referenced]
    .filter((file) => existsSync(join(root, file)))
    .filter((file) => !stagePayload.includes(`/${file}"`))
    .sort();
  assert.deepEqual(missing, [], `stage-payload.sh does not install: ${missing.join(", ")}`);
});
