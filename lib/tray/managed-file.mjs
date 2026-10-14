/** Atomic tray integration files; preserve user-owned custom entries. */
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

function assertOwnedRegular(info, path, directory = false) {
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())
    || (process.getuid && info.uid !== process.getuid())) throw new Error(`Unsafe tray integration path: ${path}`);
}

export function readManagedCandidate(path) {
  let info;
  try { info = lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  assertOwnedRegular(info, path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    assertOwnedRegular(opened, path);
    if (opened.size > 65536) throw new Error(`Tray integration file is too large: ${path}`);
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}

export function writeManagedCandidate(path, content) {
  const parent = dirname(path);
  // Check the nearest existing directory before creating missing components.
  let existing = parent;
  while (true) {
    try { assertOwnedRegular(lstatSync(existing), existing, true); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; existing = dirname(existing); }
  }
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertOwnedRegular(lstatSync(parent), parent, true);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o644 });
    // Replace the directory entry without following any raced destination link.
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
