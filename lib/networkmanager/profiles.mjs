/**
 * NetworkManager connection profiles for Cloudflare WARP (via warp-cli).
 * WARP uses the CloudflareWARP TUN — not a standard WireGuard peer config — so we
 * integrate through NM generic/VPN-style profiles + dispatcher scripts.
 */

import { randomUUID } from "node:crypto";

/** Stable UUIDs so reinstalls update the same profiles. */
export const PROFILE_UUIDS = {
  masque: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  wireguard: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  proxy: "c3d4e5f6-a7b8-9012-cdef-123456789012"
};

export const PROFILE_IDS = {
  masque: "Cloudflare One WARP (MASQUE)",
  wireguard: "Cloudflare One WARP (WireGuard)",
  proxy: "Cloudflare One WARP (Local proxy)"
};

export const PROFILE_SLUGS = {
  [PROFILE_IDS.masque]: "masque",
  [PROFILE_IDS.wireguard]: "wireguard",
  [PROFILE_IDS.proxy]: "proxy"
};

/** @typedef {{ id: string, slug: string, uuid: string, protocol: string, mode: string, proxyPort?: number, interfaceName: string, description: string }} WARPProfile */

export const WARP_PROFILES = [
  {
    id: PROFILE_IDS.masque,
    slug: "masque",
    uuid: PROFILE_UUIDS.masque,
    protocol: "MASQUE",
    mode: "warp",
    interfaceName: "CloudflareWARP",
    description: "Full tunnel through Cloudflare WARP using the MASQUE protocol (HTTP/3)."
  },
  {
    id: PROFILE_IDS.wireguard,
    slug: "wireguard",
    uuid: PROFILE_UUIDS.wireguard,
    protocol: "WireGuard",
    mode: "warp",
    interfaceName: "CloudflareWARP",
    description: "Full tunnel through Cloudflare WARP using the WireGuard protocol."
  },
  {
    id: PROFILE_IDS.proxy,
    slug: "proxy",
    uuid: PROFILE_UUIDS.proxy,
    protocol: "MASQUE",
    mode: "proxy",
    proxyPort: 40000,
    interfaceName: "CloudflareWARP",
    description: "Local proxy mode — only apps using the WARP shortcut or system proxy use the tunnel."
  }
];

/**
 * Build a NetworkManager keyfile for a WARP profile.
 * Uses generic connections bound to CloudflareWARP (created by warp-svc on connect).
 * @param {WARPProfile} profile
 */
export function buildNmKeyfile(profile) {
  const lines = [
    "[connection]",
    `id=${profile.id}`,
    `uuid=${profile.uuid}`,
    "type=generic",
    `interface-name=${profile.interfaceName}`,
    "autoconnect=false",
    "",
    "[generic]",
    "",
    "[ipv4]",
    "method=auto",
    "",
    "[ipv6]",
    "method=auto",
    "addr-gen-mode=default",
    ""
  ];
  return `${lines.join("\n")}\n`;
}

export function profileBySlug(slug) {
  return WARP_PROFILES.find((p) => p.slug === slug) || null;
}

export function profileById(id) {
  return WARP_PROFILES.find((p) => p.id === id) || null;
}

export function profileFromNmConnection(id) {
  return profileById(id) || null;
}

export function allProfileKeyfiles() {
  return WARP_PROFILES.map((profile) => ({
    filename: `Cloudflare One WARP-WARP-${profile.slug}.nmconnection`,
    profile,
    content: buildNmKeyfile(profile)
  }));
}

export function newProfileUuid() {
  return randomUUID();
}
