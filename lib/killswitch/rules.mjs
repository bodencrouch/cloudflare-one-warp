/**
 * nftables kill-switch rules for Cloudflare WARP (CloudflareWARP iface).
 * Blocks outbound traffic that is not loopback, the WARP tunnel, or known
 * Cloudflare One Client bootstrap / ingress destinations so a tunnel drop
 * cannot leak the real IP.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/firewall/
 */

export const KILLSWITCH_TABLE = "cloudflare_one_warp_killswitch";
export const WARP_INTERFACE = "CloudflareWARP";

/** IPv4 destinations required to (re)connect WARP / DoH / orchestration. */
export const BOOTSTRAP_V4 = [
  "162.159.192.0/24",
  "162.159.193.0/24",
  "162.159.197.0/24",
  "162.159.137.105",
  "162.159.138.105",
  "162.159.36.1",
  "162.159.46.1"
];

/** IPv6 destinations required to (re)connect WARP / DoH / orchestration. */
export const BOOTSTRAP_V6 = [
  "2606:4700:100::/48",
  "2606:4700:102::/48",
  "2606:4700:7::a29f:8969",
  "2606:4700:7::a29f:8a69",
  "2606:4700:4700::1111",
  "2606:4700:4700::1001"
];

/**
 * @param {{ allowLan?: boolean, useDestroy?: boolean }} [options]
 * @returns {string}
 */
export function buildEnableScript(options = {}) {
  const allowLan = Boolean(options.allowLan);
  const useDestroy = options.useDestroy !== false;
  const v4 = BOOTSTRAP_V4.join(", ");
  const v6 = BOOTSTRAP_V6.join(", ");

  const preamble = useDestroy
    ? `destroy table inet ${KILLSWITCH_TABLE}\n`
    : `table inet ${KILLSWITCH_TABLE}\ndelete table inet ${KILLSWITCH_TABLE}\n`;

  const lanRules = allowLan
    ? `
    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 } accept
    ip6 daddr { fc00::/7, fe80::/10 } accept
`
    : "";

  return `# Cloudflare One WARP kill switch
${preamble}table inet ${KILLSWITCH_TABLE} {
  chain output {
    type filter hook output priority filter; policy drop;

    oifname "lo" accept
    oifname "${WARP_INTERFACE}" accept

    # Link-local network control only; never permit general cleartext DNS.
    ip daddr 255.255.255.255 udp sport 68 udp dport 67 accept
    ip6 daddr ff02::1:2 udp sport 546 udp dport 547 accept
    ip6 hoplimit 255 icmpv6 type { nd-router-solicit, nd-neighbor-solicit, nd-neighbor-advert } accept

    ip daddr { ${v4} } tcp dport 443 accept
    ip daddr { ${v4} } udp dport { 443, 500, 1701, 2408, 4500 } accept
    ip6 daddr { ${v6} } tcp dport 443 accept
    ip6 daddr { ${v6} } udp dport { 443, 500, 1701, 2408, 4500 } accept
${lanRules}  }
}
`;
}

/**
 * @param {{ useDestroy?: boolean }} [options]
 * @returns {string}
 */
export function buildDisableScript(options = {}) {
  const useDestroy = options.useDestroy !== false;
  if (useDestroy) {
    return `# Cloudflare One WARP kill switch — disable
destroy table inet ${KILLSWITCH_TABLE}
`;
  }
  return `# Cloudflare One WARP kill switch — disable
table inet ${KILLSWITCH_TABLE}
delete table inet ${KILLSWITCH_TABLE}
`;
}
