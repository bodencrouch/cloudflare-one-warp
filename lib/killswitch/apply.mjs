import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDisableScript, buildEnableScript, KILLSWITCH_TABLE } from "./rules.mjs";

/** Serialize enable/disable so startup and API cannot race. */
let applyChain = Promise.resolve();

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env || process.env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
          finish({
            ok: false,
            code: null,
            stdout: stdout.trim(),
            stderr: stderr.trim() || `${cmd} timed out after ${options.timeoutMs}ms`,
            command: `${cmd} ${args.join(" ")}`
          });
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        stdout: "",
        stderr: error.message,
        command: `${cmd} ${args.join(" ")}`
      });
    });
    child.on("close", (code) => {
      finish({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command: `${cmd} ${args.join(" ")}`
      });
    });
  });
}

function isNftApplyBlocked(env) {
  // CI and `sudo npm test` both set this so apply paths match an unprivileged daemon.
  return env.CLOUDFLARE_ONE_WARP_NFT_NO_PKEXEC === "1";
}

function canTryPkexec(env) {
  if (isNftApplyBlocked(env)) return false;
  // Headless CI / non-interactive daemons should not block on polkit prompts.
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY && !env.PKEXEC_UID) return false;
  return true;
}

function missingTable(result) {
  return /No such file|does not exist|not found/i.test(`${result.stderr}\n${result.stdout}`);
}

function permissionDenied(result) {
  return /Operation not permitted|permission denied|you must be root/i.test(
    `${result.stderr}\n${result.stdout}`
  );
}

function pkexecAuthDenied(result) {
  return /dismissed|cancel(?:led)?|refused|not authorized|authentication|polkit|not permitted for/i.test(
    `${result.stderr}\n${result.stdout}`
  );
}

/** After the user dismisses polkit, avoid hammering prompts until cooldown expires. */
let pkexecDeniedUntil = 0;
const PKEXEC_DENY_COOLDOWN_MS = 5 * 60 * 1000;

function pkexecBlocked() {
  return Date.now() < pkexecDeniedUntil;
}

function notePkexecDenied(result) {
  if (pkexecAuthDenied(result)) {
    pkexecDeniedUntil = Date.now() + PKEXEC_DENY_COOLDOWN_MS;
  }
}

