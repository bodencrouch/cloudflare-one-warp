import { createWriteStream, existsSync, mkdtempSync, renameSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, basename, dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { isTrustedAssetUrl } from "./github.mjs";
import { signatureAssetName, verifyDetachedSignature } from "./verify-signature.mjs";
import { trustedUpdateKeys } from "./trusted-keys.mjs";

/** Shown to users when an update cannot be proven to come from the release key. */
const UNVERIFIED_MESSAGE = "Cloudflare One WARP could not verify this update, so nothing was changed. Download the new version from the releases page instead.";

const MAX_ASSET_BYTES = 512 * 1024 * 1024;
let applyQueue = Promise.resolve();

function sizeLimiter(maxBytes) {
  let total = 0;
  return new Transform({ transform(chunk, encoding, callback) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("Update download exceeds the size limit.");
      error.code = "DOWNLOAD_TOO_LARGE";
      callback(error);
    } else callback(null, chunk);
  } });
}

async function boundedText(response, maxBytes, signal, binary = false) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Update metadata exceeds the size limit.");
    return text;
  }
  const chunks = [];
  const sink = new Transform({ transform(chunk, encoding, callback) {
    chunks.push(Buffer.from(chunk));
    callback();
  } });
  await pipeline(response.body, sizeLimiter(maxBytes), sink, { signal });
  const bytes = Buffer.concat(chunks);
  return binary ? bytes : bytes.toString("utf8");
}

/**
 * Resolve the AppImage path to replace.
 */
export function resolveAppImagePath(env = process.env) {
  if (env.CLOUDFLARE_ONE_WARP_APPIMAGE_PATH && existsSync(env.CLOUDFLARE_ONE_WARP_APPIMAGE_PATH)) {
    return env.CLOUDFLARE_ONE_WARP_APPIMAGE_PATH;
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
  headers = { "user-agent": "Cloudflare-One-WARP-Updater" },
  maxRedirects = 8,
  signal = AbortSignal.timeout(30_000)
} = {}) {
  let current = String(url || "");
  let requestHeaders = new Headers(headers);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isTrustedAssetUrl(current)) {
      const error = new Error(`Untrusted download URL (hop ${hop}): ${current}`);
      error.code = "UNTRUSTED_URL";
      throw error;
    }
    const response = await fetchImpl(current, { headers: requestHeaders, redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) {
        const error = new Error(`Redirect without Location (${response.status})`);
        error.code = "BAD_REDIRECT";
        throw error;
      }
      await response.body?.cancel?.();
      const next = new URL(location, current);
      if (next.origin !== new URL(current).origin) {
        requestHeaders.delete("authorization");
        requestHeaders.delete("cookie");
        requestHeaders.delete("proxy-authorization");
      }
      current = next.href;
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
  expectedSha256,
  signal
}) {
  if (expectedSha256 && /^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    return expectedSha256.toLowerCase();
  }
  const sumsAsset = (releaseAssets || []).find((a) =>
    /SHA256SUMS/i.test(a.name) && isTrustedAssetUrl(a.url)
  );
  if (!sumsAsset) return null;
  const response = await fetchTrustedAsset(sumsAsset.url, { fetchImpl, signal });
  if (!response.ok) {
    await response.body?.cancel?.();
    return null;
  }
  const text = await boundedText(response, 1024 * 1024, signal);
  return parseSha256Sums(text, asset.name);
}

/** Locate the detached signature published beside an asset. */
export function findSignatureAsset(asset, releaseAssets = []) {
  const needle = signatureAssetName(basename(asset?.name || "")).toLowerCase();
  return (releaseAssets || []).find((candidate) =>
    basename(String(candidate?.name || "")).toLowerCase() === needle && isTrustedAssetUrl(candidate.url)
  ) || null;
}

