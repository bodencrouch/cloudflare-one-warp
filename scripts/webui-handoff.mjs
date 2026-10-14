#!/usr/bin/env node
/** Owner-only browser bootstrap. Secrets stay in a private file, never argv. */
import { constants, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configPaths } from "../lib/config.mjs";
import { API_REVISION } from "../lib/api-revision.mjs";
import { sessionTokenPath } from "../lib/http/request-gate.mjs";
import { ensurePrivateDirectory, assertPrivateDirectory, ensurePrivateFile, assertPrivateFile } from "../lib/security/private-files.mjs";

function handoffDirectory(env) {
  return join(dirname(configPaths(env).user), "webui-handoff");
}

export function cleanupWebuiHandoffs({ env = process.env, all = false, port = null } = {}) {
  const directory = handoffDirectory(env);
  let info;
  try { info = lstatSync(directory); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  assertPrivateDirectory(directory);
  for (const name of readdirSync(directory)) {
    if (!/^handoff-[0-9]+-[a-f0-9-]+\.html(?:\.tmp)?$/.test(name)) continue;
    if (port !== null && !name.startsWith(`handoff-${Number(port)}-`)) continue;
    const path = join(directory, name);
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink()) continue;
    if (!all && Date.now() - file.mtimeMs <= 60 * 60 * 1000) continue;
    assertPrivateFile(path);
    rmSync(path);
  }
}

export function createWebuiHandoff({ url, shell = false, env = process.env } = {}) {
  const target = new URL(url);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("Browser handoff requires a local daemon URL");
  }
  const port = Number(target.port || 80);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid daemon port");
  const tokenPath = sessionTokenPath(port, env);
  assertPrivateFile(tokenPath);
  const tokenFile = openSync(tokenPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let token;
  try {
    token = readFileSync(tokenFile, "utf8").trim();
  } finally { closeSync(tokenFile); }
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Missing or invalid daemon session credential");
  const parent = dirname(configPaths(env).user);
  mkdirSync(dirname(parent), { recursive: true, mode: 0o700 });
  ensurePrivateDirectory(parent);
  const directory = handoffDirectory(env);
  ensurePrivateDirectory(directory);
  cleanupWebuiHandoffs({ env });
  if (shell) target.searchParams.set("shell", "1");
  target.searchParams.set("clientRevision", String(API_REVISION));
  target.hash = `session=${token}`;
  const escaped = target.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const file = join(directory, `handoff-${port}-${randomUUID()}.html`);
  const temporary = `${file}.tmp`;
  try {
    writeFileSync(temporary, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'"><meta http-equiv="refresh" content="0;url=${escaped}"><title>Opening Cloudflare One WARP</title><a href="${escaped}">Open Cloudflare One WARP</a>\n`, { mode: 0o600, flag: "wx" });
    ensurePrivateFile(temporary, { created: true });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return pathToFileURL(file).href;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.includes("--cleanup")) cleanupWebuiHandoffs({ all: true });
    else console.log(createWebuiHandoff({ url: process.argv[2], shell: process.argv.includes("--shell") }));
  } catch (error) {
    console.error(`Unable to open authenticated Web UI: ${error.message}`);
    process.exitCode = 1;
  }
}
