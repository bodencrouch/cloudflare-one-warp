# API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/session` | Session credential for local clients |
| GET | `/api/health` | Liveness (`ok`, `app`, `version`) |
| GET | `/api/readiness` | Shared readiness truth (hard blockers vs soft warnings) |
| GET | `/api/diagnostics` | Clipboard-ready diagnostics text (no account secrets) |
| GET | `/api/version` | Installed version + update source |
| GET | `/api/account` | Structured registration / devices |
| GET | `/api/snapshot` | Aggregated warp-cli reads (see keys below) |
| GET | `/api/config` | Effective layered config + sources |
| POST | `/api/config/session` | Session overrides (until daemon restart) |
| POST | `/api/config/tray-autostart` | Cloudflare One WARP tray autostart preference |
| POST | `/api/config/tray-shell` | Desktop app: `cloudflare` or `cloudflare-one-warp` |
| POST | `/api/config/webui` | Persist Web UI enablement (restart required) |
| POST | `/api/config/server` | Persist HTTP port/bind (restart required) |
| POST | `/api/config/ui` | Persist UI preferences (notifications) |
| GET | `/api/killswitch` | Kill switch desired/active state |
| POST | `/api/killswitch` | Enable/disable kill switch |
| POST | `/api/killswitch/enrollment-pause` | Pause KS during enrollment |
| GET | `/api/update/check` | Check for client updates |
| GET | `/api/update/releases` | List releases for source |
| GET | `/api/update/forks` | Fork list for update source UI |
| POST | `/api/update/source` | Set update GitHub source |
| POST | `/api/update/prepare` | Stage update download |
| POST | `/api/update/apply` | Apply staged update (AppImage) |
| GET | `/api/events` | SSE stream of warp-cli live output |
| GET | `/api/logs` | In-memory command log (`?since=timestamp`) |
| GET | `/api/apps` | Desktop apps for proxy launcher |
| POST | `/api/apps/proxy-launcher` | Create `.desktop` proxy shortcut |
| POST | `/api/action` | Whitelisted warp-cli mutation |

## Requests that change something

Every `POST` (and any other write method) must:

1. come from this computer,
2. be addressed to `127.0.0.1`, `localhost`, or `[::1]` on the daemon's port,
3. send `content-type: application/json`, and
4. carry the local session credential in `x-cloudflare-one-warp-session`.

Read the credential from `GET /api/session` or from `~/.config/cloudflare-one-warp/session-<port>.token` (mode `0600`, replaced each time the daemon starts).

```bash
SESSION=$(cat ~/.config/cloudflare-one-warp/session-4173.token)
curl -s -X POST http://127.0.0.1:4173/api/action \
  -H 'content-type: application/json' \
  -H "x-cloudflare-one-warp-session: $SESSION" \
  -d '{"action":"connect"}'
```

Refused requests return `403` (or `415` when the body is not JSON) with a `reason` field: `host_not_allowed`, `remote_peer_denied`, `cross_site_denied`, `cross_origin_denied`, `json_required`, or `session_required`. Each one is recorded in the Console log with source `security`.

Read-only endpoints need no credential, so `webui.allowRemote` still allows LAN diagnostics — but never changes.

## Snapshot command keys

The `commands` object in `/api/snapshot` includes keys from `COMMANDS` in `server.js`, for example:

`status`, `settings`, `registration`, `organization`, `devices`, `stats`, `tunnelStats`, `dnsStats`, `splitTunnelDump`, `splitTunnelIps`, `splitTunnelHosts`, `targets`, `vnet`, `mdm`, `override`, `localNetworkOverride`, `trustedSsids`, `posture`, `network`, `certs`, and more.

Each value is `{ ok, command, code, stdout, stderr, durationMs }` with redacted secrets.

## Static UI

When `webui.enabled` is true, non-API paths serve `public/` (SPA fallback to `index.html`).

When disabled, non-API routes return **404** and only the API answers.
