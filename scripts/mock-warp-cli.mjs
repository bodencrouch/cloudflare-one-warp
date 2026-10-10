#!/usr/bin/env node
/**
 * Portable stateful mock for warp-cli (Plane M CI).
 * State file: MOCK_WARP_STATE or os.tmpdir()/cloudflare-one-warp-mock-warp-$uid.json
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_PATH =
  process.env.MOCK_WARP_STATE || join(tmpdir(), `cloudflare-one-warp-mock-warp-${process.getuid?.() ?? "ci"}.json`);

function defaultState() {
  return {
    connected: false,
    mode: "warp",
    protocol: "MASQUE",
    families: "off",
    masqueOptions: "h3-with-h2-fallback",
    proxyPort: "40000",
    vnet: "mock-vnet",
    gatewayId: "mock-gateway-id",
    endpoint: "",
    registered: true,
    organization: "",
    accountType: "free",
    accountId: "mock-account-id",
    deviceId: "mock-device-id",
    license: "MOCKKEY1-MOCKKEY2-MOCKKEY3",
    publicKey: "mock-public-key",
    managed: false,
    splitIps: ["10.0.0.0/8"],
    splitHosts: ["example.com"],
    splitMode: "exclude",
    trustedSsids: [],
    dnsFallbacks: ["1.1.1.1"],
    dnsLog: false,
    disabledForWifi: false,
    disabledForEthernet: false,
    localNetworkAccess: false,
    environment: "Normal",
    devices: [
      {
        device_id: "mock-device-id",
        os: "Linux",
        name: "ci-host",
        model: "Mock Hardware",
        active: true
      }
    ]
  };
}

function loadState() {
  if (!existsSync(STATE_PATH)) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(readFileSync(STATE_PATH, "utf8")) };
  } catch {
    // Prefer last good write: retry once after brief settle, else defaults.
    try {
      return { ...defaultState(), ...JSON.parse(readFileSync(STATE_PATH, "utf8")) };
    } catch {
      return defaultState();
    }
  }
}

function saveState(state) {
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

function parseArgs(argv) {
  const args = [];
  let json = false;
  let listen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-ansi" || a === "--no-paginate" || a === "--accept-tos") continue;
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--listen") {
      listen = true;
      continue;
    }
    args.push(a);
  }
  return { args, json, listen };
}

function statusText(state) {
  const status = state.connected ? "Connected" : "Disconnected";
  return `Status update: ${status}\nNetwork: healthy\n`;
}

function settingsText(state) {
  const modeLine = state.mode === "proxy"
    ? `Mode: WarpProxy on port ${state.proxyPort || "40000"}`
    : `Mode: ${state.mode}`;
  return [
    modeLine,
    `Gateway ID: ${state.gatewayId || "(none)"}`,
    `Support URL: https://example.com/support`,
    `WARP tunnel protocol: ${state.protocol}`,
    `Protocol: ${state.protocol}`,
    `DNS Families: ${state.families}`,
    `DNS logging: ${state.dnsLog ? "enabled" : "disabled"}`,
    `MASQUE options: ${state.masqueOptions}`,
    `Compliance Environment: ${state.environment}`,
    `Disabled for Wifi: ${Boolean(state.disabledForWifi)}`,
    `Disabled for Ethernet: ${Boolean(state.disabledForEthernet)}`
  ].join("\n");
}

function registrationShow(state, asJson) {
  if (!state.registered) {
    return asJson ? "{}" : "Registration missing\n";
  }
  if (asJson) {
    return JSON.stringify(
      {
        id: state.deviceId,
        device_id: state.deviceId,
        public_key: state.publicKey,
        managed: state.managed,
        account: {
          type: state.accountType,
          id: state.accountId,
          license: state.license
        },
        alternate_networks: []
      },
      null,
      2
    );
  }
  return [
    `Account type: ${state.accountType === "free" ? "Free" : state.accountType}`,
    `ID: ${state.deviceId}`,
    `Device ID: ${state.deviceId}`,
    `Public key: ${state.publicKey}`,
    `Account ID: ${state.accountId}`,
    `License: ${state.license}`
  ].join("\n");
}

function organizationShow(state, asJson) {
  if (asJson) {
    return JSON.stringify({ organization: state.organization || "" });
  }
  return `Organization: ${state.organization || ""}`;
}

function devicesShow(state, asJson) {
  if (asJson) return JSON.stringify(state.devices, null, 2);
  return state.devices
    .map(
      (d) =>
        `Device ID: ${d.device_id}\nOS: ${d.os}\nName: ${d.name}\nActive: ${d.active}`
    )
    .join("\n\n");
}

function ok() {
  return "Success";
}

function main(argv = process.argv.slice(2)) {
  const { args, json, listen } = parseArgs(argv);
  const cmd = args[0] || "status";
  const sub = args[1] || "";
  const sub2 = args[2] || "";
  const sub3 = args[3] || "";
  const sub4 = args[4] || "";
  let state = loadState();

  if (listen && cmd === "status") {
    process.stdout.write(statusText(state));
    setInterval(() => {}, 3600_000);
    return;
  }

  let out = "ok";

  switch (cmd) {
    case "status":
      out = statusText(state);
      break;
    case "connect":
      state.connected = true;
      saveState(state);
      out = ok();
      break;
    case "disconnect":
      state.connected = false;
      saveState(state);
      out = ok();
      break;
    case "mode":
      if (sub) {
        state.mode = sub;
        saveState(state);
        out = ok();
      } else {
        out = state.mode;
      }
      break;
    case "settings":
      if (sub === "list") out = settingsText(state);
      else if (sub === "support-url") out = "https://example.com/support";
      else if (sub === "mode-switch-allowed") out = "true";
      else if (sub === "reset") {
        state.mode = "warp";
        state.families = "off";
        saveState(state);
        out = ok();
      } else out = ok();
      break;
    case "registration":
      if (sub === "show") out = registrationShow(state, json);
      else if (sub === "organization") {
        if (sub2 === "new" && sub3) {
          state.organization = sub3;
          state.accountType = "team";
          state.registered = true;
          saveState(state);
          out = ok();
        } else {
          out = organizationShow(state, json);
        }
      } else if (sub === "devices") out = devicesShow(state, json);
      else if (sub === "new") {
        state.registered = true;
        if (sub2) {
          state.organization = sub2;
          state.accountType = "team";
        } else {
          state.accountType = "free";
          state.organization = "";
          state.license = "MOCKKEY1-MOCKKEY2-MOCKKEY3";
        }
        state.deviceId = state.deviceId || "mock-device-id";
        saveState(state);
        out = ok();
      } else if (sub === "delete") {
        state.registered = false;
        state.organization = "";
        state.license = "";
        state.connected = false;
        saveState(state);
        out = ok();
      } else if (sub === "license" && sub2) {
        state.license = sub2;
        state.registered = true;
        saveState(state);
        out = ok();
      } else if (sub === "token" && sub2) {
        state.registered = true;
        state.accountType = "team";
        saveState(state);
        out = ok();
      } else out = ok();
      break;
    case "stats":
      out = "Bytes sent: 0";
      break;
    case "tunnel":
      if (sub === "stats") out = "Tunnel bytes: 0";
      else if (sub === "dump") {
        out = [
          `Split tunnel mode: ${state.splitMode || "exclude"}`,
          state.managed ? "Managed by Cloudflare device profile" : "Local consumer configuration",
          "IP routes:",
          ...state.splitIps.map((ip) => `  ${ip}`),
          "Host routes:",
          ...state.splitHosts.map((host) => `  ${host}`)
        ].join("\n");
      }
      else if (sub === "protocol") {
        if (sub2 === "set" && sub3) {
          state.protocol = sub3;
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.protocol = "MASQUE";
          saveState(state);
          out = ok();
        } else out = state.protocol;
      } else if (sub === "masque-options") {
        if (sub2 === "set" && sub3) {
          state.masqueOptions = sub3;
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.masqueOptions = "h3-with-h2-fallback";
          saveState(state);
          out = ok();
        } else out = state.masqueOptions;
      } else if (sub === "endpoint") {
        if (sub2 === "set" && sub3) {
          state.endpoint = sub3;
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.endpoint = "";
          saveState(state);
          out = ok();
        } else out = state.endpoint || "(default)";
      } else if (sub === "rotate-keys") out = ok();
      else if (sub === "ip") {
        if (sub2 === "list") out = state.splitIps.join("\n") || "";
        else if (sub2 === "add" && sub3) {
          if (!state.splitIps.includes(sub3)) state.splitIps.push(sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "remove" && sub3) {
          state.splitIps = state.splitIps.filter((x) => x !== sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "add-range" && sub3) {
          const range = sub4 ? `${sub3}-${sub4}` : sub3;
          if (!state.splitIps.includes(range)) state.splitIps.push(range);
          saveState(state);
          out = ok();
        } else if (sub2 === "remove-range" && sub3) {
          const range = sub4 ? `${sub3}-${sub4}` : sub3;
          state.splitIps = state.splitIps.filter((x) => x !== range);
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.splitIps = [];
          saveState(state);
          out = ok();
        } else out = ok();
      } else if (sub === "host") {
        if (sub2 === "list") out = state.splitHosts.join("\n") || "";
        else if (sub2 === "add" && sub3) {
          if (!state.splitHosts.includes(sub3)) state.splitHosts.push(sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "remove" && sub3) {
          state.splitHosts = state.splitHosts.filter((x) => x !== sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.splitHosts = [];
          saveState(state);
          out = ok();
        } else out = ok();
      } else out = ok();
      break;
    case "dns":
      if (sub === "stats") out = "DNS queries: 0";
      else if (sub === "fallback") {
        if (sub2 === "list") out = state.dnsFallbacks.join("\n") || "";
        else if (sub2 === "add" && sub3) {
          if (!state.dnsFallbacks.includes(sub3)) state.dnsFallbacks.push(sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "remove" && sub3) {
          state.dnsFallbacks = state.dnsFallbacks.filter((x) => x !== sub3);
          saveState(state);
          out = ok();
        } else out = ok();
      } else if (sub === "default-fallbacks") out = "1.0.0.1";
      else if (sub === "families" && sub2) {
        state.families = sub2;
        saveState(state);
        out = ok();
      } else if (sub === "gateway-id") {
        if (sub2 === "set" && sub3) {
          state.gatewayId = sub3;
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.gatewayId = "";
          saveState(state);
          out = ok();
        } else out = state.gatewayId;
      } else if (sub === "log") {
        state.dnsLog = sub2 === "enable";
        saveState(state);
        out = ok();
      } else out = ok();
      break;
    case "proxy":
      if (sub === "port" && sub2) {
        state.proxyPort = sub2;
        saveState(state);
        out = ok();
      } else out = ok();
      break;
    case "vnet":
      if (sub) {
        state.vnet = sub;
        saveState(state);
        out = ok();
      } else out = state.vnet;
      break;
    case "target":
      out = sub === "list" ? "mock-target" : ok();
      break;
    case "mdm":
      out = "mock-mdm";
      break;
    case "override":
      if (sub === "local-network") {
        if (sub2 === "show") {
          out = state.localNetworkAccess
            ? "Local network access is allowed"
            : "No current access to local network";
        } else if (sub2 === "allow") {
          state.localNetworkAccess = true;
          saveState(state);
          out = ok();
        } else if (sub2 === "stop") {
          state.localNetworkAccess = false;
          saveState(state);
          out = ok();
        } else out = ok();
      } else out = "override: none";
      break;
    case "trusted":
      if (sub === "wifi") {
        if (sub2 === "enable") {
          state.disabledForWifi = true;
          saveState(state);
          out = ok();
        } else if (sub2 === "disable") {
          state.disabledForWifi = false;
          saveState(state);
          out = ok();
        } else out = ok();
      } else if (sub === "ethernet") {
        if (sub2 === "enable") {
          state.disabledForEthernet = true;
          saveState(state);
          out = ok();
        } else if (sub2 === "disable") {
          state.disabledForEthernet = false;
          saveState(state);
          out = ok();
        } else out = ok();
      } else if (sub === "ssid") {
        if (sub2 === "list") out = state.trustedSsids.join("\n") || "";
        else if (sub2 === "add" && sub3) {
          if (!state.trustedSsids.includes(sub3)) state.trustedSsids.push(sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "remove" && sub3) {
          state.trustedSsids = state.trustedSsids.filter((x) => x !== sub3);
          saveState(state);
          out = ok();
        } else if (sub2 === "reset") {
          state.trustedSsids = [];
          saveState(state);
          out = ok();
        } else out = ok();
      } else out = ok();
      break;
    case "environment":
      if (sub === "set" && sub2) {
        state.environment = sub2;
        saveState(state);
        out = ok();
      } else if (sub === "reset") {
        state.environment = "Normal";
        saveState(state);
        out = ok();
      } else out = state.environment;
      break;
    case "debug":
      if (sub === "network") {
        out = [
          "Interface: eth0",
          "DNS servers: 1.1.1.1, 1.0.0.1",
          "Resolver: systemd-resolved",
          "Connectivity: ok"
        ].join("\n");
      } else if (sub === "posture") out = "posture: ok";
      else if (sub === "alternate-network") out = "alternate: none";
      else if (sub === "dex") out = "dex: ok";
      else if (sub === "access-reauth") out = ok();
      else out = ok();
      break;
    case "certs":
      out = "mock-cert";
      break;
    case "mock-reset":
      try {
        unlinkSync(STATE_PATH);
      } catch {
        /* ignore */
      }
      out = ok();
      break;
    default:
      out = ok();
  }

  process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
}

export { defaultState, loadState, saveState, parseArgs, main, STATE_PATH };

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("mock-warp-cli.mjs") || process.argv[1].endsWith("mock-warp-cli"));

if (isDirect) {
  main();
}
