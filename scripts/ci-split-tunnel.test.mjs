import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrichSplitTunnel,
  parseRouteList,
  parseManagedByDashboard,
  parseSplitTunnelMode
} from "../lib/warp/split-tunnel.mjs";

test("parseRouteList splits newline output and skips errors", () => {
  assert.deepEqual(parseRouteList("10.0.0.0/8\n192.168.1.0/24\n"), ["10.0.0.0/8", "192.168.1.0/24"]);
  assert.deepEqual(parseRouteList("Error: WARP is not connected."), []);
});

test("parseSplitTunnelMode reads exclude and include dumps", () => {
  assert.equal(parseSplitTunnelMode("Split tunnel mode: exclude\nIP routes:"), "exclude");
  assert.equal(parseSplitTunnelMode("Split tunnel mode: include\nroutes not included"), "include");
  assert.equal(parseSplitTunnelMode(""), "unknown");
});

test("enrichSplitTunnel merges dump, ips, and hosts", () => {
  const result = enrichSplitTunnel({
    dump: { stdout: "Split tunnel mode: exclude\nManaged by Cloudflare device profile" },
    ips: { stdout: "10.0.0.0/8\n" },
    hosts: { stdout: "example.com\n" }
  });
  assert.equal(result.mode, "exclude");
  assert.deepEqual(result.ips, ["10.0.0.0/8"]);
  assert.deepEqual(result.hosts, ["example.com"]);
  assert.equal(result.managedByDashboard, true);
  assert.match(result.managedHint, /device profile/i);
});


test("split policy parser respects explicit ownership values and rejects incidental prose", () => {
  for (const text of ["Managed: false", "Not managed by dashboard", "Unmanaged", "No device profile exists", "Error: dashboard unavailable"]) {
    assert.equal(parseManagedByDashboard(text), false);
  }
  for (const text of ["Managed: true", "Managed by Cloudflare device profile", "Source: dashboard", "Managed by your organization"]) {
    assert.equal(parseManagedByDashboard(text), true);
  }
  assert.equal(parseManagedByDashboard("Managed: true\nManaged: false"), false);
  assert.equal(parseSplitTunnelMode("Error: mode: include-invalid"), "unknown");
  assert.equal(parseSplitTunnelMode("routes not included"), "unknown");
  assert.equal(parseSplitTunnelMode("Mode: include\nMode: exclude"), "exclude");
});
