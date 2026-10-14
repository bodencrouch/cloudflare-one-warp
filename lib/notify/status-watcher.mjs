import {
  notificationForTransition,
  parseStatus,
  statusFingerprint
} from "../warp/status.mjs";
import { notificationsAvailable, sendDesktopNotification } from "./desktop.mjs";

/**
 * Watch warp-cli --listen status and emit desktop notifications on transitions.
 * Prefer `statusListener` (shared daemon listener) over spawning a dedicated child.
 */
export function startStatusWatcher({
  statusListener,
  spawnWarpCli,
  enabled = true,
  env = process.env,
  debounceMs = 1500,
  notify = sendDesktopNotification,
  available = notificationsAvailable,
  getKillSwitchDesired = () => false
} = {}) {
  if (!enabled) {
    return { stop() {}, started: false, reason: "disabled" };
  }
  if (!available(env)) {
    return { stop() {}, started: false, reason: "notify-send unavailable" };
  }

  let previous = null;
  let pendingTimer = null;
  let pendingNext = null;
  let stopped = false;
  let child = null;
  let restartTimer = null;
  let unsubscribe = null;

  function flush() {
    if (!pendingNext) return;
    const next = pendingNext;
    pendingNext = null;
    const note = notificationForTransition(previous, next, {
      killSwitchDesired: Boolean(getKillSwitchDesired())
    });
    previous = next;
    if (note) notify(note, { env });
  }

  function onStatus(status) {
    if (stopped) return;
    pendingNext = status;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      flush();
    }, debounceMs);
  }

  function handleChunk(bufferRef, chunk) {
    bufferRef.value += chunk.toString();
    const lines = bufferRef.value.split(/\r?\n/);
    bufferRef.value = (lines.pop() || "").slice(-65536);
    for (const line of lines) {
      const clean = line.trim().slice(0, 65536);
      if (!clean) continue;
      onStatus(parseStatus(clean));
    }
  }

  function startChild() {
    if (stopped || typeof spawnWarpCli !== "function") return;
    let proc;
    try {
      proc = spawnWarpCli(["--no-ansi", "--no-paginate", "--listen", "status"], {
        stdio: ["ignore", "pipe", "pipe"], env
      });
    } catch {
      onStatus(parseStatus("Unable to connect to the CloudflareWARP daemon"));
      restartTimer = setTimeout(startChild, 3000);
      return;
    }
    child = proc;
    const stdoutBuf = { value: "" };
    const stderrBuf = { value: "" };

    proc.stdout?.on("data", (chunk) => { if (child === proc) handleChunk(stdoutBuf, chunk); });
    proc.stderr?.on("data", (chunk) => { if (child === proc) handleChunk(stderrBuf, chunk); });
    proc.on("error", () => {
      if (child !== proc) return;
      onStatus(parseStatus("Unable to connect to the CloudflareWARP daemon"));
    });
    proc.on("close", () => {
      if (child !== proc) return;
      child = null;
      if (stopped) return;
      restartTimer = setTimeout(startChild, 3000);
    });
  }

  if (statusListener && typeof statusListener.subscribe === "function") {
    unsubscribe = statusListener.subscribe((payload) => onStatus(payload.status));
  } else if (typeof spawnWarpCli === "function") {
    startChild();
  } else {
    return { stop() {}, started: false, reason: "missing statusListener or spawnWarpCli" };
  }

  return {
    started: true,
    stop() {
      stopped = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      if (restartTimer) clearTimeout(restartTimer);
      pendingNext = null;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      try {
        child?.kill();
      } catch {
        /* ignore */
      }
      child = null;
    },
    /** Test helpers */
    _inject(statusText) {
      onStatus(parseStatus(statusText));
    },
    _fingerprint: statusFingerprint
  };
}
