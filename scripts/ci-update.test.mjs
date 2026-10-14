import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compare, coerce, gt, lt, isPrerelease } from "../lib/update/semver.mjs";
import { buildManifest, parseManifest, pointerForChannel } from "../lib/update/manifest.mjs";
import { pickAsset, pickChannelRelease, findReleaseByTag, clearGithubCache } from "../lib/update/github.mjs";
import { detectInstallFormat, guidedCommands } from "../lib/update/detect-format.mjs";
import { applyAppImageUpdate, findSignatureAsset } from "../lib/update/apply-appimage.mjs";
import { decodeSignature, publicKeyFromBase64 } from "../lib/update/verify-signature.mjs";
import { trustedUpdateKeys } from "../lib/update/trusted-keys.mjs";
import { checkForUpdate } from "../lib/update/index.mjs";
import { getVersion } from "../lib/version.mjs";

test("semver coerce and compare", () => {
  assert.equal(coerce("v1.2.3"), "1.2.3");
  assert.equal(coerce("1.2.3-beta.1"), "1.2.3-beta.1");
  assert.equal(compare("1.2.0", "1.1.9"), 1);
  assert.ok(gt("1.2.0", "1.1.0"));
  assert.ok(lt("1.0.0", "1.0.1"));
  assert.ok(isPrerelease("1.0.0-beta.1"));
  assert.equal(isPrerelease("1.0.0"), false);
  assert.ok(gt("1.0.0", "1.0.0-beta.1"));
});

test("manifest channel pointers", () => {
  const manifest = buildManifest({ version: "1.2.0", tag: "v1.2.0", prerelease: false });
  assert.equal(manifest.stable.version, "1.2.0");
  assert.equal(pointerForChannel(manifest, "stable").tag, "v1.2.0");

  const withBeta = buildManifest({
    version: "1.3.0-beta.1",
    tag: "v1.3.0-beta.1",
    prerelease: true,
    previous: manifest
  });
  assert.equal(withBeta.stable.version, "1.2.0");
  assert.equal(withBeta.beta.version, "1.3.0-beta.1");
  assert.equal(pointerForChannel(withBeta, "beta").tag, "v1.3.0-beta.1");
});

test("parseManifest ignores bad input", () => {
  assert.equal(parseManifest(null).stable, null);
  assert.equal(parseManifest({ stable: { version: "nope" } }).stable, null);
});

test("pickChannelRelease prefers stable non-prerelease", () => {
  const releases = [
    { tag: "v1.2.0-beta.1", prerelease: true, draft: false, assets: [] },
    { tag: "v1.1.0", prerelease: false, draft: false, assets: [] }
  ];
  assert.equal(pickChannelRelease(releases, "stable").tag, "v1.1.0");
  assert.equal(pickChannelRelease(releases, "beta").tag, "v1.2.0-beta.1");
});

test("pickAsset matches naming conventions", () => {
  const release = {
    assets: [
      { name: "cloudflare-one-warp_1.2.0_all.deb", url: "https://github.com/o/r/releases/download/v1.2.0/cloudflare-one-warp_1.2.0_all.deb" },
      { name: "cloudflare-one-warp-1.2.0-x86_64.AppImage", url: "https://github.com/o/r/releases/download/v1.2.0/cloudflare-one-warp-1.2.0-x86_64.AppImage" }
    ]
  };
  assert.equal(pickAsset(release, "appimage", "x64").url, "https://github.com/o/r/releases/download/v1.2.0/cloudflare-one-warp-1.2.0-x86_64.AppImage");
  assert.equal(pickAsset(release, "deb").url, "https://github.com/o/r/releases/download/v1.2.0/cloudflare-one-warp_1.2.0_all.deb");
  assert.equal(findReleaseByTag([{ tag: "v1.2.0" }], "1.2.0").tag, "v1.2.0");
});

test("detectInstallFormat honors override and APPIMAGE", () => {
  assert.equal(detectInstallFormat({ CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "rpm" }), "rpm");
  assert.equal(detectInstallFormat({ APPIMAGE: "/tmp/x.AppImage" }), "appimage");
});

