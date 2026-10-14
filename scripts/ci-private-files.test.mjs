import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertPrivateDirectory, assertPrivateFile, ensurePrivateDirectory, ensurePrivateFile } from "../lib/security/private-files.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "warp-private-storage-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("POSIX private storage uses owner-only directory and file permissions", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  const directory = join(root, "credentials");
  ensurePrivateDirectory(directory);
  const file = join(directory, "credential");
  writeFileSync(file, "test credential", { mode: 0o666, flag: "wx" });
  ensurePrivateFile(file, { created: true });
  assertPrivateDirectory(directory);
  assertPrivateFile(file);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  chmodSync(file, 0o644);
  assert.throws(() => assertPrivateFile(file), /permissions are unsafe/);
});

test("Windows private storage verifies native owner SID and protected DACL", { skip: process.platform !== "win32" }, t => {
  const root = fixture(t);
  const directory = join(root, "credential ' $ (data)");
  ensurePrivateDirectory(directory);
  const file = join(directory, "session.token");
  writeFileSync(file, "test credential", { flag: "wx" });
  ensurePrivateFile(file, { created: true });
  assertPrivateDirectory(directory);
  assertPrivateFile(file);
  const execute = script => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, WARP_ACL_TEST_FILE: file }, timeout: 5000, windowsHide: true, encoding: "utf8"
  });
  const acl = JSON.parse(execute(String.raw`
$a = Get-Acl -LiteralPath $env:WARP_ACL_TEST_FILE
[pscustomobject]@{ owner = $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; protected = $a.AreAccessRulesProtected; principals = @($a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }) } | ConvertTo-Json -Compress
`));
  assert.equal(acl.owner, acl.current);
  assert.equal(acl.protected, true);
  assert.deepEqual(new Set(acl.principals), new Set([acl.current, "S-1-5-18", "S-1-5-32-544"]));
  execute(String.raw`
$a = Get-Acl -LiteralPath $env:WARP_ACL_TEST_FILE
$r = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'), [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Allow)
$a.AddAccessRule($r)
Set-Acl -LiteralPath $env:WARP_ACL_TEST_FILE -AclObject $a
`);
  assert.throws(() => assertPrivateFile(file), /private ACL could not be verified/);
  ensurePrivateFile(file);
  assertPrivateFile(file);
});
