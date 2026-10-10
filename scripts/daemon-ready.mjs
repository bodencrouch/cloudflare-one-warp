import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:http";

const url = process.argv[2] || "http://127.0.0.1:4173/api/health";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readExpected() {
  let version = "";
  let apiRevision = null;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    version = String(pkg.version || "");
  } catch {
    version = "";
  }
  try {
    const source = readFileSync(join(root, "lib", "api-revision.mjs"), "utf8");
    const match = source.match(/API_REVISION\s*=\s*(\d+)/);
    apiRevision = match ? Number(match[1]) : null;
  } catch {
    apiRevision = null;
  }
  return { version, apiRevision };
}

const expected = readExpected();

const request = get(url, { timeout: 1500 }, (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }

    const appOk = payload?.app === "cloudflare-one-warp"
      || payload?.app === "cloudflare-one-warp"
      || payload?.app === "cloudflare-one-gui";
    const versionOk = !expected.version || payload?.version === expected.version;
    const revisionOk = expected.apiRevision == null
      || payload?.apiRevision === expected.apiRevision;

    if (response.statusCode === 200 && payload?.ok === true && appOk && versionOk && revisionOk) {
      process.exit(0);
    }
    process.exit(1);
  });
});

request.on("timeout", () => {
  request.destroy();
  process.exit(1);
});

request.on("error", () => {
  process.exit(1);
});
