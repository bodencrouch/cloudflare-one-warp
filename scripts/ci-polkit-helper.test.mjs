import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildDisableScript, buildEnableScript } from "../lib/killswitch/rules.mjs";
import { validateNftScript } from "../lib/killswitch/nft-script-validate.mjs";

const helper = fileURLToPath(new URL("./cloudflare-one-warp-nft-apply", import.meta.url));

test("diagnostic validator accepts only exact canonical rule scripts", () => {
  for (const useDestroy of [true, false]) {
    assert.equal(validateNftScript(buildDisableScript({ useDestroy })).ok, true);
    for (const allowLan of [true, false]) {
      const script = buildEnableScript({ allowLan, useDestroy });
      assert.equal(validateNftScript(script).ok, true);
      for (const directive of ["flush ruleset", "include /tmp/evil", "table ip evil {}", "delete table inet other"]) {
        assert.equal(validateNftScript(`${script}\n${directive}`).ok, false);
      }
    }
  }
});

// Replace only the absolute nft executable in a temporary copy, never modify validation/rule code.
// This exercises production shell logic without touching the host firewall or requiring root.
function withHelper(callback) {
  const dir = mkdtempSync(join(tmpdir(), "warp-privileged-boundary-"));
  const capture = join(dir, "captured.nft");
  const nft = join(dir, "fake-nft");
  writeFileSync(nft, `#!/bin/bash\n[[ "$*" == '-f -' ]] || exit 9\n/bin/cat > '${capture}'\n`, { mode: 0o700 });
  const sandbox = join(dir, "helper");
  const source = readFileSync(helper, "utf8");
  assert.match(source, /export PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  writeFileSync(sandbox, source.replace("NFT=/usr/sbin/nft", `NFT='${nft}'`), { mode: 0o700 });
  try { callback({ dir, capture, sandbox }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("production helper emits exactly the canonical rules for every structured option", () => {
  withHelper(({ capture, sandbox }) => {
    for (const useDestroy of [true, false]) {
      for (const enabled of [true, false]) {
        for (const allowLan of [true, false]) {
          const result = spawnSync(sandbox, [enabled ? "enable" : "disable", String(allowLan), useDestroy ? "destroy" : "delete"], { encoding: "utf8" });
          assert.equal(result.status, 0, result.stderr);
          const expected = enabled ? buildEnableScript({ allowLan, useDestroy }) : buildDisableScript({ useDestroy });
          assert.equal(readFileSync(capture, "utf8"), expected);
        }
      }
    }
  });
});

test("production helper rejects caller files, directives, families, includes and extra arguments", () => {
  withHelper(({ dir, capture, sandbox }) => {
    const input = join(dir, "caller.nft");
    const evil = ["# cloudflare_one_warp_killswitch\nflush ruleset", "include /tmp/evil", "table ip other {}", "destroy table inet other"];
    for (const content of evil) {
      writeFileSync(input, content);
      for (const args of [["apply", input], ["remove", input], ["enable", "true", input], ["enable", content, "destroy"], ["disable", "false", "destroy", input]]) {
        const result = spawnSync(sandbox, args, { encoding: "utf8" });
        assert.equal(result.status, 2, result.stderr);
      }
    }
    assert.throws(() => readFileSync(capture), { code: "ENOENT" });
    // The old filename interface is rejected regardless of changes to the caller's file.
    writeFileSync(input, buildEnableScript());
    assert.equal(spawnSync(sandbox, ["apply", input]).status, 2);
    writeFileSync(input, "flush ruleset");
    assert.equal(spawnSync(sandbox, ["apply", input]).status, 2);
  });
});
