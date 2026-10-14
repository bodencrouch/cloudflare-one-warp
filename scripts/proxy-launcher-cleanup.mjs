#!/usr/bin/env node
import { cleanupOwnedProxyLaunchers } from "../lib/apps/proxy-launcher.mjs";

try {
  const result = await cleanupOwnedProxyLaunchers();
  if (!result.ok) {
    console.error(`Proxy shortcut cleanup skipped: ${result.error}`);
    process.exitCode = 1;
  } else {
    console.log(`Removed ${result.removed.length} unchanged Cloudflare One WARP proxy shortcut pair(s).`);
  }
} catch (error) {
  console.error(`Proxy shortcut cleanup failed: ${error.message}`);
  process.exitCode = 1;
}
