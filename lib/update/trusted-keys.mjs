/**
 * Release signing keys ThirdFlare One trusts for self-updates.
 *
 * Each entry is the base64 of a raw 32-byte Ed25519 **public** key. Private keys
 * never live in this repository — see docs/UPDATES.md for the signing procedure.
 *
 * Rotation: add the new key alongside the old one and ship that change as a
 * normal release. Because the key ring only reaches users through an update that
 * the *current* keys already signed, trust always chains from a key users have.
 * Remove the retired key one release later.
 *
 * An empty ring means AppImage self-update fails closed: nothing is trusted, so
 * nothing replaces the installed binary.
 */

/** @type {Array<{ id: string, publicKey: string, since: string, note?: string }>} */
export const TRUSTED_UPDATE_KEYS = [];

export function trustedUpdateKeys() {
  return TRUSTED_UPDATE_KEYS.filter((entry) => typeof entry.publicKey === "string" && entry.publicKey.length > 0);
}