async function fetchSignature(asset, { releaseAssets, fetchImpl, signature, signal }) {
  if (signature) return signature;
  const sigAsset = findSignatureAsset(asset, releaseAssets);
  if (!sigAsset) {
    const error = new Error(`${UNVERIFIED_MESSAGE} (no ${signatureAssetName(basename(asset.name))} published with this release)`);
    error.code = "SIGNATURE_MISSING";
    throw error;
  }
  const response = await fetchTrustedAsset(sigAsset.url, { fetchImpl, signal });
  if (!response.ok) {
    await response.body?.cancel?.();
    const error = new Error(`${UNVERIFIED_MESSAGE} (signature download failed: ${response.status})`);
    error.code = "SIGNATURE_UNAVAILABLE";
    throw error;
  }
  return await boundedText(response, 4096, signal, true);
}

/**
 * Download an AppImage asset and atomically replace the current binary.
 * Does not restart the process — caller should instruct the user to relaunch.
 *
 * The download is only installed once a detached Ed25519 signature from a pinned
 * release key verifies. A checksum alone never authorizes a replacement.
 */
export function applyAppImageUpdate(asset, options = {}) {
  const pending = applyQueue.then(() => performAppImageUpdate(asset, options));
  applyQueue = pending.catch(() => {});
  return pending;
}

async function performAppImageUpdate(asset, {
  env = process.env,
  fetchImpl = fetch,
  targetPath = null,
  releaseAssets = [],
  expectedSha256 = null,
  trustedKeys = trustedUpdateKeys(),
  signature = null,
  timeoutMs = 180_000,
  maxBytes = MAX_ASSET_BYTES
} = {}) {
  const target = targetPath || resolveAppImagePath(env);
  if (!target) {
    const error = new Error("No AppImage path detected. Set CLOUDFLARE_ONE_WARP_APPIMAGE_PATH or run from an AppImage.");
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

  if (!trustedKeys.length) {
    const error = new Error(`${UNVERIFIED_MESSAGE} (no_trusted_keys)`);
    error.code = "SIGNATURE_INVALID";
    error.reason = "no_trusted_keys";
    throw error;
  }

  const signal = AbortSignal.timeout(timeoutMs);
  const limit = Math.min(maxBytes, MAX_ASSET_BYTES);
  // Staging beside the target ensures rename stays on its filesystem, even when
  // the user's cache is on a different mount. Private, exclusive staging also
  // prevents another process from replacing the file between verification/apply.
  const dir = mkdtempSync(join(dirname(resolve(target)), ".cloudflare-one-warp-update-"));
  const tmpPath = join(dir, "update.AppImage");
  const backup = `${target}.bak`;
  let sha256, expected, verdict;
  try {
    const signatureText = await fetchSignature(asset, { releaseAssets, fetchImpl, signature, signal });
    const response = await fetchTrustedAsset(asset.url, { fetchImpl, signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel?.();
      const error = new Error(`Download failed (${response.status})`);
      error.code = "DOWNLOAD_FAILED";
      throw error;
    }
    await pipeline(response.body, sizeLimiter(limit), createWriteStream(tmpPath, { flags: "wx", mode: 0o600 }), { signal });
    const bytes = await readFile(tmpPath);
    sha256 = createHash("sha256").update(bytes).digest("hex");
    verdict = verifyDetachedSignature({ data: bytes, signature: signatureText, keys: trustedKeys });
    if (!verdict.ok) {
      const error = new Error(`${UNVERIFIED_MESSAGE} (${verdict.reason})`);
      error.code = "SIGNATURE_INVALID";
      error.reason = verdict.reason;
      throw error;
    }
    expected = await resolveExpectedSha256(asset, { fetchImpl, releaseAssets, expectedSha256, signal });
    if (expected && expected !== sha256) {
      const error = new Error(`SHA256 mismatch for ${asset.name}: expected ${expected}, got ${sha256}`);
      error.code = "SHA256_MISMATCH";
      throw error;
    }
    chmodSync(tmpPath, 0o755);
    if (existsSync(target)) {
      // Finish the backup first; an interrupted copy never overwrites an existing
      // rollback image, and the installed binary stays untouched until rename.
      const backupTmp = join(dir, "backup.AppImage");
      copyFileSync(target, backupTmp);
      renameSync(backupTmp, backup);
    }
    renameSync(tmpPath, target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
