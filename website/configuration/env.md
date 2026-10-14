# Environment variables

Environment overrides map in `lib/config.mjs`:

| Variable | Effect |
|----------|--------|
| `CLOUDFLARE_ONE_WARP_PORT` | Server port (aliases: `CLOUDFLARE_ONE_GUI_PORT`, `PORT`) |
| `CLOUDFLARE_ONE_WARP_BIND` | Loopback bind address only (alias: `CLOUDFLARE_ONE_GUI_BIND`) |
| `CLOUDFLARE_ONE_WARP_CLI` | warp-cli path (alias: `WARP_CLI`) |
| `CLOUDFLARE_ONE_WARP_WEBUI` | `1`/`true` enable UI; `0`/`false` disable |
| `CLOUDFLARE_ONE_WARP_WEBUI_ALLOW_REMOTE` | Legacy variable; cannot enable remote access |
| `CLOUDFLARE_ONE_WARP_LOCALE` | UI locale |
| `CLOUDFLARE_ONE_WARP_NOTIFICATIONS` | Enable/disable notifications |
| `CLOUDFLARE_ONE_WARP_UPDATE_CHANNEL` | Update channel |
| `CLOUDFLARE_ONE_WARP_UPDATE_SOURCE` | `owner/repo` update source |
| `CLOUDFLARE_ONE_WARP_UPDATE_CHECK` | `0`/`false` skip startup check |

## Development

```bash
export CLOUDFLARE_ONE_WARP_WEBUI=1
npm run dev
```

## systemd drop-in

```ini
[Service]
Environment=CLOUDFLARE_ONE_WARP_WEBUI=0
Environment=CLOUDFLARE_ONE_WARP_PORT=4173
```

## Config file paths

Resolved by `configPaths()`:

- System: `/etc/cloudflare-one-warp/config.json`
- User: `${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/config.json`


The same XDG config home holds `session-<port>.token` for Node and Python clients. Remote control requires an explicit trusted tunnel to a local endpoint; a forged localhost Host header cannot bypass peer checks.
