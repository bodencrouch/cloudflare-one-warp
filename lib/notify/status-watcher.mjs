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
    bufferRef.value = lines.pop() || "";
    for (const line of lines) {
      const clean = line.trim();
      if (!clean) continue;
      onStatus(parseStatus(clean));
    }
  }

  function startChild() {
    if (stopped || typeof spawnWarpCli !== "function") return;
    child = spawnWarpCli(["--no-ansi", "--no-paginate", "--listen", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
      env
    });
    const stdoutBuf = { value: "" };
    const stderrBuf = { value: "" };

    child.stdout?.on("data", (chunk) => handleChunk(stdoutBuf, chunk));
    child.stderr?.on("data", (chunk) => handleChunk(stderrBuf, chunk));
    child.on("error", () => {
      onStatus(parseStatus("Unable to connect to the CloudflareWARP daemon"));
    });
    child.on("close", () => {
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
      flush();
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
