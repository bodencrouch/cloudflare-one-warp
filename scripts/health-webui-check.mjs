import { get } from "node:http";

const url = process.argv[2] || "http://127.0.0.1:4173/api/health";
const requireWebui = process.argv.includes("--require-webui");

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

    if (response.statusCode !== 200 || payload?.ok !== true || !appOk) {
      process.exit(1);
    }
    if (requireWebui && payload.webuiEnabled !== true) {
      process.exit(1);
    }
    process.exit(0);
  });
});

request.on("timeout", () => {
  request.destroy();
  process.exit(1);
});

request.on("error", () => {
  process.exit(1);
});
