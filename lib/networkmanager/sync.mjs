/**
 * Sync Cloudflare One WARP / warp-cli state with NetworkManager and KDE proxy settings.
 */

import { spawnSync } from "node:child_process";
import { PROFILE_IDS, profileBySlug, WARP_PROFILES } from "./profiles.mjs";

function run(cmd, args, env = process.env) {
  return spawnSync(cmd, args, {
    env,
    encoding: "utf8",
    timeout: 30000
  });
}

export function commandExists(name) {
  const res = run("sh", ["-c", `command -v ${name}`]);
  return res.status === 0 && Boolean(res.stdout?.trim());
}

export function nmcliAvailable() {
  return commandExists("nmcli");
}

export function nmConnectionActive(connectionId) {
  if (!nmcliAvailable()) return false;
  const res = run("nmcli", ["-t", "-f", "NAME,STATE", "connection", "show", "--active"]);
  if (res.status !== 0) return false;
  return res.stdout.split("\n").some((line) => {
    const [name, state] = line.split(":");
    return name === connectionId && state === "activated";
  });
}

export function activateNmProfile(slug) {
  const profile = profileBySlug(slug);
  if (!profile || !nmcliAvailable()) return { ok: false, skipped: true };
  const res = run("nmcli", ["connection", "up", profile.id]);
  return { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr, profile: profile.id };
}

export function deactivateCloudflareOneWarpNmProfiles() {
  if (!nmcliAvailable()) return { ok: false, skipped: true };
  let last = { ok: true };
  for (const profile of WARP_PROFILES) {
    if (!nmConnectionActive(profile.id)) continue;
    const res = run("nmcli", ["connection", "down", profile.id]);
    last = { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr, profile: profile.id };
  }
  return last;
}

/**
 * Pick the NM profile slug that matches current warp settings.
 * @param {{ mode?: string, protocol?: string }} opts
 */
export function slugForWarpSettings(opts = {}) {
  const mode = String(opts.mode || "").toLowerCase();
  const protocol = String(opts.protocol || "").toLowerCase();
  if (mode === "proxy") return "proxy";
  if (protocol.includes("wireguard")) return "wireguard";
  return "masque";
}

export function syncNmForWarpState(snapshot) {
  if (!nmcliAvailable()) return { ok: false, skipped: true, reason: "nmcli missing" };
  const settings = snapshot?.settings || {};
  const modeRaw = settings.Mode ?? settings.mode ?? "";
  const protocolRaw = settings["Preferred protocol"] ?? settings.protocol ?? settings.Protocol ?? "";
  const status = String(snapshot?.status?.text || snapshot?.status || "").toLowerCase();
  const connected = status.includes("connected") && !status.includes("disconnected");

  if (!connected) {
    return deactivateCloudflareOneWarpNmProfiles();
  }

  const slug = slugForWarpSettings({ mode: modeRaw, protocol: protocolRaw });
  const profile = profileBySlug(slug);
  if (!profile) return { ok: false, error: "unknown profile" };

  for (const other of WARP_PROFILES) {
    if (other.slug === slug) continue;
    if (nmConnectionActive(other.id)) {
      run("nmcli", ["connection", "down", other.id]);
    }
  }

  if (nmConnectionActive(profile.id)) {
    return { ok: true, profile: profile.id, alreadyActive: true };
  }
  return activateNmProfile(slug);
}

export function kdeProxySyncScript(appRoot) {
  return `${appRoot}/scripts/cloudflare-one-warp-kde-proxy-sync`;
}

export function syncKdeProxy({ enabled, port = 40000, appRoot }) {
  const script = kdeProxySyncScript(appRoot);
  const args = enabled ? ["on", String(port)] : ["off"];
  const res = run(script, args, { ...process.env, CLOUDFLARE_ONE_WARP_HOME: appRoot });
  return {
    ok: res.status === 0,
    skipped: res.status === 2,
    stdout: res.stdout,
    stderr: res.stderr
  };
}

export function profileIdForSlug(slug) {
  return profileBySlug(slug)?.id || null;
}

export { PROFILE_IDS };
