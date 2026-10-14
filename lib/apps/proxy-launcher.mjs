import { chmod, mkdir, readdir, open, lstat, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, isAbsolute, relative } from "node:path";



function dataDirs(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const user = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, ".local/share");
  const system = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter((dir) => isAbsolute(dir));
  return [...new Set([user, ...system])];
}

function launchersRoot(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const dataHome = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, ".local/share");
  return join(dataHome, "cloudflare-one-warp", "proxy-launchers");
}

function applicationsDir(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const dataHome = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, ".local/share");
  return join(dataHome, "applications");
}

function parseDesktopEntry(text, filePath) {
  const lines = String(text).split(/\r?\n/);
  const fields = {};
  let inDesktopEntry = false;
  for (const line of lines) {
    if (line.startsWith("[")) { inDesktopEntry = line === "[Desktop Entry]"; continue; }
    if (!inDesktopEntry || !line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in fields)) fields[key] = value;
  }
  if (fields.Type !== "Application") return null;
  if (fields.NoDisplay === "true" || fields.Hidden === "true") return null;
  if (!fields.Name || !fields.Exec) return null;
  const id = basename(filePath, ".desktop");
  return {
    id,
    name: desktopUnescape(fields.Name),
    exec: fields.Exec,
    icon: fields.Icon ? desktopUnescape(fields.Icon) : null,
    terminal: fields.Terminal === "true",
    workingDirectory: fields.Path ? desktopUnescape(fields.Path) : null,
    path: filePath,
    categories: fields.Categories || ""
  };
}

