/**
 * Parse warp-cli registration show / devices output (JSON preferred, text fallback).
 * @see https://developers.cloudflare.com/warp-client/get-started/linux/
 * @see https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/
 */

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
      const accountType = account.type || obj.account_type || null;
      const registered = Boolean(
        obj.device_id || obj.id || account.id || accountType || obj.public_key
      );
      return {
        registered,
        accountType: accountType ? String(accountType) : null,
        accountId: account.id ? String(account.id) : null,
        deviceId: obj.device_id ? String(obj.device_id) : obj.id ? String(obj.id) : null,
        id: obj.id ? String(obj.id) : null,
        license: account.license ? String(account.license) : null,
        publicKey: obj.public_key ? String(obj.public_key) : null,
        managed: typeof obj.managed === "boolean" ? obj.managed : null,
        raw: obj
      };
    }
  } catch {
    // fall through to text parsing
  }

  const field = (label) => {
    const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
    return match ? match[1].trim() : null;
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
      return json.map((row) => {
        const obj = asObject(row) || {};
        return {
          deviceId: obj.device_id ? String(obj.device_id) : null,
          os: obj.os ? String(obj.os) : null,
          name: obj.name ? String(obj.name) : null,
          model: obj.model ? String(obj.model) : null,
          active: typeof obj.active === "boolean" ? obj.active : null
        };
      });
    }
  } catch {
    // fall through
  }

  // Text fallback: one device block per "Device ID:" or similar
  const devices = [];
  const blocks = text.split(/\n(?=Device ID:)/i).filter(Boolean);
  for (const block of blocks) {
    const field = (label) => {
      const match = block.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
      return match ? match[1].trim() : null;
    };
    const deviceId = field("Device ID") || field("ID");
    if (!deviceId && !field("OS")) continue;
    devices.push({
      deviceId,
      os: field("OS"),
      name: field("Name"),
      model: field("Model"),
      active: /active:\s*true/i.test(block) ? true : /active:\s*false/i.test(block) ? false : null
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
      const org = String(obj.organization || "").trim();
      return { organization: accessPortalUrl(org) ? org : null };
    }
  } catch {
    // fall through
  }

  const match = text.match(/^Organization:\s*(.*)$/im);
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
  const type = String(registration?.accountType || "").toLowerCase();
  return type === "free" || type === "unlimited" || type === "warp+" || type === "warp";
}

/** Zero Trust / Cloudflare One managed registration. */
export function isZeroTrustAccount(registration) {
  const type = String(registration?.accountType || "").toLowerCase();
  if (registration?.managed === true) return true;
  return type.includes("team") || type.includes("zero") || type === "corporate" || type === "organization";
}

export function accessPortalUrl(teamName) {
  const team = String(teamName || "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(team)) return null;
  return `https://${team}.cloudflareaccess.com/warp`;
}
