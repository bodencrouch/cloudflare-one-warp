const activeChildren = new Set();

/** Stop commands owned by this daemon before exiting. */
export function stopBoundedChildren() {
  for (const child of activeChildren) child.kill("SIGKILL");
}

/** Run one CLI invocation with a hard deadline and a shared stdout/stderr budget. */
export function runBoundedChild(start, { timeout = 15000, maxOutput = 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    let bytes = 0;
    let stdout = "";
    let stderr = "";
    const finish = (code, error = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      // Descendants may keep inherited pipes open after the CLI exits. A deadline
      // must release those handles too, rather than waiting forever for close.
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve({ ok: code === 0 && !error, code, stdout, stderr: error || stderr });
    };
    const terminate = (message) => {
      child.kill("SIGKILL");
      finish(null, message);
    };
    try { child = start(); }
    catch (error) { finish(null, error.message); return; }
    activeChildren.add(child);
    const collect = (stream, chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxOutput) {
        terminate("warp-cli output exceeded the 1 MiB limit.");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
    timer = setTimeout(() => terminate("warp-cli exceeded its execution deadline."), timeout);
  });
}
