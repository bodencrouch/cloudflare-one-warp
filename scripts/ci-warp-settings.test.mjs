import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveDnsFamilies,
  deriveDnsLogging,
  deriveLocalNetworkAccess,
  deriveMasqueOption,
  deriveProxyPort,
  enrichSettings,
  isProxyOperatingMode,
  normalizeOperatingMode,
  parseSettings
} from "../lib/warp/settings.mjs";

const REAL_OFF = `(user set)\tResolve via: cloudflare-dns.com @ [162.159.36.1]`;
const REAL_MALWARE = `(user set)\tResolve via: security.cloudflare-dns.com @ [1.1.1.2]`;
const REAL_FULL = `(user set)\tResolve via: family.cloudflare-dns.com @ [1.1.1.3]`;
const REAL_DNS_LOG_ON = `(user set)\tDNS logging until: SystemTime { tv_sec: 1 }`;
const REAL_MASQUE = `(not set)\tMASQUE Protocol Settings: \n  HTTP Version: MASQUE (HTTP/3 with HTTP/2 fallback)`;

test("parseSettings strips warp-cli source prefix", () => {
  const settings = parseSettings(`Merged configuration:\n(default)\tMode: Warp\n(user set)\tResolve via: cloudflare-dns.com`);
  assert.equal(settings.Mode, "Warp");
  assert.equal(settings["Resolve via"], "cloudflare-dns.com");
});

test("parseSettings captures multiline HTTP Version", () => {
  const settings = parseSettings(REAL_MASQUE);
  assert.equal(settings["HTTP Version"], "MASQUE (HTTP/3 with HTTP/2 fallback)");
});

test("deriveDnsFamilies maps Resolve via hostnames", () => {
  assert.equal(deriveDnsFamilies(parseSettings(REAL_OFF)), "off");
  assert.equal(deriveDnsFamilies(parseSettings(REAL_MALWARE)), "malware");
  assert.equal(deriveDnsFamilies(parseSettings(REAL_FULL)), "full");
});

test("deriveDnsLogging detects active logging", () => {
  assert.equal(deriveDnsLogging({ "DNS logging": "disabled" }), "disabled");
  assert.equal(deriveDnsLogging(parseSettings(REAL_DNS_LOG_ON)), "enabled");
  assert.equal(deriveDnsLogging({}), "disabled");
});

test("deriveMasqueOption maps HTTP Version display string", () => {
  assert.equal(deriveMasqueOption(parseSettings(REAL_MASQUE)), "h3-with-h2-fallback");
  assert.equal(deriveMasqueOption({ "MASQUE options": "h3-only" }), "h3-only");
});

test("deriveLocalNetworkAccess parses override show output", () => {
  assert.equal(deriveLocalNetworkAccess("No current access to local network"), "blocked");
  assert.equal(deriveLocalNetworkAccess("Local network access is allowed"), "allowed");
});

test("enrichSettings injects derived UI fields", () => {
  const enriched = enrichSettings(parseSettings(REAL_MALWARE), {
    localNetworkOverride: "No current access to local network"
  });
  assert.equal(enriched["DNS Families"], "malware");
  assert.equal(enriched["DNS logging"], "disabled");
  assert.equal(enriched["Local network access"], "blocked");
});

test("enrichSettings maps trusted network flags", () => {
  const enriched = enrichSettings({
    "Disabled for Wifi": "true",
    "Disabled for Ethernet": "false"
  });
  assert.equal(enriched["Wi-Fi WARP"], "disable");
  assert.equal(enriched["Ethernet WARP"], "keep");
});

test("normalizeOperatingMode maps warp-cli display strings to UI slugs", () => {
  assert.equal(normalizeOperatingMode("WarpWithDnsOverHttps"), "warp");
  assert.equal(normalizeOperatingMode("Warp"), "warp");
  assert.equal(normalizeOperatingMode("DnsOverHttps"), "doh");
  assert.equal(normalizeOperatingMode("WarpWithDnsOverTls"), "warp+dot");
  assert.equal(normalizeOperatingMode("DnsOverTls"), "dot");
  assert.equal(normalizeOperatingMode("Proxy"), "proxy");
  assert.equal(normalizeOperatingMode("LocalProxy"), "proxy");
  assert.equal(normalizeOperatingMode("WarpProxy on port 40000"), "proxy");
  assert.equal(normalizeOperatingMode("TunnelOnly"), "tunnel_only");
  assert.equal(normalizeOperatingMode("proxy"), "proxy");
  assert.equal(normalizeOperatingMode("WARP"), "warp");
});

test("enrichSettings normalizes Mode for segmented controls", () => {
  const enriched = enrichSettings(parseSettings("(default)\tMode: WarpWithDnsOverHttps"));
  assert.equal(enriched.Mode, "warp");
  const proxy = enrichSettings(parseSettings("(default)\tMode: Proxy"));
  assert.equal(proxy.Mode, "proxy");
  const warpProxy = enrichSettings(parseSettings("(user set)\tMode: WarpProxy on port 40000"));
  assert.equal(warpProxy.Mode, "proxy");
  assert.equal(warpProxy["Proxy port"], "40000");
});

test("deriveProxyPort and isProxyOperatingMode handle real warp-cli strings", () => {
  const settings = parseSettings("(user set)\tMode: WarpProxy on port 40000");
  assert.equal(deriveProxyPort(settings), "40000");
  assert.equal(isProxyOperatingMode(settings.Mode), true);
  assert.equal(isProxyOperatingMode("warp"), false);
});

test("local network access never treats denials or failures as allowed", () => {
  assert.equal(deriveLocalNetworkAccess("Access denied"), "blocked");
  assert.equal(deriveLocalNetworkAccess("Local network access is not allowed"), "blocked");
  assert.equal(deriveLocalNetworkAccess("Error: unable to grant access"), "unknown");
  assert.equal(deriveLocalNetworkAccess("Access status unavailable"), "unknown");
});

test("proxy port parsing accepts all valid ports and rejects malformed or truncated values", () => {
  assert.equal(deriveProxyPort({ Mode: "WarpProxy on port 9" }), "9");
  assert.equal(deriveProxyPort({ Mode: "WarpProxy on port 65535" }), "65535");
  for (const value of ["0", "65536", "999999", "40000evil", "-1", "4.5", "unknown"]) {
    assert.equal(deriveProxyPort({ "Proxy port": value }), null);
    assert.equal(deriveProxyPort({ Mode: `WarpProxy on port ${value}` }), null);
  }
  const enriched = enrichSettings({ "Disabled for Wifi": "unknown", "Disabled for Ethernet": "false" });
  assert.equal(enriched["Wi-Fi WARP"], undefined);
  assert.equal(enriched["Ethernet WARP"], "keep");
});
