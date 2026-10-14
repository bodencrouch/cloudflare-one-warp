# curl cookbook

Start daemon:

```bash
cloudflare-one-warp --no-open
```

Only health and version are public. All other API requests require the owner’s private local session credential. Load it once per shell:

```bash
SESSION=$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")
```

See [endpoints](./endpoints.md#requests-that-change-something) for the full rules.

## Health & version

```bash
curl -s http://127.0.0.1:4173/api/health | jq
curl -s http://127.0.0.1:4173/api/version | jq
```

## Status snapshot

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/snapshot | jq '.status'
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/account | jq
```

## Connect / disconnect

```bash
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"action":"connect"}'

curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"action":"disconnect"}'
```

## Mode & protocol

```bash
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"action":"setMode","value":"warp"}'

curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"action":"setProtocol","value":"MASQUE"}'
```

## Kill switch

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/killswitch | jq

curl -X POST http://127.0.0.1:4173/api/killswitch \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"enabled":true,"allowLan":false}'
```

## Config session override

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/config | jq

curl -X POST http://127.0.0.1:4173/api/config/session \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"webui":{"enabled":true}}'
```

## Command log

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s 'http://127.0.0.1:4173/api/logs?since=0' | jq '.entries[-5:]'
```

## Live events (SSE)

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -N http://127.0.0.1:4173/api/events
```

## App routing shortcut

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/apps | jq
curl -X POST http://127.0.0.1:4173/api/apps/proxy-launcher \
  -H 'Content-Type: application/json' -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"appId":"firefox"}'
```

## Updates

```bash
curl -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" -s http://127.0.0.1:4173/api/update/check | jq
```
