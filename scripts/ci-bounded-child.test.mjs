import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { runBoundedChild } from "../lib/http/bounded-child.mjs";

test("CLI ignoring SIGTERM cannot defeat its execution deadline", async () => {
  let child;
  const result = await runBoundedChild(() => {
    child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)']);
    return child;
  }, { timeout: 250 });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /execution deadline/);
  assert.equal(child.killed, true);
});

test("combined output budget kills a noisy CLI and settles once", async () => {
  const result = await runBoundedChild(() => spawn(process.execPath, ["-e", 'process.stdout.write("a".repeat(2048));setInterval(()=>{},1000)']), { maxOutput: 1024, timeout: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /output exceeded/);
  assert.equal(result.stdout, "");
});

test("normal completion retains exit code and output", async () => {
  const result = await runBoundedChild(() => spawn(process.execPath, ["-e", 'process.stdout.write("hello");process.stderr.write("warning")']));
  assert.deepEqual(result, { ok: true, code: 0, stdout: "hello", stderr: "warning" });
});

test("spawn failures are bounded results", async () => {
  const result = await runBoundedChild(() => spawn("/nonexistent-cloudflare-one-warp-cli"));
  assert.equal(result.ok, false);
  assert.match(result.stderr, /ENOENT/);
});

test("CLI output preserves UTF-8 characters split across pipe chunks", async () => {
  const script = 'const bytes=Buffer.from("€");process.stdout.write(bytes.subarray(0,1));setTimeout(()=>{process.stdout.write(bytes.subarray(1));},40);';
  const result = await runBoundedChild(() => spawn(process.execPath, ["-e", script]));
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "€");
});
