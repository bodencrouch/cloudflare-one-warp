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

All API routes require a loopback socket peer, including read-only routes. `server.bind` accepts loopback addresses only; the legacy `webui.allowRemote` setting does not enable LAN diagnostics. Every API except health and version requires the owner’s private local session credential. Mutations additionally require JSON content type. An explicit trusted local tunnel is needed for remote administration.

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

## Browser access

Run `cloudflare-one-warp --webui` to open an authenticated tab through the launcher’s private HTML handoff. Visiting the HTTP address directly does not distribute a credential. The handoff fragment is consumed into tab session storage and immediately cleared; native tools read the owner-private token file.
