# Configuration

Layered config merges (lowest → highest priority):

1. **System** — `/etc/thirdflare-one/config.json` (packaged installs)
2. **User** — `~/.config/thirdflare-one/config.json`
3. **Environment** — `THIRDFLARE_*` variables
4. **Session** — `POST /api/config/session` (until daemon restart)

Implementation: `lib/config.mjs`.

## Example file

See [`config/config.example.json`](https://github.com/bodencrouch/thirdflare-one/blob/main/config/config.example.json).

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
  -H "x-thirdflare-session: $(cat ~/.config/thirdflare/session-4173.token)" \
  -d '{"ui":{"theme":"dark"}}'
```

## Further reading

- [Config keys](/configuration/keys)
- [Environment variables](/configuration/env)
- Repository [CONFIGURATION.md](https://github.com/bodencrouch/thirdflare-one/blob/main/docs/CONFIGURATION.md)
