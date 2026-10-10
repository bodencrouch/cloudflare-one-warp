# HTTP API

Local control plane on `127.0.0.1`. Default port **4173** (launcher scans up to 30 alternate ports if busy).

::: tip
Like [Tavily CLI](https://docs.tavily.com/documentation/tavily-cli) and [Firecrawl CLI](https://docs.firecrawl.dev/sdks/cli), automation goes through a stable HTTP surface — here guarding warp-cli instead of a cloud API key.
:::

## Base URL

```
http://127.0.0.1:4173
```

Confirm with:

```bash
curl -s http://127.0.0.1:4173/api/health | jq
```

## Design

- **Read-heavy**: `/api/snapshot`, `/api/account`, `/api/config`
- **Mutations**: `POST /api/action` with whitelisted `action` names only
- **No arbitrary shell** — `runCustom` still parses and validates args
- **Redaction** on registration IDs, keys, licenses in responses

## Authentication

Localhost-only by default (`server.bind`). Remote bind requires explicit config (`webui.allowRemote`) — not recommended without a reverse proxy and auth.

## OpenAPI

Contract file: `openapi/cloudflare-one-warp-api.json`. CI validates live responses in Plane M:

```bash
npm run test:openapi
```

## Sections

- [Endpoints](/api/endpoints)
- [Actions catalog](/api/actions)
- [curl cookbook](/api/cookbook)
- [OpenAPI details](/api/openapi)
