import { getConfig } from "../config.mjs";
import { applyKillSwitch } from "./apply.mjs";

/** In-process pause while Zero Trust browser/IdP enrollment needs clear egress. */
let enrollmentPause = null;
let resumeTimer = null;
let transitionChain = Promise.resolve();

function serializeTransition(operation) {
  const result = transitionChain.then(operation, operation);
  transitionChain = result.catch(() => {});
  return result;
}

const DEFAULT_PAUSE_MS = 30 * 60 * 1000;

export function getEnrollmentPauseState() {
  if (!enrollmentPause) {
    return { paused: false, wasDesired: false, allowLan: false, at: null, expiresAt: null };
  }
  return {
    paused: true,
    wasDesired: Boolean(enrollmentPause.wasDesired),
    allowLan: Boolean(enrollmentPause.allowLan),
    at: enrollmentPause.at,
    expiresAt: enrollmentPause.expiresAt,
    restorationPending: Boolean(enrollmentPause.restorationPending),
    restoreAttempts: enrollmentPause.restoreAttempts || 0,
    error: enrollmentPause.error || null
  };
}

function clearResumeTimer() {
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

/** Called after a successful explicit off choice has been persisted. */
export function cancelEnrollmentPause() {
  clearResumeTimer();
  enrollmentPause = null;
}

/**
 * Temporarily remove nft kill-switch rules without changing persisted desired state.
 * Idempotent while already paused.
 */
async function beginPause({ env = process.env, pauseMs = DEFAULT_PAUSE_MS } = {}) {
  if (enrollmentPause) {
    return { ok: true, ...getEnrollmentPauseState(), detail: "Enrollment pause already active." };
  }

  const desired = Boolean(getConfig().warp?.killSwitch);
  const allowLan = Boolean(getConfig().warp?.killSwitchAllowLan);

  // Enrollment pause tracks temporary rule removal while persisted desired stays on.
  // When desired is off, begin/end are no-ops even if orphan nft rules remain.
  if (!desired) {
    return {
      ok: true,
      paused: false,
      wasDesired: false,
      allowLan,
      detail: "Kill switch not desired; no pause needed."
    };
  }

  const result = await applyKillSwitch({ enabled: false, allowLan, env });
  if (!result.ok) {
    return {
      ok: false,
      paused: false,
      wasDesired: desired,
      allowLan,
      detail: result.detail || "Failed to pause kill switch for enrollment.",
      guidedCommands: result.guidedCommands,
      script: result.script
    };
  }

  // A queued explicit off may have persisted while removal was running.
  if (!getConfig().warp?.killSwitch) {
    cancelEnrollmentPause();
    return { ok: true, paused: false, wasDesired: desired, allowLan, detail: "Kill switch remains off by user preference." };
  }

  const at = Date.now();
  const expiresAt = at + pauseMs;
  enrollmentPause = { wasDesired: desired, allowLan, at, expiresAt };
  clearResumeTimer();
  scheduleRestore({ env, reason: "timeout" }, pauseMs);

  return {
    ok: true,
    paused: true,
    wasDesired: desired,
    allowLan,
    at,
    expiresAt,
    detail: "Kill switch paused for Zero Trust enrollment (rules removed; desired state unchanged on disk)."
  };
}

function scheduleRestore(options, delay) {
  clearResumeTimer();
  const state = enrollmentPause;
  resumeTimer = setTimeout(() => {
    if (enrollmentPause !== state) return;
    endEnrollmentPause({ ...options, expectedState: state }).catch((error) => {
      // Keep the warning and recovery alive even if a child/process operation throws.
      if (enrollmentPause === state) {
        enrollmentPause.restorationPending = true;
        enrollmentPause.error = error.message;
        scheduleRestore({ ...options, reason: "retry" }, 60000);
      }
    });
  }, delay);
  resumeTimer.unref?.();
}

async function endPause({ env = process.env, reason = "manual", retryMs = 1000, expectedState } = {}) {
  if (expectedState && enrollmentPause !== expectedState) {
    return { ok: true, resumed: false, cancelled: true, reason, ...getEnrollmentPauseState(), detail: "Enrollment restoration was superseded." };
  }
  clearResumeTimer();
  if (!getConfig().warp?.killSwitch) {
    enrollmentPause = null;
    return { ok: true, resumed: false, reason, detail: "No kill switch resume needed." };
  }

  if (!enrollmentPause) {
    const at = Date.now();
    enrollmentPause = { wasDesired: true, at, expiresAt: at };
  }
  const state = enrollmentPause;
  state.restorationPending = true;
  state.restoreAttempts = (state.restoreAttempts || 0) + 1;
  let desiredAtApply = true;
  let result;
  try {
    result = await applyKillSwitch({
      env,
      shouldSkip: () => enrollmentPause !== state,
      resolve: () => {
        // Read preferences inside the firewall queue, after preceding explicit toggles persist.
        const warp = getConfig().warp || {};
        desiredAtApply = Boolean(warp.killSwitch);
        state.allowLan = Boolean(warp.killSwitchAllowLan);
        return { enabled: desiredAtApply, allowLan: state.allowLan };
      }
    });
  } catch (error) {
    result = { ok: false, detail: error.message, active: null };
  }
  if (result.cancelled || enrollmentPause !== state) {
    // Explicit off canceled this generation. Do not resurrect its warning or timer,
    // and never clear a newer pause created after cancellation.
    return { ok: true, resumed: false, cancelled: true, reason, ...getEnrollmentPauseState(), detail: "Enrollment restoration was superseded." };
  }
  if (result.ok || !getConfig().warp?.killSwitch) {
    enrollmentPause = null;
  } else {
    state.error = result.detail || "Failed to restore kill switch after enrollment.";
    // Continue recovery with a bounded exponential delay, retaining the visible warning.
    const delay = Math.min(60000, Math.max(10, retryMs) * 2 ** Math.min(state.restoreAttempts - 1, 6));
    scheduleRestore({ env, reason: "retry", retryMs }, delay);
  }
  return {
    ok: result.ok,
    resumed: result.ok && desiredAtApply,
    reason,
    ...getEnrollmentPauseState(),
    detail: result.ok
      ? (desiredAtApply ? "Kill switch restored after enrollment." : "Kill switch remains off by user preference.")
      : (result.detail || "Failed to restore kill switch after enrollment; retrying."),
    guidedCommands: result.guidedCommands,
    script: result.script,
    active: result.active
  };
}

/** Serialize enrollment state transitions; firewall application has its own shared queue. */
export function beginEnrollmentPause(options = {}) {
  return serializeTransition(() => beginPause(options));
}

export function endEnrollmentPause(options = {}) {
  return serializeTransition(() => endPause(options));
}

/** Actions that need IdP/browser or token callback while kill switch would block egress. */
export const ENROLLMENT_PAUSE_ACTIONS = new Set([
  "registerOrganization",
  "registrationToken"
]);
