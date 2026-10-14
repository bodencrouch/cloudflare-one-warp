import { readUpdateJson } from "./network.mjs";
const DEFAULT_CACHE_MS = 15 * 60 * 1000;

/** @type {Map<string, { at: number, data: unknown }>} */
const cache = new Map();

function authHeaders(env = process.env) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "Cloudflare-One-WARP-UpdateCheck"
  };
  const token = env.CLOUDFLARE_ONE_WARP_GITHUB_TOKEN || env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function cachedFetch(url, { env = process.env, cacheMs = DEFAULT_CACHE_MS, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  // Authenticated metadata must not outlive or cross credential changes.
  const authenticated = Boolean(authHeaders(env).authorization);
  const hit = authenticated ? null : cache.get(url);
  if (hit && Date.now() - hit.at < cacheMs) return hit.data;

  const response = await fetchImpl(url, { headers: authHeaders(env), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const error = new Error("GitHub API rate limit exceeded. Set CLOUDFLARE_ONE_WARP_GITHUB_TOKEN or wait and retry.");
      error.code = "RATE_LIMIT";
      throw error;
    }
  }
  if (response.status === 404) {
    const error = new Error(`GitHub resource not found: ${url}`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`GitHub API error ${response.status}`);
    error.code = "GITHUB_ERROR";
    error.status = response.status;
    throw error;
  }
  const data = await readUpdateJson(response);
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  if (!authenticated) cache.set(url, { at: Date.now(), data });
  return data;
}

export function clearGithubCache() {
  cache.clear();
}

/**
 * @param {{ owner: string, repo: string }} source
 */
export async function listReleases(source, options = {}) {
  const { owner, repo } = source;
  const perPage = options.perPage || 30;
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${perPage}`;
  const releases = await cachedFetch(url, options);
  return (Array.isArray(releases) ? releases : []).map(normalizeRelease);
}

export async function listForks(source, options = {}) {
  const { owner, repo } = source;
  const url = `https://api.github.com/repos/${owner}/${repo}/forks?per_page=${options.perPage || 20}&sort=stargazers`;
  try {
    const forks = await cachedFetch(url, options);
    return (Array.isArray(forks) ? forks : []).map((fork) => ({
      owner: fork.owner?.login || fork.full_name?.split("/")[0],
      repo: fork.name,
      fullName: fork.full_name,
      stars: fork.stargazers_count || 0,
      updatedAt: fork.updated_at
    }));
  } catch (error) {
    if (error.code === "NOT_FOUND") return [];
    throw error;
  }
}

function normalizeRelease(release) {
  return {
    id: release.id,
    tag: release.tag_name,
    name: release.name || release.tag_name,
    prerelease: Boolean(release.prerelease),
    draft: Boolean(release.draft),
    publishedAt: release.published_at,
    body: release.body || "",
    htmlUrl: release.html_url,
    assets: (release.assets || []).map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      contentType: asset.content_type
    }))
  };
}

/**
 * Pick the best asset for an install format from a release.
 */
export function pickAsset(release, format = "appimage", arch = process.arch) {
  const assets = release?.assets || [];
  const patterns = {
    appimage: /cloudflare-one-warp-.*\.AppImage$/i,
    deb: /cloudflare-one-warp_.*\.deb$/i,
    rpm: /cloudflare-one-warp-.*\.rpm$/i,
    snap: /cloudflare-one-warp_.*\.snap$/i,
    flatpak: /\.flatpak$/i,
    arch: /cloudflare-one-warp-.*\.pkg\.tar\.zst$/i,
    source: /cloudflare-one-warp-.*\.tar\.gz$/i
  };
  const pattern = patterns[format];
  if (!pattern) return null;
  const aliases = { x64: ["x86_64", "amd64"], arm64: ["aarch64", "arm64"], arm: ["armv7", "armhf"] };
  return assets.find((a) => {
    if (!pattern.test(a.name) || !isTrustedAssetUrl(a.url)) return false;
    const namedArch = a.name.match(/(?:^|[-_])(x86_64|amd64|aarch64|arm64|armv7|armhf)(?=[-_.]|$)/i)?.[1]?.toLowerCase();
    return !namedArch || (aliases[arch] || []).includes(namedArch);
  }) || null;
}

/** Only allow GitHub release / object CDN download hosts. */
export function isTrustedAssetUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password || parsed.port || parsed.hash) return false;
    // Only the hosts GitHub uses for release downloads, never wildcard domains.
    return new Set([
      "github.com", "objects.githubusercontent.com",
      "release-assets.githubusercontent.com", "github-releases.githubusercontent.com"
    ]).has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function findReleaseByTag(releases, tag) {
  const needle = String(tag || "").replace(/^v/i, "").toLowerCase();
  return releases.find((r) => {
    const t = String(r.tag || "").replace(/^v/i, "").toLowerCase();
    return !r.draft && (t === needle || String(r.tag).toLowerCase() === String(tag).toLowerCase());
  }) || null;
}

export function pickChannelRelease(releases, channel = "stable") {
  const usable = releases.filter((r) => !r.draft);
  if (channel === "beta") {
    return usable.find((r) => r.prerelease) || usable[0] || null;
  }
  return usable.find((r) => !r.prerelease) || null;
}
