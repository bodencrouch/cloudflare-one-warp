import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, chmodSync, copyFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { isTrustedAssetUrl } from "./github.mjs";
import { signatureAssetName, verifyDetachedSignature } from "./verify-signature.mjs";
import { trustedUpdateKeys } from "./trusted-keys.mjs";

/** Shown to users when an update cannot be proven to come from the release key. */
const UNVERIFIED_MESSAGE = "ThirdFlare One could not verify this update, so nothing was changed. Download the new version from the releases page instead.";

function cacheDir(env = process.env) {
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "thirdflare", "updates");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

/**
 * Resolve the AppImage path to replace.
 */
export function resolveAppImagePath(env = process.env) {
  if (env.THIRDFLARE_APPIMAGE_PATH && existsSync(env.THIRDFLARE_APPIMAGE_PATH)) {
    return env.THIRDFLARE_APPIMAGE_PATH;
  }
  if (env.APPIMAGE && existsSync(env.APPIMAGE)) {
    return env.APPIMAGE;
  }
  return null;
}

/**
 * Fetch a URL while re-validating every redirect hop against the GitHub allowlist.
 */
export async function fetchTrustedAsset(url, {
  fetchImpl = fetch,
  headers = { "user-agent": "ThirdFlare-One-Updater" },
  maxRedirects = 8
} = {}) {
  let current = String(url || "");
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isTrustedAssetUrl(current)) {
      const error = new Error(`Untrusted download URL (hop ${hop}): ${current}`);
      error.code = "UNTRUSTED_URL";
      throw error;
    }
    const response = await fetchImpl(current, { headers, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) {
        const error = new Error(`Redirect without Location (${response.status})`);
        error.code = "BAD_REDIRECT";
        throw error;
      }
      current = new URL(location, current).href;
      continue;
    }
    return response;
  }
  const error = new Error("Too many redirects while downloading update.");
  error.code = "TOO_MANY_REDIRECTS";
  throw error;
}

/**
 * Parse a SHA256SUMS (or similar) text body for an asset basename.
 */
export function parseSha256Sums(text, assetName) {
  const needle = basename(assetName);
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const listed = basename(match[2].trim());
    if (listed === needle) return match[1].toLowerCase();
  }
  return null;
}

async function resolveExpectedSha256(asset, {
  fetchImpl,
  releaseAssets,
  expectedSha256
}) {
  if (expectedSha256 && /^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    return expectedSha256.toLowerCase();
  }
  const sumsAsset = (releaseAssets || []).find((a) =>
    /SHA256SUMS/i.test(a.name) && isTrustedAssetUrl(a.url)
  );
  if (!sumsAsset) return null;
  const response = await fetchTrustedAsset(sumsAsset.url, { fetchImpl });
  if (!response.ok) return null;
  const text = await response.text();
  return parseSha256Sums(text, asset.name);
}

/** Locate the detached signature published beside an asset. */
export function findSignatureAsset(asset, releaseAssets = []) {
  const needle = signatureAssetName(basename(asset?.name || "")).toLowerCase();
  return (releaseAssets || []).find((candidate) =>
    basename(String(candidate?.name || "")).toLowerCase() === needle && isTrustedAssetUrl(candidate.url)
  ) || null;
}

async function fetchSignature(asset, { releaseAssets, fetchImpl, signature }) {
  if (signature) return signature;
  const sigAsset = findSignatureAsset(asset, releaseAssets);
  if (!sigAsset) {
    const error = new Error(`${UNVERIFIED_MESSAGE} (no ${signatureAssetName(basename(asset.name))} published with this release)`);
    error.code = "SIGNATURE_MISSING";
    throw error;
  }
  const response = await fetchTrustedAsset(sigAsset.url, { fetchImpl });
  if (!response.ok) {
    const error = new Error(`${UNVERIFIED_MESSAGE} (signature download failed: ${response.status})`);
    error.code = "SIGNATURE_UNAVAILABLE";
    throw error;
  }
  return await response.text();
}

/**
 * Download an AppImage asset and atomically replace the current binary.
 * Does not restart the process — caller should instruct the user to relaunch.
 *
 * The download is only installed once a detached Ed25519 signature from a pinned
 * release key verifies. A checksum alone never authorizes a replacement.
 */
export async function applyAppImageUpdate(asset, {
  env = process.env,
  fetchImpl = fetch,
  targetPath = null,
  releaseAssets = [],
  expectedSha256 = null,
  trustedKeys = trustedUpdateKeys(),
  signature = null
} = {}) {
  const target = targetPath || resolveAppImagePath(env);
  if (!target) {
    const error = new Error("No AppImage path detected. Set THIRDFLARE_APPIMAGE_PATH or run from an AppImage.");
    error.code = "NO_APPIMAGE";
    throw error;
  }

  if (!asset?.url || !asset?.name) {
    const error = new Error("Missing AppImage asset URL.");
    error.code = "NO_ASSET";
    throw error;
  }

  if (!/\.AppImage$/i.test(asset.name)) {
    const error = new Error(`Asset does not look like an AppImage: ${asset.name}`);
    error.code = "BAD_ASSET";
    throw error;
  }

  const dir = cacheDir(env);
  ensureDir(dir);
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpPath = join(dir, `${basename(asset.name)}.${unique}.partial`);
  const finalCache = join(dir, `${basename(asset.name)}.${unique}`);

  const response = await fetchTrustedAsset(asset.url, { fetchImpl });
  if (!response.ok || !response.body) {
    const error = new Error(`Download failed (${response.status})`);
    error.code = "DOWNLOAD_FAILED";
    throw error;
  }

  try {
    await pipeline(response.body, createWriteStream(tmpPath));
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw error;
  }

  const bytes = await readFile(tmpPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const discard = () => {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  };

  // Authenticity first: a checksum only proves the bytes arrived intact.
  let signatureText;
  try {
    signatureText = await fetchSignature(asset, { releaseAssets, fetchImpl, signature });
  } catch (error) {
    discard();
    throw error;
  }

  const verdict = verifyDetachedSignature({ data: bytes, signature: signatureText, keys: trustedKeys });
  if (!verdict.ok) {
    discard();
    const error = new Error(`${UNVERIFIED_MESSAGE} (${verdict.reason})`);
    error.code = "SIGNATURE_INVALID";
    error.reason = verdict.reason;
    throw error;
  }

  const expected = await resolveExpectedSha256(asset, {
    fetchImpl,
    releaseAssets,
    expectedSha256
  });
  if (expected && expected !== sha256) {
    discard();
    const error = new Error(`SHA256 mismatch for ${asset.name}: expected ${expected}, got ${sha256}`);
    error.code = "SHA256_MISMATCH";
    throw error;
  }

  renameSync(tmpPath, finalCache);
  chmodSync(finalCache, 0o755);

  const backup = `${target}.bak`;
  try {
    if (existsSync(target)) {
      copyFileSync(target, backup);
    }
    renameSync(finalCache, target);
    chmodSync(target, 0o755);
  } catch (error) {
    if (existsSync(backup)) {
      try { renameSync(backup, target); } catch { /* ignore */ }
    }
    throw error;
  }

  return {
    mode: "appimage",
    applied: true,
    path: target,
    backup,
    sha256,
    sha256Verified: Boolean(expected),
    signatureVerified: true,
    signatureKeyId: verdict.keyId,
    restartRequired: true
  };
}
