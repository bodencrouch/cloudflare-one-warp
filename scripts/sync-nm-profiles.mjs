#!/usr/bin/env node
/** Write Cloudflare One WARP NetworkManager keyfiles to share + user directories. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { allProfileKeyfiles } from "../lib/networkmanager/profiles.mjs";

const shareDir = process.env.CLOUDFLARE_ONE_WARP_NM_SHARE;
const userDir = process.env.CLOUDFLARE_ONE_WARP_NM_USER;

if (!shareDir || !userDir) {
  console.error("sync-nm-profiles: set CLOUDFLARE_ONE_WARP_NM_SHARE and CLOUDFLARE_ONE_WARP_NM_USER");
  process.exit(1);
}

await mkdir(shareDir, { recursive: true });
await mkdir(userDir, { recursive: true });

for (const { filename, content } of allProfileKeyfiles()) {
  await writeFile(join(shareDir, filename), content, { mode: 0o644 });
  await writeFile(join(userDir, filename), content, { mode: 0o600 });
}

console.log(`Installed ${allProfileKeyfiles().length} profiles to ${userDir}`);
