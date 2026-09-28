# curl cookbook

Start daemon:

```bash
thirdflare --no-open
```

Reading is open to anything on this computer. Anything that **changes** state needs the local session credential, so load it once per shell:

```bash
SESSION=$(cat ~/.config/thirdflare/session-4173.token)
```

See [endpoints](./endpoints.md#requests-that-change-something) for the full rules.

## Health & version

```bash
curl -s http://127.0.0.1:4173/api/health | jq
curl -s http://127.0.0.1:4173/api/version | jq
```

## Status snapshot

```bash
curl -s http://127.0.0.1:4173/api/snapshot | jq '.status'
curl -s http://127.0.0.1:4173/api/account | jq
```

## Connect / disconnect

```bash
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"action":"connect"}'

curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"action":"disconnect"}'
```

## Mode & protocol

```bash
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"action":"setMode","value":"warp"}'

curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"action":"setProtocol","value":"MASQUE"}'
```

## Kill switch

```bash
curl -s http://127.0.0.1:4173/api/killswitch | jq

curl -X POST http://127.0.0.1:4173/api/killswitch \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"enabled":true,"allowLan":false}'
```

## Config session override

```bash
curl -s http://127.0.0.1:4173/api/config | jq

curl -X POST http://127.0.0.1:4173/api/config/session \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"webui":{"enabled":true}}'
```

## Command log

```bash
curl -s 'http://127.0.0.1:4173/api/logs?since=0' | jq '.entries[-5:]'
```

## Live events (SSE)

```bash
curl -N http://127.0.0.1:4173/api/events
```

## App routing shortcut

```bash
curl -s http://127.0.0.1:4173/api/apps | jq
curl -X POST http://127.0.0.1:4173/api/apps/proxy-launcher \
  -H 'Content-Type: application/json' -H "x-thirdflare-session: $SESSION" \
  -d '{"appId":"firefox"}'
```

## Updates

```bash
curl -s http://127.0.0.1:4173/api/update/check | jq
```
