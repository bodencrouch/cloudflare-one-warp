/**
 * Sync Cloudflare One WARP / warp-cli state with NetworkManager and KDE proxy settings.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { normalizeOperatingMode } from "../warp/settings.mjs";
import { PROFILE_IDS, profileBySlug, WARP_PROFILES } from "./profiles.mjs";

async function run(cmd, args, env = process.env) {
  try {
    const result = await execFileAsync(cmd, args, { env, encoding: "utf8", timeout: 30000, maxBuffer: 262144 });
    return { ...result, status: 0 };
  } catch (error) {
    return { status: error.code, stdout: error.stdout || "", stderr: error.stderr || error.message };
  }
}

export async function commandExists(name) {
  const res = await run("sh", ["-c", `command -v "$1"`, "cloudflare-one-warp", name]);
  return res.status === 0 && Boolean(res.stdout?.trim());
}

export async function nmcliAvailable() {
  return commandExists("nmcli");
}

export async function nmConnectionActive(connectionId) {
  if (!await nmcliAvailable()) return false;
  const res = await run("nmcli", ["-t", "-f", "NAME,STATE", "connection", "show", "--active"]);
  if (res.status !== 0) return false;
  return res.stdout.split("\n").some((line) => {
    const [name, state] = line.split(":");
    return name === connectionId && state === "activated";
  });
}

export async function activateNmProfile(slug) {
  const profile = profileBySlug(slug);
  if (!profile || !await nmcliAvailable()) return { ok: false, skipped: true };
  const res = await run("nmcli", ["connection", "up", profile.id]);
  return { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr, profile: profile.id };
}

export async function deactivateCloudflareOneWarpNmProfiles() {
  if (!await nmcliAvailable()) return { ok: false, skipped: true };
  const failures = [];
  let last = { ok: true };
  for (const profile of WARP_PROFILES) {
    if (!await nmConnectionActive(profile.id)) continue;
    const res = await run("nmcli", ["connection", "down", profile.id]);
    last = { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr, profile: profile.id };
    if (!last.ok) failures.push(last);
  }
  return failures.length ? { ok: false, failures, stderr: failures.map(result => result.stderr).join("\n") } : last;
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

export async function syncNmForWarpState(snapshot) {
  if (!await nmcliAvailable()) return { ok: false, skipped: true, reason: "nmcli missing" };
  const settings = snapshot?.settings || {};
  const modeRaw = settings.Mode ?? settings.mode ?? "";
  const protocolRaw = settings["Preferred protocol"] ?? settings["Tunnel protocol"] ?? settings.protocol ?? settings.Protocol ?? "";
  const status = String(snapshot?.status?.text || snapshot?.status || "").toLowerCase();
  const connected = typeof snapshot?.status?.connected === "boolean"
    ? snapshot.status.connected : status.includes("connected") && !status.includes("disconnected");

  if (!connected) {
    return deactivateCloudflareOneWarpNmProfiles();
  }

  const mode = normalizeOperatingMode(modeRaw);
  if (!["warp", "proxy"].includes(mode)) {
    return { ok: false, skipped: true, reason: "The current operating mode has no matching NetworkManager marker." };
  }
  const slug = slugForWarpSettings({ mode, protocol: protocolRaw });
  const profile = profileBySlug(slug);
  if (!profile) return { ok: false, error: "unknown profile" };

  for (const other of WARP_PROFILES) {
    if (other.slug === slug) continue;
    if (await nmConnectionActive(other.id)) {
      const result = await run("nmcli", ["connection", "down", other.id]);
      if (result.status !== 0) return { ok: false, profile: other.id, stderr: result.stderr, reason: "Failed to deactivate conflicting profile" };
    }
  }

  if (await nmConnectionActive(profile.id)) {
    return { ok: true, profile: profile.id, alreadyActive: true };
  }
  return activateNmProfile(slug);
}

export function kdeProxySyncScript(appRoot) {
  return `${appRoot}/scripts/cloudflare-one-warp-kde-proxy-sync`;
}

export async function syncKdeProxy({ enabled, port = 40000, appRoot }) {
  const script = kdeProxySyncScript(appRoot);
  const args = enabled ? ["on", String(port)] : ["off"];
  const res = await run(script, args, { ...process.env, CLOUDFLARE_ONE_WARP_HOME: appRoot });
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
