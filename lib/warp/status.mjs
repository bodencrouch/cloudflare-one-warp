/**
 * Parse warp-cli status text into connection flags.
 */
export function parseStatus(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  const lower = clean.toLowerCase();
  const disconnected = /\b(disconnected|not connected)\b/.test(lower);
  const connecting = !disconnected && /\b(connecting|reconnecting)\b/.test(lower);
  const connected = !disconnected && !connecting && /\bconnected\b/.test(lower);
  const registrationMissing = lower.includes("registration missing") || lower.includes("not registered");
  const healthy = lower.includes("network: healthy") || lower === "healthy";
  const unhealthy = lower.includes("unhealthy") || lower.includes("degraded");
  const daemonMissing = lower.includes("unable to connect to the cloudflarewarp daemon");

  return {
    label: clean || "Unavailable",
    connected,
    connecting,
    disconnected,
    registrationMissing,
    healthy,
    unhealthy,
    daemonMissing,
    severity: connected || healthy ? "good" : connecting || unhealthy ? "warn" : "bad"
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
      title: "ThirdFlare One",
      body: "Cloudflare WARP daemon is unavailable.",
      kind: "needs_attention"
    };
  }

  if (next.connected && !previous.connected) {
    return {
      title: "ThirdFlare One",
      body: "Connected to Cloudflare WARP.",
      kind: "connect_success"
    };
  }

  if (next.disconnected && previous.connected) {
    if (context.killSwitchDesired) {
      return {
        title: "ThirdFlare One",
        body: "WARP disconnected while Always On is on. Traffic outside WARP may be blocked — reconnect or turn Always On off in Settings.",
        kind: "needs_attention"
      };
    }
    return {
      title: "ThirdFlare One",
      body: "Disconnected from Cloudflare WARP.",
      kind: "unexpected_disconnect"
    };
  }

  if (next.unhealthy && !previous.unhealthy && next.connected) {
    return {
      title: "ThirdFlare One",
      body: "WARP network is unhealthy or degraded.",
      kind: "needs_attention"
    };
  }

  if (next.registrationMissing && !previous.registrationMissing) {
    return {
      title: "ThirdFlare One",
      body: "WARP registration is missing.",
      kind: "needs_attention"
    };
  }

  return null;
}
