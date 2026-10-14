import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { readManagedCandidate, writeManagedCandidate } from "./managed-file.mjs";

const MANAGED_MARKER = "# Managed by Cloudflare One WARP tray";
const AUTOSTART_BASENAME = "cloudflare-one-warp-tray.desktop";

export function trayAutostartPath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configHome = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(configHome, "autostart", AUTOSTART_BASENAME);
}

export function resolveAppRoot(env = process.env) {
  const fromEnv = env.CLOUDFLARE_ONE_WARP_HOME;
  if (fromEnv && existsSync(join(fromEnv, "server.js"))) return fromEnv;
  const metaRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (existsSync(join(metaRoot, "server.js"))) return metaRoot;
  if (existsSync("/usr/lib/cloudflare-one-warp/server.js")) return "/usr/lib/cloudflare-one-warp";
  return metaRoot;
}

export function resolveTrayExec(env = process.env, appRoot = resolveAppRoot(env)) {
  const fhs = "/usr/bin/cloudflare-one-warp-tray";
  if (existsSync(fhs)) return fhs;
  const local = join(appRoot, "bin", "cloudflare-one-warp-tray");
  if (existsSync(local)) return local;
  return "cloudflare-one-warp-tray";
}

export function resolveTrayIcon(env = process.env, appRoot = resolveAppRoot(env)) {
  if (existsSync("/usr/share/icons/hicolor/scalable/apps/cloudflare-one-warp.svg")) return "cloudflare-one-warp";
  const local = join(appRoot, "assets", "cloudflare-one-warp.svg");
  if (existsSync(local)) return local;
  return "cloudflare-one-warp";
}

/**
 * Build the XDG autostart entry for the Cloudflare One WARP tray.
 *
 * No `Hidden=true` here. In an autostart directory that key does not mean
 * "hide from menus" — it means "ignore this entry", which is exactly how we
 * disable Cloudflare's autostart in lib/tray/shell.mjs. Setting it here made
 * the entry a no-op: systemd-xdg-autostart-generator logs "not generating
 * unit, entry is hidden" and the tray never started at login.
 */
function desktopExec(value) {
  const text = String(value);
  if (/[\r\n\0]/.test(text)) throw new Error("Invalid tray executable path");
  const escaped = text.replace(/%/g, "%%");
  return /[\s"\\`$><~|&;*?#()']/.test(escaped)
    ? '"' + escaped.replace(/\\/g, "\\\\\\\\").replace(/["`$]/g, "\\\\$&") + '"' : escaped;
}

function isManaged(content) {
  if (typeof content !== "string") return false;
  if (content.startsWith(`${MANAGED_MARKER}\n`)) return true;
  // Recognize exactly the pre-marker generator shape during upgrade.
  const exec = content.match(/^Exec=(.*)$/m)?.[1];
  const icon = content.match(/^Icon=(.*)$/m)?.[1];
  if (!exec || !icon) return false;
  return content === buildTrayAutostartDesktop({ exec: "cloudflare-one-warp-tray", icon })
    .replace(`${MANAGED_MARKER}\n`, "").replace("Exec=cloudflare-one-warp-tray", `Exec=${exec}`);
}

export function buildTrayAutostartDesktop({ exec, icon }) {
  if (/[\r\n\0]/.test(String(icon))) throw new Error("Invalid tray icon path");
  return `${MANAGED_MARKER}
[Desktop Entry]
Type=Application
Name=Cloudflare One WARP Tray
Comment=Cloudflare One WARP system tray and control panel
Exec=${desktopExec(exec)}
Icon=${icon}
Terminal=false
Categories=Network;
X-GNOME-Autostart-enabled=true
X-KDE-autostart-after=panel
StartupNotify=false
`;
}

/**
 * Write or remove the user XDG autostart desktop entry for the tray.
 * Linux-only; no-op elsewhere.
 */
export function syncTrayAutostart({ autostart, env = process.env, appRoot } = {}) {
  if (process.platform !== "linux") {
    return { ok: true, skipped: true, reason: "non-linux" };
  }

  const root = appRoot || resolveAppRoot(env);
  const path = trayAutostartPath(env);
  const enabled = Boolean(autostart);
  const existing = readManagedCandidate(path);
  if (existing !== null && !isManaged(existing)) {
    return { ok: false, enabled, path, preserved: true, reason: "unmanaged-autostart-entry" };
  }

  if (!enabled) {
    if (existing !== null) {
      unlinkSync(path);
      return { ok: true, enabled: false, path, removed: true };
    }
    return { ok: true, enabled: false, path, removed: false };
  }

  const content = buildTrayAutostartDesktop({
    exec: resolveTrayExec(env, root),
    icon: resolveTrayIcon(env, root)
  });
  if (existing === content) {
    return { ok: true, enabled: true, path, unchanged: true };
  }

  writeManagedCandidate(path, content);
  return { ok: true, enabled: true, path, written: true };
}