function resolveNftApplyHelper(env = process.env) {
  const configured = env.CLOUDFLARE_ONE_WARP_NFT_HELPER;
  if (configured) return configured;

  const root = fileURLToPath(new URL("../..", import.meta.url));
  const candidates = [
    join(root, "scripts/cloudflare-one-warp-nft-apply"),
    "/usr/lib/cloudflare-one-warp/scripts/cloudflare-one-warp-nft-apply"
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

/**
 * Read-only nft status probe — never escalates to pkexec/polkit.
 * Privilege is required only when applying rules (enable/disable), not to poll state.
 */
async function runNftList(env) {
  const result = await run("nft", ["list", "table", "inet", KILLSWITCH_TABLE], {
    env,
    timeoutMs: 8000
  });
  return { ...result, method: "nft" };
}

async function runNftScript(script, { env = process.env } = {}) {
  if (isNftApplyBlocked(env)) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: "Operation not permitted",
      method: "failed",
      guidedCommands: [
        `sudo nft -f /tmp/cloudflare-one-warp-killswitch.nft`,
        "# Save the returned script to that path first, then run the command above."
      ],
      script
    };
  }

  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-ks-"));
  const file = join(dir, "rules.nft");
  writeFileSync(file, script, { mode: 0o600 });

  try {
    let result = await run("nft", ["-f", file], { env, timeoutMs: 8000 });
    if (result.ok) {
      return { ...result, method: "nft" };
    }

    let pk = { ok: false, code: null, stdout: "", stderr: "pkexec skipped" };
    if (canTryPkexec(env) && !pkexecBlocked()) {
      const helper = resolveNftApplyHelper(env);
      const pkArgs = helper ? [helper, "apply", file] : ["nft", "-f", file];
      // Polkit prompts often exceed a few seconds — do not SIGKILL early.
      pk = await run("pkexec", pkArgs, { env, timeoutMs: 120000 });
      if (pk.ok) {
        return { ...pk, method: "pkexec" };
      }
      notePkexecDenied(pk);
    } else if (pkexecBlocked()) {
      pk = {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Administrator authentication was dismissed; retry after a few minutes or use sudo.",
        method: "pkexec"
      };
    }

    return {
      ok: false,
      code: pk.code ?? result.code,
      stdout: [result.stdout, pk.stdout].filter(Boolean).join("\n"),
      stderr: [result.stderr, pk.stderr].filter(Boolean).join("\n"),
      method: "failed",
      guidedCommands: [
        `sudo nft -f /tmp/cloudflare-one-warp-killswitch.nft`,
        "# Save the returned script to that path first, then run the command above."
      ],
      script
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * @returns {Promise<{ active: boolean | null, detail: string, probeError?: boolean, raw?: string, method?: string }>}
 */
export async function probeKillSwitchActive(env = process.env) {
  const result = await runNftList(env);
  if (result.ok) {
    return {
      active: true,
      detail: "nftables table loaded",
      raw: result.stdout,
      method: result.method
    };
  }
  if (missingTable(result)) {
    return {
      active: false,
      detail: "nftables table not present",
      raw: result.stderr || result.stdout,
      method: result.method
    };
  }
  if (permissionDenied(result)) {
    return {
      active: null,
      detail: "Cannot read nftables without administrator privileges (kill switch status unknown).",
      raw: result.stderr || result.stdout,
      probeError: true,
      method: result.method
    };
  }
  return {
    active: null,
    detail: result.stderr || result.stdout || "unable to query nftables",
    raw: result.stderr || result.stdout,
    probeError: true,
    method: result.method
  };
}

async function applyKillSwitchUnlocked(options) {
  const enabled = Boolean(options.enabled);
  const allowLan = Boolean(options.allowLan);
  const env = options.env || process.env;

  if (!enabled) {
    const before = await probeKillSwitchActive(env);
    // Only skip destroy when we *know* the table is absent.
    if (before.active === false && !before.probeError) {
      return {
        ok: true,
        enabled: false,
        desired: false,
        method: "noop",
        detail: "Kill switch already off.",
        probe: before
      };
    }
  }

  let script = enabled
    ? buildEnableScript({ allowLan, useDestroy: true })
    : buildDisableScript({ useDestroy: true });

  let result = await runNftScript(script, { env });

  // Older nft without `destroy`
  if (!result.ok && /\bdestroy\b|syntax error/i.test(`${result.stderr}\n${result.stdout}`)) {
    script = enabled
      ? buildEnableScript({ allowLan, useDestroy: false })
      : buildDisableScript({ useDestroy: false });
    result = await runNftScript(script, { env });
  }

  if (!enabled && !result.ok && missingTable(result)) {
    return { ok: true, enabled: false, desired: false, method: "noop", detail: "Kill switch already off." };
  }

  const probe = await probeKillSwitchActive(env);

  // If nft apply succeeded but unprivileged/privileged probe still cannot read state,
  // trust the apply result rather than reporting a false inactive (stuck-on / false-off).
  let active;
  if (probe.active === true || probe.active === false) {
    active = probe.active;
  } else if (result.ok) {
    active = enabled;
  } else {
    active = null;
  }

  const ok = Boolean(
    result.ok
    && (probe.probeError
      ? true
      : (enabled ? active === true : active === false))
  );

  return {
    ok,
    enabled: active === true,
    active,
    desired: enabled,
    method: result.method || "nft",
    detail: ok
      ? (enabled ? "Kill switch rules applied." : "Kill switch rules removed.")
      : (result.stderr || result.stdout || probe.detail || "nft failed"),
    guidedCommands: result.guidedCommands || null,
    script: ok ? undefined : script,
    probe,
    probeError: Boolean(probe.probeError)
  };
}

/**
 * @param {{ enabled: boolean, allowLan?: boolean, env?: NodeJS.ProcessEnv }} options
 */
export function applyKillSwitch(options) {
  const runApply = applyKillSwitchUnlocked(options);
  const queued = applyChain.then(() => runApply, () => runApply);
  applyChain = queued.then(() => undefined, () => undefined);
  return queued;
}
