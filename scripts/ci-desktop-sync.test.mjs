/** Exercise daemon-to-desktop synchronization using isolated fake host tools. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { createHttpJson } from "./ci-http-client.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntil(check, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* files/socket not ready yet */ }
    await sleep(25);
  }
  throw new Error(message);
}

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test("daemon sync uses changed proxy port and stays healthy while NM is delayed", { timeout: 30000 }, async (t) => {
  if (process.platform !== "linux") return t.skip("Linux desktop integration");
  const directory = await mkdtemp(join(tmpdir(), "warp-desktop-sync-"));
  const bin = join(directory, "bin");
  const nmLog = join(directory, "nm.log");
  const kdeLog = join(directory, "kde.log");
  const hold = join(directory, "hold");
  const waiting = join(directory, "waiting");
  let daemon;
  let output = "";
  t.after(async () => {
    await rm(hold, { force: true });
    if (daemon && daemon.exitCode === null) {
      const closed = once(daemon, "close");
      daemon.kill("SIGTERM");
      await closed;
    }
    // Fixture subprocesses may finish a final log write after their parent closes.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await mkdir(bin);
  const fixture = `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
(async () => {
  if (name === 'nmcli') {
    fs.appendFileSync(process.env.WARP_TEST_NM_LOG, JSON.stringify(args) + '\\n');
    if (fs.existsSync(process.env.WARP_TEST_HOLD)) {
      fs.writeFileSync(process.env.WARP_TEST_WAITING, 'waiting');
      const deadline = Date.now() + 5000;
      while (fs.existsSync(process.env.WARP_TEST_HOLD) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  } else if (name === 'kwriteconfig6' && args[0] !== '--help') {
    fs.appendFileSync(process.env.WARP_TEST_KDE_LOG, JSON.stringify(args) + '\\n');
    const file = require('node:path').join(process.env.XDG_CONFIG_HOME, 'kioslaverc');
    let entries = {};
    if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
      const equals = line.indexOf('=');
      if (equals >= 0) entries[line.slice(0, equals)] = line.slice(equals + 1);
    }
    const key = args[args.indexOf('--key') + 1];
    if (args.includes('--delete')) delete entries[key]; else entries[key] = args[args.length - 1];
    fs.mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
    fs.writeFileSync(file, '[Proxy Settings]\\n' + Object.entries(entries).map(([k,v]) => k + '=' + v).join('\\n') + '\\n');

  }
})();
`;
  for (const name of ["nmcli", "kwriteconfig6"]) await writeFile(join(bin, name), fixture, { mode: 0o755 });
  // Prevent accidental interaction with a developer's real firewall or desktop bus.
  for (const name of ["nft", "pkexec", "notify-send", "dbus-send"]) {
    await writeFile(join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  }
  const cliWrapper = join(directory, "cli-wrapper.mjs");
  await writeFile(cliWrapper, `
import { spawnSync } from "node:child_process";
const mock = ${JSON.stringify(join(root, "scripts/mock-warp-cli.mjs"))};
const args = process.argv.slice(2);
if (args.includes("--listen")) {
  let previous = "";
  const poll = () => {
    const result = spawnSync(process.execPath, [mock, "status"], { encoding: "utf8" });
    if (result.stdout !== previous) { previous = result.stdout; process.stdout.write(previous); }
  };
  poll(); setInterval(poll, 200);
} else {
  const result = spawnSync(process.execPath, [mock, ...args], { encoding: "utf8" });
  process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
  process.exitCode = result.status ?? 1;
}
`);
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const httpJson = createHttpJson(baseUrl, { env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: join(directory, "config") } });
  daemon = spawn(process.execPath, ["server.js"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, HOME: directory, XDG_CONFIG_HOME: join(directory, "config"),
      XDG_RUNTIME_DIR: join(directory, "runtime"), PATH: bin + ":" + process.env.PATH,
      CLOUDFLARE_ONE_WARP_PORT: String(port), CLOUDFLARE_ONE_WARP_BIND: "127.0.0.1",
      WARP_CLI: cliWrapper,
      CLOUDFLARE_ONE_WARP_WEBUI: "0", CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0",
      CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: "1", MOCK_WARP_STATE: join(directory, "warp.json"),
      WARP_TEST_NM_LOG: nmLog, WARP_TEST_KDE_LOG: kdeLog,
      WARP_TEST_HOLD: hold, WARP_TEST_WAITING: waiting
    }
  });
  daemon.stdout.on("data", data => { output += data; });
  daemon.stderr.on("data", data => { output += data; });
  await waitUntil(async () => (await httpJson("GET", "/api/health")).status === 200,
    "daemon did not become healthy");
  const action = async (name, value) => {
    const response = await httpJson("POST", "/api/action", { action: name, value });
    assert.equal(response.status, 200, JSON.stringify(response.json) + output);
    assert.equal(response.json.ok, true);
  };
  const writes = async () => (await readFile(kdeLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const hasProxy = async portValue => (await writes()).some(args => args.includes("http_proxy") && args.at(-1) === `127.0.0.1:${portValue}`);
  await action("setMode", "proxy");
  await action("connect");
  await waitUntil(() => hasProxy(40000), "initial connected proxy was not sent to KDE");
  assert.ok((await readFile(nmLog, "utf8")).includes('"connection","up","Cloudflare One WARP (Local proxy)"'));

  await writeFile(hold, "hold NM until health responds");
  await action("setProxyPort", "42421");
  await waitUntil(async () => Boolean(await readFile(waiting, "utf8")), "delayed NM command did not start");
  const started = Date.now();
  const health = await fetch(baseUrl + "/api/health", { signal: AbortSignal.timeout(1000) });
  assert.equal(health.status, 200);
  assert.ok(Date.now() - started < 1000, "health was blocked by the desktop subprocess");
  assert.equal(await readFile(hold, "utf8"), "hold NM until health responds");
  await rm(hold);
  await waitUntil(() => hasProxy(42421), "changed proxy port was not sent to KDE");
  const proxyWrites = (await writes()).filter(args => args.includes("http_proxy"));
  assert.equal(proxyWrites.at(-1).at(-1), "127.0.0.1:42421");
  const settings = await httpJson("GET", "/api/snapshot");
  assert.equal(settings.json.settings["Proxy port"], "42421");
  const restored = async () => (await writes()).filter(args => args.includes("http_proxy") && args.includes("--delete")).length;
  const initialRestores = await restored();
  await action("runCustom", "disconnect");
  await waitUntil(async () => (await restored()) > initialRestores, "custom disconnect did not restore KDE");
  const previousProxyWrites = (await writes()).filter(args => args.includes("http_proxy") && args.at(-1) === "127.0.0.1:42421").length;
  await action("connect");
  await waitUntil(async () => (await writes()).filter(args => args.includes("http_proxy") && args.at(-1) === "127.0.0.1:42421").length > previousProxyWrites,
    "reconnect did not re-enable KDE");
  await sleep(500); // Let the isolated mock listener observe the connected state.

  const beforeExternal = await restored();
  const external = spawn(process.execPath, [join(root, "scripts/mock-warp-cli.mjs"), "disconnect"], { env: { ...process.env, MOCK_WARP_STATE: join(directory, "warp.json") } });
  await once(external, "close");
  await waitUntil(async () => (await restored()) > beforeExternal, "external CLI disconnect did not restore KDE");

});
