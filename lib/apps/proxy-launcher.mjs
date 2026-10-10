import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const FIELD_CODE_RE = /\s+%[fFuUiIcCk]/g;

function dataDirs(env = process.env) {
  if (env.XDG_DATA_DIRS) {
    return env.XDG_DATA_DIRS.split(":").filter(Boolean);
  }
  const home = env.HOME || env.USERPROFILE || homedir();
  return [join(home, ".local/share"), "/usr/local/share", "/usr/share"];
}

function launchersRoot(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const dataHome = env.XDG_DATA_HOME || join(home, ".local/share");
  return join(dataHome, "cloudflare-one-warp", "proxy-launchers");
}

function applicationsDir(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const dataHome = env.XDG_DATA_HOME || join(home, ".local/share");
  return join(dataHome, "applications");
}

function parseDesktopEntry(text, filePath) {
  const lines = String(text).split(/\r?\n/);
  const fields = {};
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
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
      const app = parseDesktopEntry(text, filePath);
      if (!app) continue;
      if (!seen.has(app.id)) seen.set(app.id, app);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function sanitizeExec(exec) {
  return String(exec || "").replace(FIELD_CODE_RE, "").trim();
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
  if (!Number.isFinite(safePort) || safePort < 1 || safePort > 65535) {
    return { ok: false, error: "Invalid proxy port." };
  }

  const root = launchersRoot(env);
  await mkdir(root, { recursive: true });
  await mkdir(applicationsDir(env), { recursive: true });

  const slug = app.id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const scriptPath = join(root, `${slug}.sh`);
  const execLine = sanitizeExec(app.exec);
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
Exec=${scriptPath}
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
