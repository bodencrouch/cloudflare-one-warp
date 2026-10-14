import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, isAbsolute } from "node:path";



function dataDirs(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const user = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, ".local/share");
  const system = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
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
    name: fields.Name,
    exec: fields.Exec,
    icon: fields.Icon || null,
    path: filePath,
    categories: fields.Categories || ""
  };
}

export async function listDesktopApps(env = process.env) {
  if (process.platform !== "linux" && process.platform !== "freebsd") return [];
  const seen = new Map();
  for (const dataDir of dataDirs(env)) {
    const appsDir = join(dataDir, "applications");
    let entries = [];
    try {
      entries = await readdir(appsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".desktop")) continue;
      if (entry.name.startsWith("cloudflare-one-warp-")) continue;
      const filePath = join(appsDir, entry.name);
      let text = "";
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      const id = basename(filePath, ".desktop");
      if (seen.has(id)) continue;
      // A hidden user entry masks an entry with the same ID in system directories.
      const app = parseDesktopEntry(text, filePath);
      seen.set(id, app);
    }
  }
  return [...seen.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse Desktop Entry Exec as argv, never as a shell command. */
export function desktopExecArgs(exec) {
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
    if (/^%[fFuUiIcCk]$/.test(arg)) continue;
    if (/%(?!%)/.test(arg.replace(/%%/g, ""))) throw new Error("Unsupported embedded desktop field code.");
    expanded.push(arg.replace(/%%/g, "%"));
  }
  if (!expanded.length) throw new Error("Empty desktop Exec command.");
  return expanded;
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function desktopQuote(value) {
  return '"' + String(value).replace(/\\/g, "\\\\\\\\").replace(/["`$]/g, "\\\\$&") + '"';
}

export function sanitizeExec(exec) {
  return desktopExecArgs(exec).map((arg) => /^[a-zA-Z0-9_./=-]+$/.test(arg) ? arg : shellQuote(arg)).join(" ");
}

export function proxyEnvLines(port) {
  const host = `127.0.0.1:${port}`;
  return [
    `export ALL_PROXY="socks5://${host}"`,
    `export HTTP_PROXY="http://${host}"`,
    `export HTTPS_PROXY="http://${host}"`
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

  let execLine;
  try { execLine = sanitizeExec(app.exec); }
  catch (error) { return { ok: false, error: error.message }; }
  const root = launchersRoot(env);
  await mkdir(root, { recursive: true });
  await mkdir(applicationsDir(env), { recursive: true });

  const slug = app.id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const scriptPath = join(root, `${slug}.sh`);
  const script = `#!/bin/sh
# Cloudflare One WARP — launch ${app.name} through WARP local proxy
${proxyEnvLines(safePort).join("\n")}
exec ${execLine}
`;
  await writeFile(scriptPath, script, { mode: 0o755 });
  await chmod(scriptPath, 0o755);

  const desktopName = `cloudflare-one-warp-${slug}.desktop`;
  const desktopPath = join(applicationsDir(env), desktopName);
  const desktop = `[Desktop Entry]
Type=Application
Name=${app.name} (through WARP)
Comment=Launch ${app.name} through Cloudflare One WARP local proxy
Exec=${desktopQuote(scriptPath)}
Icon=${app.icon || "cloudflare-one-warp"}
Terminal=false
Categories=Network;
StartupNotify=true
`;
  await writeFile(desktopPath, desktop, { mode: 0o644 });

  return {
    ok: true,
    app: { id: app.id, name: app.name },
    scriptPath,
    desktopPath,
    desktopName,
    proxy: `127.0.0.1:${safePort}`
  };
}
