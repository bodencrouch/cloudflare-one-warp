/** Owner credential storage: POSIX permissions or native Windows owner/DACL. */
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";

// Path and operation are environment data, never interpolated into executable code.
const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:CLOUDFLARE_PRIVATE_PATH
$item = Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points cannot store credentials' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $path
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
if ($owner.Value -ne $sid.Value) {
  if ($env:CLOUDFLARE_PRIVATE_CREATED -eq 'true' -and $env:CLOUDFLARE_PRIVATE_OPERATION -eq 'ensure' -and $owner.Value -eq 'S-1-5-32-544') {
    # Elevated Windows processes can default the owner of a freshly created file
    # to Administrators. Explicit wx/new mkdir proof permits correcting only that
    # fresh path, never adopting an existing credential owned by another user.
    $acl.SetOwner($sid)
  } else { throw 'Credential path belongs to another user' }
}
$allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($env:CLOUDFLARE_PRIVATE_OPERATION -eq 'ensure') {
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
  if ($item.PSIsContainer) { $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
  foreach ($identity in $allowed) {
    $principal = [System.Security.Principal.SecurityIdentifier]::new($identity)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $path -AclObject $acl
  $acl = Get-Acl -LiteralPath $path
}
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Credential owner could not be secured' }
if (-not $acl.AreAccessRulesProtected) { throw 'Credential ACL inherits access from another directory' }
$ownerAllowed = $false
foreach ($rule in $acl.Access) {
  $identity = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($identity -notin $allowed -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw 'Credential ACL grants access to another principal' }
  if ($identity -eq $sid.Value -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $ownerAllowed = $true }
}
if (-not $ownerAllowed) { throw 'Credential owner lacks full access' }
`;

function checkTypeAndOwner(path, directory) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
    throw new Error("Unsafe private credential path.");
  }
  if (process.platform !== "win32" && process.getuid && info.uid !== process.getuid()) {
    throw new Error("Private credential path belongs to another user.");
  }
  return info;
}

function windowsPrivacy(path, ensure, created) {
  try {
    execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL_SCRIPT], {
      env: { ...process.env, CLOUDFLARE_PRIVATE_PATH: path, CLOUDFLARE_PRIVATE_OPERATION: ensure ? "ensure" : "assert", CLOUDFLARE_PRIVATE_CREATED: created ? "true" : "false" },
      timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    throw new Error("Windows credential owner or private ACL could not be verified.");
  }
}

function privacy(path, directory, ensure, created = false) {
  const info = checkTypeAndOwner(path, directory);
  if (process.platform === "win32") return windowsPrivacy(path, ensure, created);
  const mode = directory ? 0o700 : 0o600;
  if (ensure) chmodSync(path, mode);
  else if ((info.mode & 0o777) !== mode) throw new Error("Private credential permissions are unsafe.");
}

export function ensurePrivateDirectory(path, { create = true } = {}) {
  let created = false;
  if (create) {
    try { lstatSync(path); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Create ancestors separately; only an exclusive leaf mkdir proves the
      // dedicated credential directory was freshly created by this process.
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try { mkdirSync(path, { mode: 0o700 }); created = true; }
      catch (mkdirError) { if (mkdirError.code !== "EEXIST") throw mkdirError; }
    }
  }
  privacy(path, true, true, created);
}
export function assertPrivateDirectory(path) { privacy(path, true, false); }
/** created:true is reserved for a file this caller just created using exclusive wx. */
export function ensurePrivateFile(path, { created = false } = {}) { privacy(path, false, true, created); }
export function assertPrivateFile(path) { privacy(path, false, false); }
