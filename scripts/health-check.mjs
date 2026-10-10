import { get } from "node:http";

const url = process.argv[2] || "http://127.0.0.1:4173/api/health";

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

    if (response.statusCode === 200 && payload?.ok === true && (
      payload?.app === "cloudflare-one-warp"
      || payload?.app === "cloudflare-one-warp"
      || payload?.app === "cloudflare-one-gui"
    )) {
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
