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

async function cachedFetch(url, { env = process.env, cacheMs = DEFAULT_CACHE_MS } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < cacheMs) return hit.data;

  const response = await fetch(url, { headers: authHeaders(env) });
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
  const data = await response.json();
  cache.set(url, { at: Date.now(), data });
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
export function pickAsset(release, format = "appimage") {
  const assets = release?.assets || [];
  const patterns = {
    appimage: /cloudflare-one-warp-.*\.AppImage$/i,
    deb: /cloudflare-one-warp_.*\.deb$/i,
    rpm: /cloudflare-one-warp-.*\.rpm$/i,
    snap: /cloudflare-one-warp_.*\.snap$/i,
    flatpak: /\.flatpak$/i,
    source: /cloudflare-one-warp-.*\.tar\.gz$/i
  };
  const pattern = patterns[format] || patterns.appimage;
  return assets.find((a) => pattern.test(a.name) && isTrustedAssetUrl(a.url)) || null;
}

/** Only allow GitHub release / object CDN download hosts. */
export function isTrustedAssetUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "github.com"
      || host.endsWith(".github.com")
      || host === "objects.githubusercontent.com"
      || host.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}

export function findReleaseByTag(releases, tag) {
  const needle = String(tag || "").replace(/^v/i, "").toLowerCase();
  return releases.find((r) => {
    const t = String(r.tag || "").replace(/^v/i, "").toLowerCase();
    return t === needle || String(r.tag).toLowerCase() === String(tag).toLowerCase();
  }) || null;
}

export function pickChannelRelease(releases, channel = "stable") {
  const usable = releases.filter((r) => !r.draft);
  if (channel === "beta") {
    return usable.find((r) => r.prerelease) || usable[0] || null;
  }
  return usable.find((r) => !r.prerelease) || null;
}