test("guidedCommands for deb include dpkg", () => {
  const cmds = guidedCommands("deb", {
    version: "1.2.0",
    tag: "v1.2.0",
    owner: "bodencrouch",
    repo: "cloudflare-one-warp"
  });
  assert.ok(cmds.some((c) => c.includes("dpkg -i")));
});

test("checkForUpdate with mocked GitHub", async () => {
  clearGithubCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("update-manifest.json")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schema: 1,
          stable: { version: "9.9.9", tag: "v9.9.9" },
          beta: null
        })
      };
    }
    if (href.includes("/releases")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ([
          {
            id: 1,
            tag_name: "v9.9.9",
            name: "9.9.9",
            prerelease: false,
            draft: false,
            published_at: "2026-01-01T00:00:00Z",
            body: "notes",
            html_url: "https://github.com/example/releases/tag/v9.9.9",
            assets: [
              {
                name: "cloudflare-one-warp-9.9.9-x86_64.AppImage",
                browser_download_url: "https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v9.9.9/cloudflare-one-warp-9.9.9-x86_64.AppImage",
                size: 10,
                content_type: "application/octet-stream"
              }
            ]
          }
        ])
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const result = await checkForUpdate(
      {
        updates: {
          channel: "stable",
          source: { owner: "bodencrouch", repo: "cloudflare-one-warp" }
        }
      },
      { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" } }
    );
    assert.equal(result.latest, "9.9.9");
    assert.equal(result.updateAvailable, gt("9.9.9", getVersion()));
    assert.equal(result.canApply, false);
    assert.equal(result.applyConfirmToken, null);
    assert.match(result.applyUnavailableReason, /signing key/i);
    assert.equal(result.recommendedAsset.url, "https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v9.9.9/cloudflare-one-warp-9.9.9-x86_64.AppImage");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkForUpdate empty releases is graceful", async () => {
  clearGithubCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("update-manifest.json")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (href.includes("/releases")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => []
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const result = await checkForUpdate(
      { updates: { channel: "stable", source: { owner: "nobody", repo: "empty" } } },
      { env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "deb" } }
    );
    assert.equal(result.updateAvailable, false);
    assert.equal(result.releasesError || result.errors?.releases || null, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const ASSET_NAME = "cloudflare-one-warp-1.0.0-x86_64.AppImage";
const ASSET_URL = `https://github.com/o/r/releases/download/v1.0.0/${ASSET_NAME}`;
const SIG_URL = `${ASSET_URL}.sig`;

/** Stand-in for the offline release key. */
function releaseKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    trusted: [{ id: "test-key", publicKey: Buffer.from(der.subarray(der.length - 32)).toString("base64") }]
  };
}

function signedRelease(payload, { privateKey, assetName = ASSET_NAME, assetUrl = ASSET_URL } = {}) {
  const signature = privateKey ? sign(null, payload, privateKey).toString("base64") : null;
  const releaseAssets = [{ name: assetName, url: assetUrl }];
  if (signature) releaseAssets.push({ name: `${assetName}.sig`, url: `${assetUrl}.sig` });
  const fetchImpl = async (url) => {
    if (String(url).endsWith(".sig")) {
      return { ok: true, status: 200, text: async () => `${signature}\n` };
    }
    return { ok: true, status: 200, body: Readable.from([payload]) };
  };
  return { releaseAssets, fetchImpl };
}

test("applyAppImageUpdate replaces target when the signature verifies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-upd-"));
  const target = join(dir, "Cloudflare-One-WARP.AppImage");
  writeFileSync(target, "old-binary");
  chmodSync(target, 0o755);

  const payload = Buffer.from("new-appimage-bytes");
  const { privateKey, trusted } = releaseKeypair();
  const { releaseAssets, fetchImpl } = signedRelease(payload, { privateKey });

  try {
    const result = await applyAppImageUpdate(
      { name: ASSET_NAME, url: ASSET_URL },
      {
        env: { XDG_CACHE_HOME: join(dir, "cache") },
        fetchImpl,
        targetPath: target,
        releaseAssets,
        trustedKeys: trusted
      }
    );
    assert.equal(result.applied, true);
    assert.equal(result.restartRequired, true);
    assert.equal(result.signatureVerified, true);
    assert.equal(result.signatureKeyId, "test-key");
    assert.equal(readFileSync(target, "utf8"), "new-appimage-bytes");
    assert.ok(existsSync(`${target}.bak`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyAppImageUpdate refuses a release with no signature asset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-nosig-"));
  const target = join(dir, "Cloudflare-One-WARP.AppImage");
  writeFileSync(target, "old-binary");

  const payload = Buffer.from("unsigned-bytes");
  const { trusted } = releaseKeypair();
  const { releaseAssets, fetchImpl } = signedRelease(payload, { privateKey: null });

  try {
    await assert.rejects(
      () => applyAppImageUpdate(
        { name: ASSET_NAME, url: ASSET_URL },
        {
          env: { XDG_CACHE_HOME: join(dir, "cache") },
          fetchImpl,
          targetPath: target,
          releaseAssets,
          trustedKeys: trusted
        }
      ),
      (error) => {
        assert.equal(error.code, "SIGNATURE_MISSING");
        assert.match(error.message, /could not verify/i);
        return true;
      }
    );
    assert.equal(readFileSync(target, "utf8"), "old-binary");
    assert.equal(existsSync(`${target}.bak`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyAppImageUpdate refuses a signature from an untrusted key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-badkey-"));
  const target = join(dir, "Cloudflare-One-WARP.AppImage");
  writeFileSync(target, "old-binary");

  const payload = Buffer.from("attacker-bytes");
  const attacker = releaseKeypair();
  const official = releaseKeypair();
  const { releaseAssets, fetchImpl } = signedRelease(payload, { privateKey: attacker.privateKey });

  try {
    await assert.rejects(
      () => applyAppImageUpdate(
        { name: ASSET_NAME, url: ASSET_URL },
        {
          env: { XDG_CACHE_HOME: join(dir, "cache") },
          fetchImpl,
          targetPath: target,
          releaseAssets,
          trustedKeys: official.trusted
        }
      ),
      (error) => {
        assert.equal(error.code, "SIGNATURE_INVALID");
        assert.equal(error.reason, "signature_mismatch");
        return true;
      }
    );
    assert.equal(readFileSync(target, "utf8"), "old-binary");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyAppImageUpdate refuses when bytes were swapped after signing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-swap-"));
  const target = join(dir, "Cloudflare-One-WARP.AppImage");
  writeFileSync(target, "old-binary");

  const signed = Buffer.from("signed-bytes");
  const { privateKey, trusted } = releaseKeypair();
  const signature = sign(null, signed, privateKey).toString("base64");
  const releaseAssets = [
    { name: ASSET_NAME, url: ASSET_URL },
    { name: `${ASSET_NAME}.sig`, url: SIG_URL }
  ];
  const fetchImpl = async (url) => {
    if (String(url).endsWith(".sig")) return { ok: true, status: 200, text: async () => signature };
    return { ok: true, status: 200, body: Readable.from([Buffer.from("tampered-bytes")]) };
  };

  try {
    await assert.rejects(
      () => applyAppImageUpdate(
        { name: ASSET_NAME, url: ASSET_URL },
        {
          env: { XDG_CACHE_HOME: join(dir, "cache") },
          fetchImpl,
          targetPath: target,
          releaseAssets,
          trustedKeys: trusted
        }
      ),
      /could not verify/i
    );
    assert.equal(readFileSync(target, "utf8"), "old-binary");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyAppImageUpdate fails closed when no keys are pinned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-nokeys-"));
  const target = join(dir, "Cloudflare-One-WARP.AppImage");
  writeFileSync(target, "old-binary");

  const payload = Buffer.from("bytes");
  const { privateKey } = releaseKeypair();
  const { releaseAssets, fetchImpl } = signedRelease(payload, { privateKey });

  try {
    await assert.rejects(
      () => applyAppImageUpdate(
        { name: ASSET_NAME, url: ASSET_URL },
        {
          env: { XDG_CACHE_HOME: join(dir, "cache") },
          fetchImpl,
          targetPath: target,
          releaseAssets,
          trustedKeys: []
        }
      ),
      (error) => {
        assert.equal(error.reason, "no_trusted_keys");
        return true;
      }
    );
    assert.equal(readFileSync(target, "utf8"), "old-binary");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the shipped key ring is the only trust anchor for updates", () => {
  const keys = trustedUpdateKeys();
  for (const entry of keys) {
    assert.ok(entry.id, "each trusted key needs an id");
    assert.doesNotThrow(() => publicKeyFromBase64(entry.publicKey), `key ${entry.id} must be a 32-byte Ed25519 key`);
  }
});

test("signature decoding rejects malformed sidecars", () => {
  assert.equal(decodeSignature(""), null);
  assert.equal(decodeSignature("not base64!!"), null);
  assert.equal(decodeSignature(Buffer.alloc(10).toString("base64")), null);
  assert.equal(decodeSignature(Buffer.alloc(64).toString("base64")).length, 64);
  assert.equal(decodeSignature(Buffer.alloc(64)).length, 64);
});

test("findSignatureAsset only accepts a GitHub-hosted sidecar", () => {
  assert.equal(
    findSignatureAsset({ name: ASSET_NAME }, [{ name: `${ASSET_NAME}.sig`, url: SIG_URL }]).url,
    SIG_URL
  );
  assert.equal(
    findSignatureAsset({ name: ASSET_NAME }, [{ name: `${ASSET_NAME}.sig`, url: "https://evil.example/x.sig" }]),
    null
  );
  assert.equal(findSignatureAsset({ name: ASSET_NAME }, [{ name: "other.sig", url: SIG_URL }]), null);
});

test("applyUpdate rejects client-supplied assetUrl", async () => {
  const { applyUpdate } = await import("../lib/update/index.mjs");
  const result = await applyUpdate(
    { updates: { channel: "stable", source: { owner: "bodencrouch", repo: "cloudflare-one-warp" } } },
    { assetUrl: "https://evil.example/x.AppImage", assetName: "cloudflare-one-warp.AppImage" },
    { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" } }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /not allowed/i);
});

test("applyUpdate requires confirmation token for AppImage", async () => {
  clearGithubCache();
  const originalFetch = globalThis.fetch;
  const assetUrl = "https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v9.9.9/cloudflare-one-warp-9.9.9-x86_64.AppImage";
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("update-manifest.json")) {
      return { ok: true, status: 200, json: async () => ({ schema: 1, stable: { version: "9.9.9", tag: "v9.9.9" }, beta: null }) };
    }
    if (href.includes("/releases")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ([{
          id: 1,
          tag_name: "v9.9.9",
          name: "9.9.9",
          prerelease: false,
          draft: false,
          published_at: "2026-01-01T00:00:00Z",
          body: "",
          html_url: "https://github.com/example/releases/tag/v9.9.9",
          assets: [{ name: "cloudflare-one-warp-9.9.9-x86_64.AppImage.sig", browser_download_url: `${assetUrl}.sig`, size: 88 }, {
            name: "cloudflare-one-warp-9.9.9-x86_64.AppImage",
            browser_download_url: assetUrl,
            size: 10,
            content_type: "application/octet-stream"
          }]
        }])
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const { applyUpdate, prepareApply, clearApplyConfirmTokens } = await import("../lib/update/index.mjs");
    clearApplyConfirmTokens();
    const denied = await applyUpdate(
      { updates: { channel: "stable", source: { owner: "bodencrouch", repo: "cloudflare-one-warp" } } },
      {},
      { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" }, bindHost: "127.0.0.1" }
    );
    assert.equal(denied.ok, false);
    assert.match(denied.error, /confirmation token/i);

    const prep = await prepareApply(
      { updates: { channel: "stable", source: { owner: "bodencrouch", repo: "cloudflare-one-warp" } } },
      {},
      { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" }, trustedKeys: releaseKeypair().trusted }
    );
    assert.ok(prep.applyConfirmToken);

    const remoteDenied = await applyUpdate(
      { updates: { channel: "stable", source: { owner: "bodencrouch", repo: "cloudflare-one-warp" } } },
      { confirmToken: prep.applyConfirmToken },
      { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" }, bindHost: "0.0.0.0" }
    );
    assert.equal(remoteDenied.ok, false);
    assert.match(remoteDenied.error, /loopback/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("applyUpdate refuses to install an older version", async () => {
  clearGithubCache();
  const originalFetch = globalThis.fetch;
  const assetUrl = "https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v0.0.1/cloudflare-one-warp-0.0.1-x86_64.AppImage";
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("update-manifest.json")) {
      return { ok: true, status: 200, json: async () => ({ schema: 1, stable: { version: "0.0.1", tag: "v0.0.1" }, beta: null }) };
    }
    if (href.includes("/releases")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ([{
          id: 1,
          tag_name: "v0.0.1",
          name: "0.0.1",
          prerelease: false,
          draft: false,
          published_at: "2020-01-01T00:00:00Z",
          body: "",
          html_url: "https://github.com/example/releases/tag/v0.0.1",
          assets: [
            { name: "cloudflare-one-warp-0.0.1-x86_64.AppImage", browser_download_url: assetUrl, size: 10, content_type: "application/octet-stream" },
            { name: "cloudflare-one-warp-0.0.1-x86_64.AppImage.sig", browser_download_url: `${assetUrl}.sig`, size: 88, content_type: "text/plain" }
          ]
        }])
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const { applyUpdate, prepareApply, clearApplyConfirmTokens } = await import("../lib/update/index.mjs");
    clearApplyConfirmTokens();
    const config = { updates: { channel: "stable", source: { owner: "bodencrouch", repo: "cloudflare-one-warp" } } };
    const prep = await prepareApply(config, {}, { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" }, trustedKeys: releaseKeypair().trusted });
    assert.equal(prep.signatureAvailable, true);

    const result = await applyUpdate(
      config,
      { confirmToken: prep.applyConfirmToken },
      { arch: "x64", env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "appimage" }, bindHost: "127.0.0.1" }
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /older than the version you have installed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session overrides reject raw updates.source via /session path", async () => {
  const { setSessionOverrides, clearSessionOverrides, getConfig, reloadConfig } = await import("../lib/config.mjs");
  clearSessionOverrides();
  reloadConfig();
  const before = getConfig().updates?.source;
  setSessionOverrides({
    updates: {
      source: { owner: "attacker", repo: "evil" },
      channel: "beta"
    }
  });
  const after = getConfig();
  assert.equal(after.updates.channel, "beta");
  assert.deepEqual(after.updates.source, before);
  clearSessionOverrides();
});

test("setSessionUpdateSource accepts explicit owner/repo", async () => {
  const { setSessionUpdateSource, clearSessionOverrides, getConfig, reloadConfig } = await import("../lib/config.mjs");
  clearSessionOverrides();
  reloadConfig();
  setSessionUpdateSource({ owner: "bodencrouch", repo: "cloudflare-one-warp" });
  assert.equal(getConfig().updates.source.repo, "cloudflare-one-warp");
  clearSessionOverrides();
});

test("parseSha256Sums and untrusted redirect hop", async () => {
  const { parseSha256Sums, fetchTrustedAsset } = await import("../lib/update/apply-appimage.mjs");
  const sums = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  cloudflare-one-warp-1.0.0-x86_64.AppImage\n";
  assert.equal(parseSha256Sums(sums, "cloudflare-one-warp-1.0.0-x86_64.AppImage"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  let hops = 0;
  const fetchImpl = async () => {
    hops += 1;
    return {
      status: 302,
      ok: false,
      headers: { get: () => "https://evil.example/payload" }
    };
  };
  await assert.rejects(
    () => fetchTrustedAsset("https://github.com/o/r/releases/download/v1/x.AppImage", { fetchImpl }),
    /Untrusted/
  );
  assert.equal(hops, 1);
});

test("applyUpdate returns guided mode for deb installs", async () => {
  clearGithubCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("update-manifest.json")) {
      return { ok: true, status: 200, json: async () => ({ schema: 1, stable: { version: "0.1.0", tag: "v0.1.0" }, beta: null }) };
    }
    if (href.includes("/releases")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ([{
          id: 1,
          tag_name: "v0.1.0",
          name: "0.1.0",
          prerelease: false,
          draft: false,
          published_at: "2026-01-01T00:00:00Z",
          body: "",
          html_url: "https://github.com/example/releases/tag/v0.1.0",
          assets: []
        }])
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const { applyUpdate } = await import("../lib/update/index.mjs");
    const result = await applyUpdate(
      { updates: { channel: "stable", source: { owner: "bodencrouch", repo: "cloudflare-one-warp" } } },
      {},
      { env: { CLOUDFLARE_ONE_WARP_INSTALL_FORMAT: "deb" } }
    );
    assert.equal(result.ok, true);
    assert.equal(result.mode, "guided");
    assert.equal(result.applied, false);
    assert.ok(result.commands.some((c) => c.includes("dpkg")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guidedCommands rejects unsafe owner", () => {
  const cmds = guidedCommands("deb", {
    version: "1.0.0",
    tag: "v1.0.0",
    owner: 'foo";rm -rf /;echo "',
    repo: "cloudflare-one-warp"
  });
  assert.ok(cmds[0].startsWith("# Invalid"));
});

test("isTrustedAssetUrl allowlists GitHub hosts only", async () => {
  const { isTrustedAssetUrl } = await import("../lib/update/github.mjs");
  assert.equal(isTrustedAssetUrl("https://objects.githubusercontent.com/foo"), true);
  assert.equal(isTrustedAssetUrl("https://evil.example/x.AppImage"), false);
  assert.equal(isTrustedAssetUrl("http://github.com/x"), false);
});

function updateFixture() {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-update-safe-"));
  const target = join(dir, "client.AppImage");
  writeFileSync(target, "old-binary");
  const payload = Buffer.from("verified-new-binary");
  const key = releaseKeypair();
  const release = signedRelease(payload, key);
  return { dir, target, payload, key, options: { targetPath: target, trustedKeys: key.trusted, ...release } };
}

test("verified AppImage replacement works when cache is on a different filesystem", async (t) => {
  if (!existsSync("/dev/shm") || statSync(tmpdir()).dev === statSync("/dev/shm").dev) {
    t.skip("Two writable filesystem mounts are needed for this regression");
    return;
  }
  const fixture = updateFixture();
  const cache = mkdtempSync("/dev/shm/cloudflare-one-warp-cache-");
  try {
    await applyAppImageUpdate({ name: ASSET_NAME, url: ASSET_URL }, {
      ...fixture.options, env: { XDG_CACHE_HOME: cache }
    });
    assert.equal(readFileSync(fixture.target, "utf8"), fixture.payload.toString());
    assert.equal(readFileSync(`${fixture.target}.bak`, "utf8"), "old-binary");
    assert.deepEqual(readdirSync(cache), []);
    assert.deepEqual(readdirSync(fixture.dir).sort(), ["client.AppImage", "client.AppImage.bak"]);
  } finally {
    rmSync(cache, { recursive: true, force: true });
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("AppImage updates serialize downloads and replacements", async () => {
  const fixture = updateFixture();
  let started = 0;
  let unblock;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  const fetchImpl = async (url) => {
    if (!String(url).endsWith(".sig")) {
      started++;
      if (started === 1) await blocked;
    }
    return fixture.options.fetchImpl(url);
  };
  try {
    const first = applyAppImageUpdate({ name: ASSET_NAME, url: ASSET_URL }, { ...fixture.options, fetchImpl });
    const second = applyAppImageUpdate({ name: ASSET_NAME, url: ASSET_URL }, { ...fixture.options, fetchImpl });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, 1);
    unblock();
    await Promise.all([first, second]);
    assert.equal(started, 2);
    assert.equal(readFileSync(`${fixture.target}.bak`, "utf8"), fixture.payload.toString());
  } finally {
    unblock();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("oversize AppImage stream is stopped without replacing target or leaving staging", async () => {
  const fixture = updateFixture();
  try {
    await assert.rejects(applyAppImageUpdate({ name: ASSET_NAME, url: ASSET_URL }, {
      ...fixture.options, maxBytes: 5
    }), { code: "DOWNLOAD_TOO_LARGE" });
    assert.equal(readFileSync(fixture.target, "utf8"), "old-binary");
    assert.deepEqual(readdirSync(fixture.dir), ["client.AppImage"]);
  } finally { rmSync(fixture.dir, { recursive: true, force: true }); }
});

test("stalled AppImage body times out and removes staging", async () => {
  const fixture = updateFixture();
  const fetchImpl = async (url) => String(url).endsWith(".sig")
    ? fixture.options.fetchImpl(url)
    : { ok: true, status: 200, body: new Readable({ read() {} }) };
  // AbortSignal.timeout is unref'd; keep the synthetic no-I/O stream test alive.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(applyAppImageUpdate({ name: ASSET_NAME, url: ASSET_URL }, {
      ...fixture.options, fetchImpl, timeoutMs: 30
    }), { name: "AbortError" });
    assert.equal(readFileSync(fixture.target, "utf8"), "old-binary");
    assert.deepEqual(readdirSync(fixture.dir), ["client.AppImage"]);
  } finally {
    clearInterval(keepAlive);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("checksum network failure leaves installed AppImage and no temporary files", async () => {
  const fixture = updateFixture();
  const fetchImpl = async (url) => {
    if (String(url).endsWith("SHA256SUMS")) throw new Error("checksum network failure");
    return fixture.options.fetchImpl(url);
  };
  try {
    await assert.rejects(applyAppImageUpdate({ name: ASSET_NAME, url: ASSET_URL }, {
      ...fixture.options, fetchImpl,
      releaseAssets: [...fixture.options.releaseAssets, { name: "SHA256SUMS", url: "https://github.com/o/r/releases/download/v1/SHA256SUMS" }]
    }), /checksum network failure/);
    assert.equal(readFileSync(fixture.target, "utf8"), "old-binary");
    assert.deepEqual(readdirSync(fixture.dir), ["client.AppImage"]);
  } finally { rmSync(fixture.dir, { recursive: true, force: true }); }
});

test("asset selection cannot recommend an incompatible AppImage architecture", () => {
  const release = { assets: [
    { name: ASSET_NAME, url: ASSET_URL },
    { name: "cloudflare-one-warp-1.0.0-aarch64.AppImage", url: "https://github.com/o/r/releases/download/v1/arm.AppImage" }
  ] };
  assert.equal(pickAsset(release, "appimage", "arm64").name, "cloudflare-one-warp-1.0.0-aarch64.AppImage");
  assert.equal(pickAsset({ assets: [release.assets[0]] }, "appimage", "arm64"), null);
});

test("direct bundle upgrade guidance uses release artifacts rather than unpublished stores", () => {
  const release = { owner: "bodencrouch", repo: "cloudflare-one-warp", version: "1.0.0", tag: "v1.0.0" };
  assert.match(guidedCommands("flatpak", release).join("\n"), /cloudflare-one-warp-1\.0\.0-x86_64\.flatpak/);
  assert.doesNotMatch(guidedCommands("flatpak", release).join("\n"), /install flathub/);
  assert.match(guidedCommands("snap", release).join("\n"), /refresh --dangerous --classic .*1\.0\.0_amd64\.snap/);
  assert.match(guidedCommands("arch", release).join("\n"), /pacman -U/);
});

test("update JSON metadata rejects an oversize body", async () => {
  const { readUpdateJson } = await import("../lib/update/network.mjs");
  await assert.rejects(readUpdateJson(new Response("x".repeat(128)), { maxBytes: 32 }), /size limit/);
});

function selectionHarness(prepare) {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function selectUpdateRelease(tag) {");
  const end = source.indexOf("async function applySelectedUpdate()", start);
  const state = { update: {
    selectedOwner: "bodencrouch", selectedRepo: "cloudflare-one-warp", selectedTag: "",
    result: { current: "1.0.0", canApply: true, applyConfirmToken: "old-token", guidedCommands: ["old command"] },
    releases: [
      { tag: "v2.0.0", htmlUrl: "https://github.com/bodencrouch/cloudflare-one-warp/releases/tag/v2.0.0" },
      { tag: "v3.0.0", htmlUrl: "https://github.com/bodencrouch/cloudflare-one-warp/releases/tag/v3.0.0" }
    ]
  } };
  let checks = 0;
  const select = runInNewContext(`${source.slice(start, end)}; selectUpdateRelease;`, {
    state, render() {}, compareLooseSemver: compare,
    async runUpdateCheck() { checks++; },
    async apiFetch(url, options) {
      assert.equal(url, "/api/update/prepare");
      return { json: () => prepare(JSON.parse(options.body).tag) };
    }
  });
  return { state, select, checkCount: () => checks };
}

test("release picker removes Apply eligibility for unsigned or untrusted selected release", async () => {
  const { state, select } = selectionHarness(async () => ({ ok: false, error: "No trusted release signing key" }));
  const pending = select("v2.0.0");
  assert.equal(state.update.result.canApply, false);
  assert.equal(state.update.confirmToken, null);
  assert.equal(state.update.result.guidedCommands.length, 0);
  await pending;
  assert.equal(state.update.result.canApply, false);
  assert.match(state.update.result.applyUnavailableReason, /signing key/);
  assert.equal(state.update.result.release.tag, "v2.0.0");
});

test("release picker uses selected release's guided commands instead of cached channel commands", async () => {
  const { state, select } = selectionHarness(async (tag) => ({ ok: true, mode: "guided", commands: [`install ${tag}`] }));
  await select("v3.0.0");
  assert.equal(state.update.result.canApply, false);
  assert.equal(state.update.result.guidedCommands.join("\n"), "install v3.0.0");
});

test("late release picker response cannot authorize a newer selection", async () => {
  let unblock;
  const delayed = new Promise((resolve) => { unblock = resolve; });
  const { state, select } = selectionHarness(async (tag) => {
    if (tag === "v2.0.0") await delayed;
    return tag === "v2.0.0"
      ? { ok: true, mode: "appimage", applyConfirmToken: "signed-v2-token" }
      : { ok: false, error: "v3 is unsigned" };
  });
  const first = select("v2.0.0");
  await select("v3.0.0");
  unblock();
  await first;
  assert.equal(state.update.result.release.tag, "v3.0.0");
  assert.equal(state.update.result.canApply, false);
  assert.equal(state.update.confirmToken, null);
});

test("choosing channel default rechecks channel and removes selected release credentials", async () => {
  const { state, select, checkCount } = selectionHarness(async () => ({ ok: true }));
  await select("");
  assert.equal(checkCount(), 1);
  assert.equal(state.update.result.canApply, false);
  assert.equal(state.update.result.applyConfirmToken, null);
});

test("source upgrade guidance works from a copied install and unrelated working directory", (t) => {
  if (process.platform === "win32") { t.skip("POSIX source installer"); return; }
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-source-guide-"));
  const bin = join(dir, "bin");
  const capture = join(dir, "install-args");
  mkdirSync(bin);
  const gitStub = `#!/usr/bin/env bash
set -eu
for arg in "$@"; do target="$arg"; done
mkdir -p "$target/scripts"
cat > "$target/scripts/install-local.sh" <<'INSTALL'
#!/usr/bin/env bash
printf '%s\\n' "$@" > "$UPDATE_CAPTURE"
INSTALL
`;
  writeFileSync(join(bin, "git"), gitStub, { mode: 0o755 });
  writeFileSync(join(bin, "npm"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  try {
    const commands = guidedCommands("source", { version: "2.0.0", tag: "v2.0.0", owner: "bodencrouch", repo: "cloudflare-one-warp" });
    execFileSync("bash", ["-eu", "-c", commands.join("\n")], {
      cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, UPDATE_CAPTURE: capture }
    });
    const args = readFileSync(capture, "utf8").trim().split("\n");
    assert.equal(args[0], "--install-dir");
    assert.equal(args[1], fileURLToPath(new URL("../", import.meta.url)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("release picker only offers Apply after selected release prepare supplies a token", async () => {
  const { state, select } = selectionHarness(async () => ({
    ok: true, mode: "appimage", applyConfirmToken: "selected-release-token", recommendedAsset: { name: ASSET_NAME }
  }));
  await select("v2.0.0");
  assert.equal(state.update.result.canApply, true);
  assert.equal(state.update.confirmToken, "selected-release-token");
  assert.equal(state.update.result.recommendedAsset.name, ASSET_NAME);
});
