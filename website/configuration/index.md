# Configuration

Layered config merges (lowest → highest priority):

1. **System** — `/etc/cloudflare-one-warp/config.json` (packaged installs)
2. **User** — `${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/config.json`
3. **Environment** — `CLOUDFLARE_ONE_WARP_*` variables
4. **Session** — `POST /api/config/session` (until daemon restart)

Implementation: `lib/config.mjs`. The control plane accepts only loopback peers. `server.bind` is restricted to loopback; the legacy `webui.allowRemote` option cannot enable LAN access. Valid legacy settings under `~/.config` migrate when a custom XDG config home is used.

## Example file

See [`config/config.example.json`](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/config/config.example.json).

```json
{
  "server": { "port": 4173, "bind": "127.0.0.1" },
  "webui": { "enabled": false, "allowRemote": false },
  "warp": { "cli": "warp-cli", "killSwitch": false },
  "ui": { "openBrowser": true, "theme": "system", "locale": "en" },
  "updates": { "channel": "stable", "checkOnStartup": true },
  "tray": { "autostart": false }
}
```

## Inspect effective config

```bash
curl -s http://127.0.0.1:4173/api/config | jq
```

Returns merged `config` plus `sources` showing which layer set each key.

## Session overrides

Use for in-app Settings changes without editing files:

```bash
curl -X POST http://127.0.0.1:4173/api/config/session \
  -H 'Content-Type: application/json' \
  -H "x-cloudflare-one-warp-session: $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/cloudflare-one-warp/session-4173.token")" \
  -d '{"ui":{"theme":"dark"}}'
```

## Further reading

- [Config keys](/configuration/keys)
- [Environment variables](/configuration/env)
- Repository [CONFIGURATION.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/CONFIGURATION.md)
