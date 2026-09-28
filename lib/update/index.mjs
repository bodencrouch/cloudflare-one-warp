import { getVersion } from "../version.mjs";
import { coerce, gt, lt } from "./semver.mjs";
import {
  fetchRemoteManifest,
  pointerForChannel,
  readLocalManifest
} from "./manifest.mjs";
import {
  findReleaseByTag,
  listReleases,
  pickAsset,
  pickChannelRelease,
  isTrustedAssetUrl
} from "./github.mjs";
import { detectInstallFormat, guidedCommands, isSafeGithubRef } from "./detect-format.mjs";
import { applyAppImageUpdate, findSignatureAsset } from "./apply-appimage.mjs";
import {
  consumeApplyConfirmToken,
  issueApplyConfirmToken,
  isLoopbackBind
} from "./confirm.mjs";

const VERIFICATION_FAILURES = new Set([
  "SIGNATURE_MISSING",
  "SIGNATURE_UNAVAILABLE",
  "SIGNATURE_INVALID",
  "SHA256_MISMATCH"
]);

function normalizeSource(config) {
  const owner = config.updates?.source?.owner || "bodencrouch";
  const repo = config.updates?.source?.repo || "thirdflare-one";
  if (!isSafeGithubRef(owner) || !isSafeGithubRef(repo)) {
    const error = new Error("Invalid updates.source owner/repo.");
    error.code = "BAD_SOURCE";
    throw error;
  }
  return { owner, repo };
}

function maybeIssueToken(source, release, asset) {
  if (!release?.tag || !asset?.url) return null;
  return issueApplyConfirmToken({
    owner: source.owner,
    repo: source.repo,
    tag: release.tag,
    assetUrl: asset.url
  });
}

/**
 * Check for updates against manifest + GitHub Releases.
 */
export async function checkForUpdate(config, options = {}) {
  const source = normalizeSource(config);
  const channel = config.updates?.channel || "stable";
  const current = getVersion();
  const format = detectInstallFormat(options.env || process.env);

  let manifest = null;
  let manifestError = null;
  try {
    manifest = await fetchRemoteManifest(source, options);
  } catch (error) {
    manifestError = error.message;
  }
  if (!manifest) manifest = readLocalManifest();

  const pointer = pointerForChannel(manifest, channel);
  let releases = [];
  let releaseError = null;
  try {
    releases = await listReleases(source, options);
  } catch (error) {
    releaseError = error.message;
  }

  let release = null;
  let pointerMatched = false;
  if (pointer?.tag) {
    release = findReleaseByTag(releases, pointer.tag);
    pointerMatched = Boolean(release);
  }
  if (!release) {
    release = pickChannelRelease(releases, channel);
  }

  // Never advertise a manifest version that doesn't match the resolved release.
  const latestVersion = pointerMatched
    ? (coerce(pointer.version) || coerce(release?.tag))
    : (coerce(release?.tag) || null);

  const updateAvailable = Boolean(latestVersion && gt(latestVersion, current));
  const downgrade = Boolean(latestVersion && lt(latestVersion, current));
  const asset = release ? pickAsset(release, format === "source" ? "appimage" : format) : null;
  const issueToken = options.issueToken !== false;
  const applyConfirmToken = issueToken && format === "appimage"
    ? maybeIssueToken(source, release, asset)
    : null;

  return {
    ok: true,
    updateAvailable,
    downgrade,
    current,
    latest: latestVersion,
    channel,
    source,
    installFormat: format,
    applyConfirmToken,
    release: release
      ? {
          tag: release.tag,
          name: release.name,
          prerelease: release.prerelease,
          publishedAt: release.publishedAt,
          htmlUrl: release.htmlUrl,
          body: release.body
        }
      : null,
    assets: release?.assets || [],
    recommendedAsset: asset,
    guidedCommands: latestVersion
      ? guidedCommands(format, {
          version: latestVersion,
          tag: release?.tag || (pointerMatched ? pointer?.tag : null),
          owner: source.owner,
          repo: source.repo
        })
      : [],
    errors: {
      manifest: manifestError,
      releases: releaseError,
      pointerMismatch: pointer?.tag && !pointerMatched
        ? `Manifest tag ${pointer.tag} not found in release list; using channel fallback.`
        : null
    }
  };
}

/**
 * Resolve a release/asset and issue a one-time apply token (for UI tag picker).
 */
