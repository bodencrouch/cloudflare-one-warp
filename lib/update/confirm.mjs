import { randomBytes } from "node:crypto";

/** @type {Map<string, { owner: string, repo: string, tag: string, assetUrl: string, expires: number }>} */
const tokens = new Map();

const MAX_TOKENS = 128;

const TTL_MS = 5 * 60 * 1000;

function pruneExpired(now = Date.now()) {
  for (const [key, value] of tokens) {
    if (value.expires <= now) tokens.delete(key);
  }
}

/**
 * Issue a one-time apply confirmation token bound to a specific release asset.
 */
export function issueApplyConfirmToken({ owner, repo, tag, assetUrl }) {
  pruneExpired();
  while (tokens.size >= MAX_TOKENS) tokens.delete(tokens.keys().next().value);
  const token = randomBytes(24).toString("hex");
  tokens.set(token, {
    owner,
    repo,
    tag,
    assetUrl,
    expires: Date.now() + TTL_MS
  });
  return token;
}

/**
 * Consume a token. Returns true only once when binding matches and token is fresh.
 */
export function consumeApplyConfirmToken(token, { owner, repo, tag, assetUrl }) {
  pruneExpired();
  const entry = tokens.get(token);
  if (!entry) return false;
  tokens.delete(token);
  if (entry.expires <= Date.now()) return false;
  return (
    entry.owner === owner
    && entry.repo === repo
    && entry.tag === tag
    && entry.assetUrl === assetUrl
  );
}

/** Test helper. */
export function clearApplyConfirmTokens() {
  tokens.clear();
}

export function isLoopbackBind(host) {
  if (!host) return true;
  const h = String(host).toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}
