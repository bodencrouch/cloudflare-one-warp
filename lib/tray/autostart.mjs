import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUTOSTART_BASENAME = "thirdflare-one-tray.desktop";

export function trayAutostartPath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configHome, "autostart", AUTOSTART_BASENAME);
}

export function resolveAppRoot(env = process.env) {
  const fromEnv = env.THIRDFLARE_ONE_HOME;
  if (fromEnv && existsSync(join(fromEnv, "server.js"))) return fromEnv;
  const metaRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (existsSync(join(metaRoot, "server.js"))) return metaRoot;
  if (existsSync("/usr/lib/thirdflare/server.js")) return "/usr/lib/thirdflare";
  return metaRoot;
}

export function resolveTrayExec(env = process.env, appRoot = resolveAppRoot(env)) {
  const fhs = "/usr/bin/thirdflare-one-tray";
  if (existsSync(fhs)) return fhs;
  const local = join(appRoot, "bin", "thirdflare-tray");
  if (existsSync(local)) return local;
  return "thirdflare-one-tray";
}

export function resolveTrayIcon(env = process.env, appRoot = resolveAppRoot(env)) {
  if (existsSync("/usr/share/icons/hicolor/scalable/apps/thirdflare.svg")) return "thirdflare";
  const local = join(appRoot, "assets", "thirdflare.svg");
  if (existsSync(local)) return local;
  return "thirdflare-one";
}

/**
 * Build the XDG autostart entry for the ThirdFlare One tray.
 *
 * No `Hidden=true` here. In an autostart directory that key does not mean
 * "hide from menus" — it means "ignore this entry", which is exactly how we
 * disable Cloudflare's autostart in lib/tray/shell.mjs. Setting it here made
 * the entry a no-op: systemd-xdg-autostart-generator logs "not generating
 * unit, entry is hidden" and the tray never started at login.
 */
export function buildTrayAutostartDesktop({ exec, icon }) {
  return `[Desktop Entry]
Type=Application
Name=ThirdFlare One Tray
Comment=ThirdFlare One system tray and control panel
Exec=${exec}
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

  if (!enabled) {
    if (existsSync(path)) {
      unlinkSync(path);
      return { ok: true, enabled: false, path, removed: true };
    }
    return { ok: true, enabled: false, path, removed: false };
  }

  const content = buildTrayAutostartDesktop({
    exec: resolveTrayExec(env, root),
    icon: resolveTrayIcon(env, root)
  });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (existing === content) {
    return { ok: true, enabled: true, path, unchanged: true };
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o644 });
  return { ok: true, enabled: true, path, written: true };
}
