# Environment variables

Environment overrides map in `lib/config.mjs`:

| Variable | Effect |
|----------|--------|
| `CLOUDFLARE_ONE_WARP_PORT` | Server port (aliases: `CLOUDFLARE_ONE_GUI_PORT`, `PORT`) |
| `CLOUDFLARE_ONE_WARP_BIND` | Bind address (alias: `CLOUDFLARE_ONE_GUI_BIND`) |
| `CLOUDFLARE_ONE_WARP_WARP_CLI` | warp-cli path (alias: `WARP_CLI`) |
| `CLOUDFLARE_ONE_WARP_WEBUI` | `1`/`true` enable UI; `0`/`false` disable |
| `CLOUDFLARE_ONE_WARP_WEBUI_ALLOW_REMOTE` | Allow remote UI access |
| `CLOUDFLARE_ONE_WARP_LOCALE` | UI locale |
| `CLOUDFLARE_ONE_WARP_NOTIFICATIONS` | Enable/disable notifications |
| `CLOUDFLARE_ONE_WARP_UPDATE_CHANNEL` | Update channel |
| `CLOUDFLARE_ONE_WARP_UPDATE_SOURCE` | `owner/repo` update source |
| `CLOUDFLARE_ONE_WARP_UPDATE_CHECK` | `0`/`false` skip startup check |
| `CLOUDFLARE_ONE_WARP_CONFIG` | Explicit config file path |

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
- User: `~/.config/cloudflare-one-warp/config.json`

Override with `CLOUDFLARE_ONE_WARP_CONFIG` for testing.
