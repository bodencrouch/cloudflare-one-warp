import { parseStatus } from "./status.mjs";

const LISTEN_ARGS = ["--no-ansi", "--no-paginate", "--listen", "status"];

/**
 * One warp-cli --listen status child shared by SSE clients and the notification watcher.
 */
export function createStatusListener({
  spawnWarpCli,
  redactLine = (line) => line,
  restartDelayMs = 3000
} = {}) {
  if (typeof spawnWarpCli !== "function") {
    throw new Error("createStatusListener requires spawnWarpCli");
  }

  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  const subscribers = new Set();
  let restartTimer = null;
  let stopped = false;

  function broadcast(trimmed, kind) {
    const line = redactLine(trimmed);
    if (!line) return;
    const payload = {
      line,
      status: parseStatus(line),
      kind,
      generatedAt: new Date().toISOString()
    };
    for (const fn of subscribers) {
      try {
        fn(payload);
      } catch {
        /* subscriber error */
      }
    }
  }

  function consumeChunk(bufferRef, chunk, kind) {
    bufferRef.value += chunk.toString();
    const lines = bufferRef.value.split(/\r?\n/);
    bufferRef.value = (lines.pop() || "").slice(-65536);
    for (const raw of lines) {
      const trimmed = raw.trim().slice(0, 65536);
      if (trimmed) broadcast(trimmed, kind);
    }
  }

  function killChild() {
    const proc = child;
    child = null;
    if (!proc) return;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  }

  function scheduleRestart() {
    if (stopped || restartTimer || subscribers.size === 0) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      ensureChild();
    }, restartDelayMs);
  }

  function ensureChild() {
    if (stopped || child || subscribers.size === 0) return;
    const outRef = { value: "" };
    const errRef = { value: "" };

    const proc = spawnWarpCli(LISTEN_ARGS, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    child = proc;
    proc.stdout?.on("data", (chunk) => { if (child === proc) consumeChunk(outRef, chunk, "warp"); });
    proc.stderr?.on("data", (chunk) => { if (child === proc) consumeChunk(errRef, chunk, "error"); });
    proc.on("error", (error) => {
      if (child !== proc) return;
      broadcast(error.message, "error");
    });
    proc.on("close", () => {
      if (child !== proc) return;
      child = null;
      scheduleRestart();
    });
  }

  function subscribe(fn) {
    subscribers.add(fn);
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    ensureChild();
    return () => {
      subscribers.delete(fn);
      if (subscribers.size === 0) {
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        killChild();
      }
    };
  }

  function stop() {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    subscribers.clear();
    killChild();
  }

  return {
    subscribe,
    stop,
    get listenerActive() {
      return Boolean(child);
    },
    get subscriberCount() {
      return subscribers.size;
    }
  };
}
