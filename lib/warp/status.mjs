/**
 * Parse warp-cli status text into connection flags.
 */
export function parseStatus(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  const lower = clean.toLowerCase();
  // Connection words in diagnostic prose are not authoritative state. Prefer the
  // final explicit status record, matching warp-cli's streaming output format.
  const stateLines = lower.split("\n").map(line => line.trim()).filter(line => /^(?:(?:status(?: update)?):\s*)?(?:connected|disconnected|not connected|connecting|reconnecting)\s*$/.test(line));
  const state = stateLines.at(-1) || "";
  const registrationMissing = /\b(?:registration missing|not registered)\b/.test(lower);
  const daemonMissing = /unable to connect to (?:the )?cloudflare\s*warp daemon|cloudflare\s*warp daemon (?:is )?unavailable/.test(lower);
  const disconnected = /^(?:(?:status(?: update)?):\s*)?(?:disconnected|not connected)\b/.test(state);
  const connecting = !daemonMissing && !registrationMissing && /^(?:(?:status(?: update)?):\s*)?(?:connecting|reconnecting)\b/.test(state);
  const connected = !daemonMissing && !registrationMissing && /^(?:(?:status(?: update)?):\s*)?connected\b/.test(state);
  const unhealthy = /\b(?:unhealthy|degraded)\b/.test(lower);
  const healthy = !unhealthy && /^(?:network:\s*)?healthy\s*$/m.test(lower);

  return {
    label: clean || "Unavailable",
    connected,
    connecting,
    disconnected,
    registrationMissing,
    healthy,
    unhealthy,
    daemonMissing,
    severity: daemonMissing || registrationMissing || disconnected ? "bad" : unhealthy || connecting ? "warn" : connected || healthy ? "good" : "bad"
  };
}

/**
 * Stable key for transition comparison (ignore cosmetic label churn).
 */
export function statusFingerprint(status) {
  if (!status) return "none";
  return [
    status.connected ? "1" : "0",
    status.connecting ? "1" : "0",
    status.disconnected ? "1" : "0",
    status.registrationMissing ? "1" : "0",
    status.daemonMissing ? "1" : "0",
    status.unhealthy ? "1" : "0",
    status.severity || "bad"
  ].join(":");
}

/**
 * Decide whether to notify and what to say.
 * Returns null when the change is not meaningful (or first sample).
 *
 * @param {ReturnType<typeof parseStatus> | null} previous
 * @param {ReturnType<typeof parseStatus> | null} next
 * @param {{ killSwitchDesired?: boolean }} [context]
 */
export function notificationForTransition(previous, next, context = {}) {
  if (!next) return null;
  if (!previous) return null; // suppress bootstrap noise

  const prevKey = statusFingerprint(previous);
  const nextKey = statusFingerprint(next);
  if (prevKey === nextKey) return null;

  // Sleep/roam often flaps Connected → Connecting → Connected. Connecting alone
  // is not worth a notification; wait for a settled connected/disconnected.
  if (next.connecting && !next.disconnected && previous.connected) {
    return null;
  }

  if (next.daemonMissing && !previous.daemonMissing) {
    return {
      title: "Cloudflare One WARP",
      body: "Cloudflare WARP daemon is unavailable.",
      kind: "needs_attention"
    };
  }

  if (next.connected && !previous.connected) {
    return {
      title: "Cloudflare One WARP",
      body: "Connected to Cloudflare WARP.",
      kind: "connect_success"
    };
  }

  if (next.disconnected && previous.connected) {
    if (context.killSwitchDesired) {
      return {
        title: "Cloudflare One WARP",
        body: "WARP disconnected while Always On is on. Traffic outside WARP may be blocked — reconnect or turn Always On off in Settings.",
        kind: "needs_attention"
      };
    }
    return {
      title: "Cloudflare One WARP",
      body: "Disconnected from Cloudflare WARP.",
      kind: "unexpected_disconnect"
    };
  }

  if (next.unhealthy && !previous.unhealthy && next.connected) {
    return {
      title: "Cloudflare One WARP",
      body: "WARP network is unhealthy or degraded.",
      kind: "needs_attention"
    };
  }

  if (next.registrationMissing && !previous.registrationMissing) {
    return {
      title: "Cloudflare One WARP",
      body: "WARP registration is missing.",
      kind: "needs_attention"
    };
  }

  return null;
}
