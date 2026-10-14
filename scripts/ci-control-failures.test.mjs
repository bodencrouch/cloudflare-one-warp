/** Failure paths must never fabricate account state or leave protection paused. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createHttpJson } from "./ci-http-client.mjs";
import { ensurePrivateDirectory } from "../lib/security/private-files.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, { protectedMode = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "warp-control-failure-"));
  const config = join(directory, "config/cloudflare-one-warp");
  const bin = join(directory, "bin");
  ensurePrivateDirectory(config);
  await mkdir(bin);
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  await writeFile(join(config, "config.json"), JSON.stringify({ server: { port }, warp: { killSwitch: protectedMode } }));
  const cli = join(directory, "cli.mjs");
  await writeFile(cli, `import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2).filter(v=>!v.startsWith('--'));
if(args[0]==='registration') {
 process.stdout.write('[{"id":"fabricated-device","name":"error"}]');
 process.stderr.write('Account type: Free\\nDevice ID: fabricated-account\\nError: registration unavailable\\n');process.exit(1);
}
const r=spawnSync(process.execPath,[${JSON.stringify(join(root, "scripts/mock-warp-cli.mjs"))},...process.argv.slice(2)],{encoding:'utf8'});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);`);
  const active = join(directory, "active");
  const events = join(directory, "events");
  if (process.platform === "linux") {
    await writeFile(join(bin, "nft"), `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const state=${JSON.stringify(active)};const events=${JSON.stringify(events)};
if(args.includes('list')){if(!fs.existsSync(state)){console.error('No such file');process.exit(1);}const table='cloudflare_one_warp_killswitch';console.log(JSON.stringify({nftables:[{chain:{family:'inet',table,name:'output',type:'filter',hook:'output',policy:'drop'}},...['lo','CloudflareWARP'].map(name=>({rule:{family:'inet',table,chain:'output',expr:[{match:{op:'==',left:{meta:{key:'oifname'}},right:name}},{accept:null}]}}))]}));process.exit(0);}
const rules=fs.readFileSync(args[1],'utf8');const enabled=rules.includes('chain output');if(enabled)fs.writeFileSync(state,rules);else fs.rmSync(state,{force:true});fs.appendFileSync(events,String(enabled)+'\\n');`, { mode: 0o755 });
    for (const name of ["nmcli", "pkexec", "kwriteconfig6", "kwriteconfig5", "dbus-send", "notify-send"]) await writeFile(join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  }
  const env = { ...process.env, HOME: directory, XDG_CONFIG_HOME: join(directory, "config"), PATH: bin + delimiter + process.env.PATH,
    WARP_CLI: cli, MOCK_WARP_STATE: join(directory, "warp.json"), CLOUDFLARE_ONE_WARP_NOTIFICATIONS: "0", CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC: protectedMode ? "0" : "1", DISPLAY: "", WAYLAND_DISPLAY: "", PKEXEC_UID: "", CLOUDFLARE_ONE_WARP_TRAY_LIVE: "0" };
  for (const key of ["PORT", "CLOUDFLARE_ONE_WARP_PORT", "CLOUDFLARE_ONE_GUI_PORT"]) delete env[key];
  const daemon = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: "ignore" });
  t.after(async () => { if (daemon.exitCode === null) { const closed=once(daemon,"close");daemon.kill("SIGTERM");await closed; } await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}); });
  const http = createHttpJson(`http://127.0.0.1:${port}`, { env });
  let healthy = false;
  for (let i=0;i<100;i++) { try { if((await http("GET","/api/health")).status===200){healthy=true;break;} } catch {} await delay(50); }
  assert.equal(healthy,true,"fixture daemon must start");
  return { http, active, events, port };
}

test("failed CLI account responses cannot fabricate registration or devices", async t => {
  const { http } = await fixture(t);
  const response = await http("GET", "/api/account");
  assert.equal(response.status, 200);
  assert.equal(response.json.registered, false);
  assert.equal(response.json.deviceId, null);
  assert.deepEqual(response.json.devices, []);
});

test("saved future port does not alter actual runtime configuration", async t => {
  const { http, port } = await fixture(t);
  assert.equal((await http("POST", "/api/config/server", { port: port === 65535 ? port - 1 : port + 1 })).status, 200);
  const config = await http("GET", "/api/config");
  assert.equal(config.json.effective.port, port);
  assert.notEqual(config.json.config.server.port, port);
});

test("failed organization enrollment immediately restores desired protection", { skip: process.platform !== "linux" }, async t => {
  const { http, active, events } = await fixture(t, { protectedMode: true });
  for(let i=0;i<100;i++){try{await readFile(active);break;}catch{}await delay(25);}
  const response = await http("POST", "/api/action", { action: "registerOrganization", value: "test-team" });
  assert.equal(response.status, 502);
  assert.equal(response.json.ok, false);
  assert.equal(response.json.killSwitchResume.ok, true, JSON.stringify(response.json));
  assert.equal(response.json.killSwitchResume.reason, "enrollment_failed");
  const protection = await http("GET", "/api/killswitch");
  assert.equal(protection.json.desired, true);
  assert.equal(protection.json.active, true);
  assert.equal(protection.json.enrollmentPause.paused, false);
  assert.match(await readFile(events,"utf8"), /true\nfalse\ntrue\n/);
});