const MAX_ENTRY_BYTES = 256 * 1024;
async function readEntry(path) {
  // Nonblocking open avoids hanging on a malicious FIFO; fstat checks the opened file.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) throw new Error("Invalid desktop entry file.");
    const buffer = Buffer.alloc(MAX_ENTRY_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_ENTRY_BYTES) throw new Error("Desktop entry is too large.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}
export async function listDesktopApps(env = process.env) {
  if (process.platform !== "linux" && process.platform !== "freebsd") return [];
  const seen = new Map();
  for (const dataDir of dataDirs(env)) {
    const appsDir = join(dataDir, "applications");
    const pending = [{ path: appsDir, depth: 0 }];
    let count = 0;
    while (pending.length && count < 10000) {
      const dir = pending.shift();
      let entries;
      try { entries = await readdir(dir.path, { withFileTypes: true }); } catch { continue; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++count > 10000) break;
        const filePath = join(dir.path, entry.name);
        if (entry.isDirectory() && dir.depth < 8) { pending.push({ path: filePath, depth: dir.depth + 1 }); continue; }
        if (!entry.name.endsWith(".desktop")) continue;
        const id = relative(appsDir, filePath).replaceAll("/", "-").slice(0, -8);
        if (id.startsWith("cloudflare-one-warp-") || seen.has(id)) continue;
        try {
          const app = parseDesktopEntry(await readEntry(filePath), filePath);
          if (app) app.id = id;
          seen.set(id, app);
        } catch { /* Unreadable, oversized, or nonregular entry. */ }
      }
    }
  }
  return [...seen.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse Desktop Entry Exec as argv, never as a shell command. */
export function desktopExecArgs(exec, metadata = {}, legacy = false) {
  // Desktop value escaping is applied before Exec argument escaping.
  const value = String(exec || "").replace(/\\([sntr\\])/g, (_, char) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" }[char]));
  const args = [];
  let current = "", quoted = false, started = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '"') { quoted = !quoted; started = true; continue; }
    if (char === "\\") {
      if (i + 1 >= value.length) throw new Error("Invalid trailing escape in desktop Exec.");
      current += value[++i]; started = true; continue;
    }
    if (/\s/.test(char) && !quoted) {
      if (started) args.push(current);
      current = ""; started = false;
    } else { current += char; started = true; }
  }
  if (quoted) throw new Error("Unterminated desktop Exec quote.");
  if (started) args.push(current);
  const expanded = [];
  for (const arg of args) {
    if (/^%[fFuU]$/.test(arg) || (legacy && /^%[iIcCk]$/.test(arg))) continue;
    if (arg === "%c") { if (!metadata.name) throw new Error("Missing desktop name."); expanded.push(metadata.name); continue; }
    if (arg === "%k") { if (!metadata.path) throw new Error("Missing desktop path."); expanded.push(metadata.path); continue; }
    if (arg === "%i") { if (metadata.icon) expanded.push("--icon", metadata.icon); continue; }
    if (/%(?!%)/.test(arg.replace(/%%/g, ""))) throw new Error("Unsupported embedded desktop field code.");
    expanded.push(arg.replace(/%%/g, "%"));
  }
  if (!expanded.length) throw new Error("Empty desktop Exec command.");
  return expanded;
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function desktopUnescape(value) {
  return String(value).replace(/\\([sntr\\])/g, (_, char) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" }[char]));
}
function desktopValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}
function desktopQuote(value) {
  const argument = '"' + String(value).replace(/\\/g, "\\\\").replace(/["`$]/g, "\\$&").replace(/%/g, "%%") + '"';
  return desktopValue(argument);
}
function launcherScript(app, port, marker, legacy = false) {
  const execLine = legacy
    ? desktopExecArgs(app.exec, {}, true).map(arg => /^[a-zA-Z0-9_./=-]+$/.test(arg) ? arg : shellQuote(arg)).join(" ")
    : sanitizeExec(app.exec, app);
  const header = legacy ? `# Cloudflare One WARP — launch ${app.name} through WARP local proxy` : marker;
  const exports = legacy
    ? [`export ALL_PROXY="socks5://127.0.0.1:${port}"`, `export HTTP_PROXY="http://127.0.0.1:${port}"`, `export HTTPS_PROXY="http://127.0.0.1:${port}"`]
    : proxyEnvLines(port);
  let cwd = "";
  if (!legacy && app.workingDirectory) {
    if (!isAbsolute(app.workingDirectory)) throw new Error("Desktop working directory must be absolute.");
    cwd = `cd ${shellQuote(app.workingDirectory)} || exit 1\n`;
  }
  return `#!/bin/sh\n${header}\n${exports.join("\n")}\n${cwd}exec ${execLine}\n`;
}
function launcherDesktop(app, scriptPath, marker, legacy = false) {
  const name = legacy ? app.name : desktopValue(app.name);
  const icon = legacy ? (app.icon || "cloudflare-one-warp") : desktopValue(app.icon || "cloudflare-one-warp");
  // Legacy Exec did not escape percent field codes; recognize its exact old bytes.
  const oldQuote = value => '"' + String(value).replace(/\\/g, "\\\\\\\\").replace(/["`$]/g, "\\\\$&") + '"';
  return `${legacy ? "" : marker + "\n"}[Desktop Entry]\nType=Application\nName=${name} (through WARP)\nComment=Launch ${name} through Cloudflare One WARP local proxy\nExec=${legacy ? oldQuote(scriptPath) : desktopQuote(scriptPath)}\nIcon=${icon}\nTerminal=${!legacy && app.terminal ? "true" : "false"}\nCategories=Network;\nStartupNotify=true\n`;
}

export function sanitizeExec(exec, metadata) {
  return desktopExecArgs(exec, metadata).map((arg) => /^[a-zA-Z0-9_./=-]+$/.test(arg) ? arg : shellQuote(arg)).join(" ");
}

export function proxyEnvLines(port) {
  const host = `127.0.0.1:${port}`;
  return [
    `unset NO_PROXY no_proxy`,
    `export ALL_PROXY="socks5h://${host}" all_proxy="socks5h://${host}"`,
    `export HTTP_PROXY="http://${host}" http_proxy="http://${host}"`,
    `export HTTPS_PROXY="http://${host}" https_proxy="http://${host}"`
  ];
}

export async function createProxyLauncher({ appId, port = 40000, env = process.env }) {
  const apps = await listDesktopApps(env);
  const app = apps.find((entry) => entry.id === appId);
  if (!app) {
    return { ok: false, error: "App not found." };
  }
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) {
    return { ok: false, error: "Invalid proxy port." };
  }

  try { sanitizeExec(app.exec, app); if (app.workingDirectory && !isAbsolute(app.workingDirectory)) throw new Error("Desktop working directory must be absolute."); }
  catch (error) { return { ok: false, error: error.message }; }
  const root = launchersRoot(env);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(applicationsDir(env), { recursive: true });
  for (const directory of [root, applicationsDir(env)]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
      return { ok: false, error: "Unsafe launcher directory." };
    }
  }
  await chmod(root, 0o700);

  const normalized = app.id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const slug = normalized === app.id ? normalized : `${normalized}-${createHash("sha256").update(app.id).digest("hex").slice(0, 12)}`;
  const marker = `# Cloudflare One WARP generated launcher: ${createHash("sha256").update(app.id).digest("hex")}`;
  const scriptPath = join(root, `${slug}.sh`);
  const script = launcherScript(app, safePort, marker);
  const desktopName = `cloudflare-one-warp-${slug}.desktop`;
  const desktopPath = join(applicationsDir(env), desktopName);
  const desktop = launcherDesktop(app, scriptPath, marker);
  try {
    const existingScript = await ownedText(scriptPath);
    const existingDesktop = await ownedText(desktopPath);
    const marked = (text) => text === null || text.split("\n").includes(marker);
    if (!marked(existingScript) || !marked(existingDesktop)) {
      // Migrate only the complete, exact pair generated by the previous release.
      // An edited shortcut, missing half, or unrelated file must never be replaced.
      const oldPort = existingScript?.match(/^export ALL_PROXY="socks5:\/\/127\.0\.0\.1:([0-9]+)"$/m)?.[1];
      const validPort = oldPort && Number(oldPort) >= 1 && Number(oldPort) <= 65535 && String(Number(oldPort)) === oldPort;
      const oldScript = launcherScript(app, oldPort, marker, true);
      const oldDesktop = launcherDesktop(app, scriptPath, marker, true);
      if (!validPort || existingScript !== oldScript || existingDesktop !== oldDesktop) {
        throw new Error("Refusing to overwrite an unowned or modified launcher file.");
      }
    }
    await atomicLauncher(scriptPath, script, 0o700);
    await atomicLauncher(desktopPath, desktop, 0o600);
  } catch (error) { return { ok: false, error: error.message }; }

  return {
    ok: true,
    app: { id: app.id, name: app.name },
    scriptPath,
    desktopPath,
    desktopName,
    proxy: `127.0.0.1:${safePort}`
  };
}

async function ownedText(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Refusing to replace an unsafe launcher file.");
    }
    return await readEntry(path);
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function atomicLauncher(path, text, mode) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", mode);
    try { await handle.writeFile(text); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

/** Remove only complete, unchanged shortcut pairs belonging to this user. */
export async function cleanupOwnedProxyLaunchers({ env = process.env } = {}) {
  const root = launchersRoot(env);
  const appDir = applicationsDir(env);
  for (const directory of [root, appDir]) {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
        return { ok: false, removed: [], error: "Unsafe launcher directory." };
      }
    } catch (error) {
      if (error.code === "ENOENT") return { ok: true, removed: [] };
      return { ok: false, removed: [], error: error.message };
    }
  }
  const removed = [];
  for (const app of await listDesktopApps(env)) {
    const normalized = app.id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
    const digest = createHash("sha256").update(app.id).digest("hex");
    const slug = normalized === app.id ? normalized : `${normalized}-${digest.slice(0, 12)}`;
    const scriptPath = join(root, `${slug}.sh`);
    const desktopName = `cloudflare-one-warp-${slug}.desktop`;
    const desktopPath = join(appDir, desktopName);
    try {
      const script = await ownedText(scriptPath);
      const desktop = await ownedText(desktopPath);
      if (script === null || desktop === null) continue;
      const marker = `# Cloudflare One WARP generated launcher: ${digest}`;
      const currentPort = script.match(/^export ALL_PROXY="socks5h:\/\/127\.0\.0\.1:([0-9]+)" all_proxy="socks5h:\/\/127\.0\.0\.1:\1"$/m)?.[1];
      const legacyPort = script.match(/^export ALL_PROXY="socks5:\/\/127\.0\.0\.1:([0-9]+)"$/m)?.[1];
      const port = currentPort || legacyPort;
      if (!port || Number(port) < 1 || Number(port) > 65535 || String(Number(port)) !== port) continue;
      const expectedScript = launcherScript(app, Number(port), marker, !currentPort);
      const expectedDesktop = launcherDesktop(app, scriptPath, marker, !currentPort);
      if (script !== expectedScript || desktop !== expectedDesktop) continue;
      // Validate both immediately before removal; unlink never follows a file symlink.
      if (await ownedText(scriptPath) !== script || await ownedText(desktopPath) !== desktop) continue;
      await unlink(desktopPath);
      await unlink(scriptPath);
      removed.push(desktopName);
    } catch { /* Preserve unreadable, edited, foreign-owned, or invalid pairs. */ }
  }
  return { ok: true, removed };
}
