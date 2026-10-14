import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessPortalUrl,
  isConsumerAccount,
  isZeroTrustAccount,
  parseRegistrationDevices,
  parseRegistrationOrganization,
  parseRegistrationShow
} from "../lib/warp/registration.mjs";

test("parseRegistrationShow reads JSON free account", () => {
  const parsed = parseRegistrationShow(JSON.stringify({
    id: "dev-1",
    device_id: "dev-1",
    public_key: "pk",
    managed: false,
    account: { type: "free", id: "acct-1", license: "AAA-BBB-CCC" }
  }));
  assert.equal(parsed.registered, true);
  assert.equal(parsed.accountType, "free");
  assert.equal(parsed.license, "AAA-BBB-CCC");
  assert.equal(isConsumerAccount(parsed), true);
  assert.equal(isZeroTrustAccount(parsed), false);
});

test("parseRegistrationShow reads text fallback", () => {
  const parsed = parseRegistrationShow(`Account type: Free
Device ID: abc
License: KEY-1-2
Account ID: acct
`);
  assert.equal(parsed.registered, true);
  assert.equal(parsed.accountType, "Free");
  assert.equal(parsed.license, "KEY-1-2");
});

test("parseRegistrationDevices reads JSON array", () => {
  const devices = parseRegistrationDevices(JSON.stringify([
    { device_id: "d1", os: "Linux", name: "box", model: "x", active: true }
  ]));
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceId, "d1");
  assert.equal(devices[0].active, true);
});

test("parseRegistrationOrganization and portal URL", () => {
  assert.equal(parseRegistrationOrganization('{"organization":"acme"}').organization, "acme");
  assert.equal(accessPortalUrl("acme"), "https://acme.cloudflareaccess.com/warp");
  assert.equal(accessPortalUrl("bad team"), null);
});

test("managed registration is treated as Zero Trust", () => {
  const parsed = parseRegistrationShow(JSON.stringify({
    device_id: "d1",
    managed: true,
    account: { type: "team", id: "t1" }
  }));
  assert.equal(isZeroTrustAccount(parsed), true);
});


test("organization errors cannot be interpreted as team names", () => {
  for (const text of ["Error: This command is only available for organization accounts", "IPC connection refused", "Organization: Error: unavailable", '{"organization":"not a valid team"}', "<script>alert(1)</script>"]) {
    assert.equal(parseRegistrationOrganization(text).organization, null);
  }
  assert.equal(parseRegistrationOrganization("my-team").organization, "my-team");
});
