const FAMILIES_MODES = new Set(["full", "malware", "off"]);
const MASQUE_OPTIONS = new Set(["h3-only", "h2-only", "h3-with-h2-fallback"]);

/**
 * Parse `warp-cli settings list` output.
 * Handles legacy `Key: Value` lines and current `(source)\tKey: Value` format.
 */
export function parseSettings(text) {
  const settings = {};
  if (!text) return settings;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Merged configuration:") continue;

    const match = trimmed.match(/^(?:\([^)]*\)\s*)?(.+?):\s*(.*?)\s*$/);
    if (match) {
      settings[match[1].trim()] = match[2].trim();
      continue;
    }

    const httpMatch = trimmed.match(/^HTTP Version:\s*(.+)$/i);
    if (httpMatch) settings["HTTP Version"] = httpMatch[1].trim();
  }

  return settings;
}

/** Infer 1.1.1.1 for Families mode from Resolve via when DNS Families is absent. */
export function deriveDnsFamilies(settings = {}) {
  const explicit = settings["DNS Families"];
  if (explicit) {
    const normalized = String(explicit).trim().toLowerCase();
    if (FAMILIES_MODES.has(normalized)) return normalized;
  }

  const resolve = settings["Resolve via"] || "";
  if (/family\.cloudflare-dns\.com|\b1\.1\.1\.3\b|::1113/i.test(resolve)) return "full";
  if (/security\.cloudflare-dns\.com|\b1\.1\.1\.2\b|::1112/i.test(resolve)) return "malware";
  return "off";
}

/** DNS log is enabled when settings list includes DNS logging until (real warp-cli). */
export function deriveDnsLogging(settings = {}) {
  const explicit = settings["DNS logging"];
  if (explicit) {
    const normalized = String(explicit).trim().toLowerCase();
    if (normalized === "enabled" || normalized === "on") return "enabled";
    if (normalized === "disabled" || normalized === "off") return "disabled";
  }

  const until = settings["DNS logging until"] || "";
  if (!until || /^\(not set\)$/i.test(until.trim())) return "disabled";
  return "enabled";
}

/** Map warp-cli HTTP Version display string to MASQUE option slug. */
export function deriveMasqueOption(settings = {}) {
  const direct = settings["MASQUE options"];
  if (direct && MASQUE_OPTIONS.has(String(direct).trim())) return String(direct).trim();

  const http = settings["HTTP Version"] || "";
  if (/h3-only|http\/3 only/i.test(http)) return "h3-only";
  if (/h2-only|http\/2 only/i.test(http)) return "h2-only";
  if (/fallback|h3-with-h2|http\/3 with http\/2/i.test(http)) return "h3-with-h2-fallback";
  return direct || "Unknown";
}

/** Parse `warp-cli override local-network show` for UI state. */
export function deriveLocalNetworkAccess(overrideStdout = "") {
  const text = String(overrideStdout || "");
  if (/\b(?:error|failed|unable)\b/i.test(text)) return "unknown";
  if (/no current access|\b(?:denied|blocked|not allowed|not granted)\b/i.test(text)) return "blocked";
  if (/\b(?:allowed|granted)\b/i.test(text)) return "allowed";
  return "unknown";
}

const UI_MODES = new Set(["warp", "doh", "warp+doh", "dot", "warp+dot", "proxy", "tunnel_only"]);

/** Map warp-cli Mode display strings to UI segmented slugs. */
export function normalizeOperatingMode(raw) {
  if (raw == null || raw === "") return "unknown";
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/[\s_-]+/g, "");
  if (UI_MODES.has(lower)) return lower;
  // Real warp-cli: "(user set) Mode: WarpProxy on port 40000"
  if (/^warpproxy\b/i.test(trimmed) || /^localproxy\b/i.test(trimmed)) return "proxy";
  if (/\bproxy on port\b/i.test(trimmed)) return "proxy";
  if (compact.startsWith("warpproxy") || compact.startsWith("localproxy")) return "proxy";
  if (compact === "warp" || compact === "warpwithdnsoverhttps" || compact === "warpwithdns") return "warp";
  if (compact === "dnsoverhttps" || compact === "doh") return "doh";
  if (compact === "warpwithdnsovertls" || compact === "warpwithdot") return "warp+dot";
  if (compact === "dnsovertls" || compact === "dot") return "dot";
  if (compact === "warpdoh" || compact === "warp+doh") return "warp+doh";
  if (compact === "warpdot" || compact === "warp+dot") return "warp+dot";
  if (compact === "proxy" || compact === "localproxy") return "proxy";
  if (compact === "tunnelonly" || compact === "tunnel_only") return "tunnel_only";
  return lower;
}

/** True when warp-cli operating mode is local proxy (WarpProxy). */
export function isProxyOperatingMode(raw) {
  return normalizeOperatingMode(raw) === "proxy";
}

/** Parse listen port from Mode line or explicit Proxy port key. */
export function deriveProxyPort(settings = {}) {
  const validPort = value => {
    const text = String(value ?? "").trim();
    if (!/^[0-9]{1,5}$/.test(text)) return null;
    const port = Number(text);
    return port >= 1 && port <= 65535 ? String(port) : null;
  };
  for (const key of ["Proxy port", "proxy port", "SOCKS proxy port"]) {
    const port = validPort(settings[key]);
    if (port) return port;
  }
  const mode = settings.Mode ?? settings.mode ?? "";
  const match = String(mode).match(/\bport\s+(\S+)/i);
  return match ? validPort(match[1]) : null;
}

/** Normalized boolean from settings keys like Disabled for Wifi. */
export function settingFlag(settings, key) {
  const value = settings[key];
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" ? true : normalized === "false" ? false : null;
}

/** Add derived fields for UI parity when warp-cli omits them from settings list. */
export function enrichSettings(settings, extras = {}) {
  const enriched = {
    ...settings,
    "DNS Families": deriveDnsFamilies(settings),
    "DNS logging": deriveDnsLogging(settings),
    "MASQUE options": deriveMasqueOption(settings)
  };

  const wifiDisabled = settingFlag(settings, "Disabled for Wifi");
  if (wifiDisabled != null) {
    enriched["Wi-Fi WARP"] = wifiDisabled ? "disable" : "keep";
  }

  const ethernetDisabled = settingFlag(settings, "Disabled for Ethernet");
  if (ethernetDisabled != null) {
    enriched["Ethernet WARP"] = ethernetDisabled ? "disable" : "keep";
  }

  if (extras.localNetworkOverride != null) {
    enriched["Local network access"] = deriveLocalNetworkAccess(extras.localNetworkOverride);
  }

  if (settings.Mode != null) {
    enriched.Mode = normalizeOperatingMode(settings.Mode);
  }

  const proxyPort = deriveProxyPort(settings);
  if (proxyPort) {
    enriched["Proxy port"] = proxyPort;
  }

  const tunnelProtocol = settings["WARP tunnel protocol"] || settings.Protocol || settings.protocol;
  if (tunnelProtocol) {
    enriched["Tunnel protocol"] = String(tunnelProtocol).trim();
  }

  return enriched;
}
