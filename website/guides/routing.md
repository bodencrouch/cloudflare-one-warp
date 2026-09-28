# Split tunnel & app routing

ThirdFlare One exposes warp-cli split tunnel reads/actions via API and UI, plus **desktop app shortcuts** for local proxy routing.

## Split tunnel API

```bash
curl -s http://127.0.0.1:4173/api/snapshot | jq '.commands.splitTunnelDump'
curl -s http://127.0.0.1:4173/api/snapshot | jq '.commands.splitTunnelIps'
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' \
  -H "x-thirdflare-session: $(cat ~/.config/thirdflare/session-4173.token)" \
  -d '{"action":"resetSplitIps"}'
```

Host/route lists follow warp-cli semantics.

## Local proxy mode

When local proxy is enabled, apps can be launched through a SOCKS/HTTP proxy without system-wide VPN routing.

The UI **Enable local proxy** action:

1. Turns on proxy settings via API
2. Opens the Console tab for visibility
3. Offers `.desktop` shortcuts for common apps (`lib/apps/proxy-launcher.mjs`)

## Copy & UX

User-facing strings use plain language — workarounds over vendor limitation lectures. App routing is presented as actionable steps, not policy disclaimers.

## Tests

- `scripts/ci-split-tunnel.test.mjs`
- `scripts/ci-proxy-launcher.test.mjs`
