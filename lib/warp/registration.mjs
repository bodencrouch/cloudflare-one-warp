/**
 * Parse warp-cli registration show / devices output (JSON preferred, text fallback).
 * @see https://developers.cloudflare.com/warp-client/get-started/linux/
 * @see https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/
 */

function scalarText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * @param {string} stdout
 * @returns {{ registered: boolean, accountType: string|null, accountId: string|null, deviceId: string|null, id: string|null, license: string|null, publicKey: string|null, managed: boolean|null, raw: object|null }}
 */
export function parseRegistrationShow(stdout = "") {
  const text = String(stdout || "").trim();
  const empty = {
    registered: false,
    accountType: null,
    accountId: null,
    deviceId: null,
    id: null,
    license: null,
    publicKey: null,
    managed: null,
    raw: null
  };

  if (!text) return empty;

  try {
    const json = JSON.parse(text);
    const obj = asObject(json);
    if (obj) {
      const account = asObject(obj.account) || {};
      const accountType = scalarText(account.type) || scalarText(obj.account_type);
      const registered = typeof obj.registered === "boolean" ? obj.registered : Boolean(
        scalarText(obj.device_id) || scalarText(obj.id) || scalarText(account.id) || accountType || scalarText(obj.public_key)
      );
      return {
        registered,
        accountType: accountType,
        accountId: scalarText(account.id),
        deviceId: scalarText(obj.device_id) || scalarText(obj.id),
        id: scalarText(obj.id),
        license: scalarText(account.license),
        publicKey: scalarText(obj.public_key),
        managed: typeof obj.managed === "boolean" ? obj.managed : null,
        raw: obj
      };
    }
  } catch {
    // fall through to text parsing
  }

  const field = (label) => {
    const match = text.match(new RegExp(`^[ \t]*${label}:[ \t]*([^\r\n]*)$`, "im"));
    return match ? scalarText(match[1]) : null;
  };

  const accountType = field("Account type");
  const deviceId = field("Device ID") || field("ID");
  const accountId = field("Account ID");
  const license = field("License");
  const publicKey = field("Public key");
  const registered = Boolean(accountType || deviceId || accountId || license);

  return {
    registered,
    accountType,
    accountId,
    deviceId,
    id: field("ID"),
    license,
    publicKey,
    managed: null,
    raw: null
  };
}

/**
 * @param {string} stdout
 * @returns {Array<{ deviceId: string|null, os: string|null, name: string|null, model: string|null, active: boolean|null }>}
 */
export function parseRegistrationDevices(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return [];

  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
      return json.filter((row) => asObject(row)).map((row) => {
        const obj = row;
        return {
          deviceId: scalarText(obj.device_id),
          os: scalarText(obj.os),
          name: scalarText(obj.name),
          model: scalarText(obj.model),
          active: typeof obj.active === "boolean" ? obj.active : null
        };
      });
    }
  } catch {
    // fall through
  }

  // Text fallback: one device block per "Device ID:" or similar
  const devices = [];
  const blocks = text.split(/\r?\n(?=[ \t]*(?:Device ID|ID):)/i).filter(Boolean);
  for (const block of blocks) {
    const field = (label) => {
      const match = block.match(new RegExp(`^[ \t]*${label}:[ \t]*([^\r\n]*)$`, "im"));
      return match ? scalarText(match[1]) : null;
    };
    const deviceId = field("Device ID") || field("ID");
    if (!deviceId && !field("OS")) continue;
    devices.push({
      deviceId,
      os: field("OS"),
      name: field("Name"),
      model: field("Model"),
      active: /^[ \t]*active:[ \t]*true[ \t]*$/im.test(block) ? true : /^[ \t]*active:[ \t]*false[ \t]*$/im.test(block) ? false : null
    });
  }
  return devices;
}

/**
 * @param {string} stdout
 * @returns {{ organization: string|null }}
 */
export function parseRegistrationOrganization(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return { organization: null };

  try {
    const json = JSON.parse(text);
    const obj = asObject(json);
    if (obj && "organization" in obj) {
      const org = scalarText(obj.organization);
      return { organization: accessPortalUrl(org) ? org : null };
    }
  } catch {
    // fall through
  }

  const match = text.match(/^[ \t]*Organization:[ \t]*([^\r\n]*)$/im);
  if (match) {
    const org = match[1].trim();
    return { organization: accessPortalUrl(org) ? org : null };
  }
  // Plain team name only
  if (accessPortalUrl(text)) {
    return { organization: text };
  }
  return { organization: null };
}

/** Free / consumer WARP (not Zero Trust). */
export function isConsumerAccount(registration) {
  const type = String(registration?.accountType || "").trim().toLowerCase();
  return type === "free" || type === "unlimited" || type === "warp+" || type === "warp";
}

/** Zero Trust / Cloudflare One managed registration. */
export function isZeroTrustAccount(registration) {
  const type = String(registration?.accountType || "").trim().toLowerCase();
  if (registration?.managed === true) return true;
  return ["team", "teams", "zerotrust", "corporate", "organization"].includes(type.replace(/[ _-]/g, ""));
}

export function accessPortalUrl(teamName) {
  const team = String(teamName || "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(team)) return null;
  return `https://${team}.cloudflareaccess.com/warp`;
}
