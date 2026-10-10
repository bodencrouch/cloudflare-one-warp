import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coerce } from "./semver.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL_MANIFEST = join(root, "config/update-manifest.json");

export function emptyManifest() {
  return {
    schema: 1,
    stable: null,
    beta: null
  };
}

export function parseManifest(raw) {
  if (!raw || typeof raw !== "object") return emptyManifest();
  return {
    schema: Number(raw.schema) || 1,
    stable: normalizePointer(raw.stable),
    beta: normalizePointer(raw.beta)
  };
}

function normalizePointer(pointer) {
  if (!pointer || typeof pointer !== "object") return null;
  const version = coerce(pointer.version || pointer.tag);
  if (!version) return null;
  const tag = pointer.tag || `v${version}`;
  return { version, tag };
}

export function readLocalManifest() {
  if (!existsSync(LOCAL_MANIFEST)) return emptyManifest();
  try {
    return parseManifest(JSON.parse(readFileSync(LOCAL_MANIFEST, "utf8")));
  } catch {
    return emptyManifest();
  }
}

/**
 * Fetch remote update manifest from a GitHub repo's main branch.
 */
export async function fetchRemoteManifest(source, { env = process.env, fetchImpl = fetch } = {}) {
  const { owner, repo } = source;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/config/update-manifest.json`;
  const headers = { "user-agent": "Cloudflare-One-WARP-UpdateCheck" };
  const token = env.CLOUDFLARE_ONE_WARP_GITHUB_TOKEN || env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Failed to fetch update manifest (${response.status})`);
    error.code = "MANIFEST_FETCH";
    throw error;
  }
  return parseManifest(await response.json());
}

export function pointerForChannel(manifest, channel = "stable") {
  if (channel === "beta") return manifest.beta || manifest.stable || null;
  return manifest.stable || null;
}

export function buildManifest({ version, tag, prerelease = false, previous = null }) {
  const base = previous ? parseManifest(previous) : emptyManifest();
  const pointer = {
    version: coerce(version) || String(version).replace(/^v/i, ""),
    tag: tag || `v${String(version).replace(/^v/i, "")}`
  };
  if (prerelease) {
    base.beta = pointer;
  } else {
    base.stable = pointer;
  }
  base.schema = 1;
  return base;
}
