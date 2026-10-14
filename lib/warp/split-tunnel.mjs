/**
 * Parse warp-cli split-tunnel list/dump output into structured UI state.
 */

export function parseRouteList(stdout) {
  if (!stdout || typeof stdout !== "string") return [];
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^error:/i.test(line));
}

export function parseSplitTunnelMode(dumpStdout) {
  if (!dumpStdout || typeof dumpStdout !== "string") return "unknown";
  const lines = dumpStdout.split(/\r?\n/).map(line => line.trim());
  let mode = "unknown";
  for (const line of lines) {
    const match = line.match(/^(?:split[- ]tunnel mode|mode):[ \t]*(include|exclude)(?:[- ]only)?[ \t]*$/i)
      || line.match(/^(include|exclude)(?:[- ]only| mode)[ \t]*$/i);
    if (match) mode = match[1].toLowerCase();
  }
  return mode;
}

export function parseManagedByDashboard(dumpStdout) {
  if (!dumpStdout || typeof dumpStdout !== "string") return false;
  let managed = false;
  for (const raw of dumpStdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(?:managed(?: by dashboard)?):[ \t]*(?:false|no|off)[ \t]*$/i.test(line)
      || /^(?:not managed|unmanaged)\b/i.test(line)) managed = false;
    else if (/^(?:managed(?: by dashboard)?):[ \t]*(?:true|yes|on)[ \t]*$/i.test(line)
      || /^managed by (?:cloudflare(?:'?s)? |your |the )?(?:device profile|dashboard|organization|zero trust)\b/i.test(line)
      || /^(?:source|configuration source):[ \t]*(?:dashboard|remote config|device profile|organization policy|zero trust)[ \t]*$/i.test(line)) managed = true;
  }
  return managed;
}

/**
 * @param {{ dump?: { stdout?: string } | string, ips?: { stdout?: string } | string, hosts?: { stdout?: string } | string }} input
 */
export function enrichSplitTunnel(input = {}) {
  const dumpText = typeof input.dump === "string" ? input.dump : (input.dump?.stdout ?? "");
  const ipText = typeof input.ips === "string" ? input.ips : (input.ips?.stdout ?? "");
  const hostText = typeof input.hosts === "string" ? input.hosts : (input.hosts?.stdout ?? "");

  const ips = parseRouteList(ipText);
  const hosts = parseRouteList(hostText);
  const mode = parseSplitTunnelMode(dumpText);
  const managedByDashboard = parseManagedByDashboard(dumpText);

  return {
    mode,
    ips,
    hosts,
    managedByDashboard,
    managedHint: managedByDashboard
      ? "Split tunnel routes may be managed by your Cloudflare device profile."
      : null
  };
}
