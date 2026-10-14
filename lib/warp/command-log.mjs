/** In-memory ring buffer of warp-cli invocations for the Console log tab. */

const DEFAULT_CAPACITY = 500;

let capacity = DEFAULT_CAPACITY;
let nextId = 1;
/** @type {Array<{ id: number, ts: string, command: string, code: number | null, ok: boolean, stdout: string, stderr: string, durationMs: number, source: string }>} */
const entries = [];

export function getCommandLogCapacity() {
  return capacity;
}

export function setCommandLogCapacity(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 10 && n <= 5000) {
    capacity = Math.floor(n);
    while (entries.length > capacity) entries.shift();
  }
}

/**
 * @param {{ command: string, code: number | null, ok: boolean, stdout?: string, stderr?: string, durationMs?: number }} result
 * @param {{ source?: string }} [meta]
 */
export function appendFromRunWarp(result, meta = {}) {
  const entry = {
    id: nextId++,
    ts: new Date().toISOString(),
    command: result.command || "",
    code: result.code ?? null,
    ok: Boolean(result.ok),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    durationMs: Number(result.durationMs) || 0,
    source: meta.source || "warp"
  };
  entries.push(entry);
  while (entries.length > capacity) entries.shift();
  return entry;
}

/** @param {{ since?: number | null }} [options] */
export function listEntries({ since = null } = {}) {
  if (since == null || !Number.isFinite(since)) return [...entries];
  return entries.filter((entry) => entry.id > since);
}

export function resetCommandLogForTests() {
  entries.length = 0;
  nextId = 1;
  capacity = DEFAULT_CAPACITY;
}

/** Redact credential argv values before commands enter responses or diagnostics. */
export function redactWarpArgs(args) {
  let redactNext = false;
  return args.map((arg) => {
    const value = String(arg);
    if (redactNext) {
      redactNext = false;
      return "[redacted]";
    }
    if (/^(?:license|token|--license|--token|--license-key|--registration-token)$/i.test(value)) {
      redactNext = true;
      return value;
    }
    if (/^--(?:license|token|license-key|registration-token)=/i.test(value)) {
      return value.replace(/=.*/, "=[redacted]");
    }
    if (/^(?:com\.cloudflare\.warp:\/\/|https:\/\/[^/]+\.cloudflareaccess\.com\/)/i.test(value)) return "[redacted]";
    return value;
  });
}
