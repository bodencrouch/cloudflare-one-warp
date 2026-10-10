import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildDisableScript, buildEnableScript } from "../lib/killswitch/rules.mjs";
import { validateNftScript } from "../lib/killswitch/nft-script-validate.mjs";

const helper = fileURLToPath(new URL("../scripts/cloudflare-one-warp-nft-apply", import.meta.url));

test("validateNftScript accepts enable and disable scripts", () => {
  assert.equal(validateNftScript(buildEnableScript()).ok, true);
  assert.equal(validateNftScript(buildDisableScript()).ok, true);
});

test("validateNftScript rejects foreign tables", () => {
  const bad = `${buildEnableScript()}\ntable inet evil { chain output { type filter hook output priority 0; accept } }`;
  assert.equal(validateNftScript(bad).ok, false);
});

test("cloudflare-one-warp-nft-apply rejects invalid script", () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-nft-"));
  const file = join(dir, "bad.nft");
  writeFileSync(file, "table inet evil { }\n");
  const result = spawnSync(helper, ["apply", file], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("cloudflare-one-warp-nft-apply accepts kill switch script shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-one-warp-nft-"));
  const file = join(dir, "good.nft");
  writeFileSync(file, buildDisableScript());
  const result = spawnSync(helper, ["apply", file], { encoding: "utf8" });
  if (result.status === 0) {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  // Without root/nft the helper may fail after validation — stderr must not be "rejected script".
  assert.doesNotMatch(result.stderr || "", /rejected script/i);
  rmSync(dir, { recursive: true, force: true });
});
