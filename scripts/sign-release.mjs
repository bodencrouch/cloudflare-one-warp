#!/usr/bin/env node
/**
 * Release signing helper for ThirdFlare One AppImages.
 *
 * Uses Node's built-in crypto only — no extra dependencies, so it runs anywhere
 * the repo does. See docs/UPDATES.md for the full release procedure.
 *
 *   node scripts/sign-release.mjs keygen --out ~/.thirdflare-signing/release.pem
 *   node scripts/sign-release.mjs sign --key ~/.thirdflare-signing/release.pem dist/*.AppImage
 *   node scripts/sign-release.mjs verify --key-b64 <base64> dist/x.AppImage
 *   node scripts/sign-release.mjs verify dist/x.AppImage          # against pinned keys
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBuffer
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { signatureAssetName, verifyDetachedSignature } from "../lib/update/verify-signature.mjs";
import { trustedUpdateKeys } from "../lib/update/trusted-keys.mjs";

const USAGE = `Usage:
  sign-release keygen --out <private-key.pem>
  sign-release sign --key <private-key.pem> <file...>
  sign-release verify [--key-b64 <base64>] <file...>
`;

function parseArgs(argv) {
  const options = {};
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" || arg === "--key" || arg === "--key-b64") {
      options[arg.replace(/^--/, "")] = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  return { options, files };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** base64 of the raw 32-byte public key — the form pinned in trusted-keys.mjs. */
function rawPublicKeyBase64(key) {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

function keygen(options) {
  const out = options.out;
  if (!out) fail("keygen needs --out <private-key.pem>");
  if (existsSync(out)) fail(`Refusing to overwrite existing key: ${out}`);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  chmodSync(out, 0o600);

  console.log(`Private key written to ${out} (mode 0600). Keep it offline and back it up.`);
  console.log("");
  console.log("Add this entry to lib/update/trusted-keys.mjs:");
  console.log("");
  console.log(`  { id: "release-${new Date().getFullYear()}", publicKey: "${rawPublicKeyBase64(publicKey)}", since: "${new Date().toISOString().slice(0, 10)}" }`);
}

function sign(options, files) {
  if (!options.key) fail("sign needs --key <private-key.pem>");
  if (!files.length) fail("sign needs at least one file");
  const privateKey = createPrivateKey(readFileSync(options.key));

  for (const file of files) {
    const bytes = readFileSync(file);
    const signature = signBuffer(null, bytes, privateKey);
    const sidecar = signatureAssetName(file);
    writeFileSync(sidecar, `${signature.toString("base64")}\n`);
    console.log(`${sidecar}  (${signature.length} bytes, key ${rawPublicKeyBase64(privateKey)})`);
  }
}

function verify(options, files) {
  if (!files.length) fail("verify needs at least one file");
  const keys = options["key-b64"]
    ? [{ id: "cli", publicKey: options["key-b64"] }]
    : trustedUpdateKeys();
  if (!keys.length) {
    fail("No trusted keys available. Pass --key-b64 <base64> or pin a key in lib/update/trusted-keys.mjs.");
  }

  let failures = 0;
  for (const file of files) {
    const sidecar = signatureAssetName(file);
    if (!existsSync(sidecar)) {
      console.error(`MISSING  ${sidecar}`);
      failures += 1;
      continue;
    }
    const verdict = verifyDetachedSignature({
      data: readFileSync(file),
      signature: readFileSync(sidecar, "utf8"),
      keys
    });
    if (verdict.ok) {
      console.log(`OK       ${file} (key ${verdict.keyId})`);
    } else {
      console.error(`BAD      ${file} (${verdict.reason})`);
      failures += 1;
    }
  }
  if (failures) process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const { options, files } = parseArgs(rest);

switch (command) {
  case "keygen":
    keygen(options);
    break;
  case "sign":
    sign(options, files);
    break;
  case "verify":
    verify(options, files);
    break;
  default:
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}
