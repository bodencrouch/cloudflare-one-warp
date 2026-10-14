import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const posix = { skip: process.platform === "win32" ? "POSIX operator entrypoint" : false };

test("operator defaults consume the command and npm receives forwarded arguments literally", posix, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warp-operator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile(new URL("../cloudflare-one-warp", import.meta.url), join(root, "cloudflare-one-warp"));
  await mkdir(join(root, "fake-bin"));
  await mkdir(join(root, "packaging", "scripts"), { recursive: true });
  const recorder = '#!/bin/sh\nprintf "%s\\n" "$@"\n';
  await writeFile(join(root, "fake-bin", "npm"), recorder);
  await chmod(join(root, "fake-bin", "npm"), 0o755);
  await writeFile(join(root, "packaging", "scripts", "build-appimage.sh"), recorder);
  const invoke = args => execFileSync("bash", [join(root, "cloudflare-one-warp"), ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `${join(root, "fake-bin")}:${process.env.PATH}` }
  });
  assert.equal(invoke(["test"]), "run\ntest:all\n--\n");
  assert.equal(invoke(["build"]), "\n");
  assert.equal(invoke(["test", "integration", "--test-name-pattern", "a $(literal) b"]), "run\ntest:integration\n--\n--test-name-pattern\na $(literal) b\n");
  assert.equal(invoke(["dev", "--flag=value with spaces"]), "run\ndev\n--\n--flag=value with spaces\n");
  assert.throws(() => invoke(["test", "not-a-suite"]), { status: 2 });
});
