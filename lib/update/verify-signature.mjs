/**
 * Detached Ed25519 signature checking for downloaded release assets.
 *
 * Format (also documented in docs/UPDATES.md):
 * - The signature covers the **raw bytes** of the asset.
 * - It ships beside the asset as `<asset name>.sig`.
 * - The sidecar holds the 64-byte signature as base64 text; raw binary is also read.
 * - Trusted public keys are base64 of the raw 32-byte Ed25519 key.
 */

import { createPublicKey, verify } from "node:crypto";
import { trustedUpdateKeys } from "./trusted-keys.mjs";

const SIGNATURE_BYTES = 64;
const PUBLIC_KEY_BYTES = 32;
/** DER prefix for an Ed25519 SubjectPublicKeyInfo, so raw keys can be imported. */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Name of the sidecar asset for a given asset name. */
export function signatureAssetName(assetName) {
  return `${assetName}.sig`;
}

/** @param {string | Buffer} input base64 text or raw signature bytes */
export function decodeSignature(input) {
  if (Buffer.isBuffer(input) && input.length === SIGNATURE_BYTES) return input;
  const text = String(input || "").trim();
  if (!text) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) return null;
  const decoded = Buffer.from(text.replace(/\s+/g, ""), "base64");
  return decoded.length === SIGNATURE_BYTES ? decoded : null;
}

/** @param {string} value base64 of a raw 32-byte Ed25519 public key */
export function publicKeyFromBase64(value) {
  const raw = Buffer.from(String(value || "").replace(/\s+/g, ""), "base64");
  if (raw.length !== PUBLIC_KEY_BYTES) {
    const error = new Error("Ed25519 public keys must be 32 bytes.");
    error.code = "BAD_PUBLIC_KEY";
    throw error;
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: "der",
    type: "spki"
  });
}

/**
 * Verify `data` against `signature` using any of the trusted keys.
 *
 * @param {{ data: Buffer, signature: string | Buffer, keys?: Array<{ id: string, publicKey: string }> }} input
 * @returns {{ ok: boolean, keyId: string | null, reason: string | null }}
 */
export function verifyDetachedSignature({ data, signature, keys = trustedUpdateKeys() }) {
  if (!keys.length) return { ok: false, keyId: null, reason: "no_trusted_keys" };

  const decoded = decodeSignature(signature);
  if (!decoded) return { ok: false, keyId: null, reason: "malformed_signature" };

  for (const entry of keys) {
    let key;
    try {
      key = publicKeyFromBase64(entry.publicKey);
    } catch {
      continue;
    }
    if (verify(null, data, key, decoded)) {
      return { ok: true, keyId: entry.id || null, reason: null };
    }
  }
  return { ok: false, keyId: null, reason: "signature_mismatch" };
}
