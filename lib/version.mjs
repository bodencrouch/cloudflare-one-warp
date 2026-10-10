import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let cached = null;

export function getVersion() {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    cached = String(pkg.version || "0.0.0");
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

export function getVersionInfo(config = {}) {
  return {
    version: getVersion(),
    channel: config.updates?.channel || "stable",
    source: {
      owner: config.updates?.source?.owner || "bodencrouch",
      repo: config.updates?.source?.repo || "cloudflare-one-warp"
    },
    installFormat: process.env.CLOUDFLARE_ONE_WARP_INSTALL_FORMAT || null
  };
}