export async function prepareApply(config, body = {}, options = {}) {
  if (body?.assetUrl || body?.assetName) {
    return {
      ok: false,
      error: "Client-supplied asset URLs are not allowed. Select a release tag instead."
    };
  }

  const check = await checkForUpdate(config, { ...options, issueToken: false });
  const format = check.installFormat;
  let release = check.release;
  // checkForUpdate trims the release object, so the asset list lives alongside it.
  let releaseAssets = check.assets || [];
  let asset = check.recommendedAsset;

  if (body.tag) {
    const releases = await listReleases(check.source, options);
    release = findReleaseByTag(releases, body.tag);
    if (!release) {
      return { ok: false, error: `Release tag not found: ${body.tag}` };
    }
    releaseAssets = release.assets || [];
    asset = pickAsset(release, format === "source" ? "appimage" : format);
  }

  if (format !== "appimage") {
    return {
      ok: true,
      mode: "guided",
      format,
      applyConfirmToken: null,
      release,
      recommendedAsset: asset,
      commands: guidedCommands(format, {
        version: coerce(release?.tag) || check.latest,
        tag: release?.tag,
        owner: check.source.owner,
        repo: check.source.repo
      })
    };
  }

  if (!asset || !isTrustedAssetUrl(asset.url)) {
    return {
      ok: false,
      error: asset ? "Release asset URL is not from a trusted GitHub host." : "No AppImage asset found for the selected release.",
      release
    };
  }

  const applyConfirmToken = issueApplyConfirmToken({
    owner: check.source.owner,
    repo: check.source.repo,
    tag: release.tag,
    assetUrl: asset.url
  });

  return {
    ok: true,
    mode: "appimage",
    applyConfirmToken,
    release,
    recommendedAsset: asset,
    signatureAvailable: Boolean(findSignatureAsset(asset, releaseAssets)),
    source: check.source
  };
}

export async function applyUpdate(config, body = {}, options = {}) {
  if (body?.assetUrl || body?.assetName) {
    return {
      ok: false,
      error: "Client-supplied asset URLs are not allowed. Select a release tag instead."
    };
  }

  const env = options.env || process.env;
  const bindHost = options.bindHost;
  const allowRemoteApply = env.THIRDFLARE_ALLOW_REMOTE_APPLY === "1";

  const check = await checkForUpdate(config, { ...options, issueToken: false });
  const format = check.installFormat;
  let release = check.release;
  let releaseAssets = check.assets || [];
  let asset = check.recommendedAsset;

  if (body.tag) {
    const releases = await listReleases(check.source, options);
    release = findReleaseByTag(releases, body.tag);
    if (!release) {
      return {
        ok: false,
        error: `Release tag not found: ${body.tag}`
      };
    }
    releaseAssets = release.assets || [];
    asset = pickAsset(release, format === "source" ? "appimage" : format);
  }

  if (format !== "appimage") {
    return {
      ok: true,
      mode: "guided",
      applied: false,
      format,
      commands: guidedCommands(format, {
        version: coerce(release?.tag) || check.latest,
        tag: release?.tag,
        owner: check.source.owner,
        repo: check.source.repo
      }),
      restartRequired: false,
      message: `Automatic apply is only supported for AppImage installs (detected: ${format}).`
    };
  }

  if (!allowRemoteApply && bindHost != null && !isLoopbackBind(bindHost)) {
    return {
      ok: false,
      error: "AppImage apply is disabled when the daemon is not bound to loopback. Set THIRDFLARE_ALLOW_REMOTE_APPLY=1 to override."
    };
  }

  if (!asset) {
    return {
      ok: false,
      error: "No AppImage asset found for the selected release.",
      release
    };
  }

  if (!isTrustedAssetUrl(asset.url)) {
    return {
      ok: false,
      error: "Release asset URL is not from a trusted GitHub host.",
      release
    };
  }

  // Rolling backwards is how an attacker reintroduces a fixed vulnerability.
  const targetVersion = coerce(release?.tag);
  if (targetVersion && lt(targetVersion, check.current) && env.THIRDFLARE_ALLOW_DOWNGRADE !== "1") {
    return {
      ok: false,
      error: `${release.tag} is older than the version you have installed (${check.current}), so it was not installed.`,
      release
    };
  }

  const token = body.confirmToken || body.applyConfirmToken;
  if (!token || !consumeApplyConfirmToken(token, {
    owner: check.source.owner,
    repo: check.source.repo,
    tag: release.tag,
    assetUrl: asset.url
  })) {
    return {
      ok: false,
      error: "Missing or invalid apply confirmation token. Run update check/prepare again."
    };
  }

  try {
    const result = await applyAppImageUpdate(asset, {
      ...options,
      expectedSha256: body.expectedSha256,
      releaseAssets
    });
    return { ok: true, ...result, release };
  } catch (error) {
    // Verification and integrity failures are expected outcomes, not crashes.
    if (VERIFICATION_FAILURES.has(error.code)) {
      return { ok: false, error: error.message, code: error.code, applied: false, release };
    }
    throw error;
  }
}

export { isLoopbackBind, clearApplyConfirmTokens } from "./confirm.mjs";
