# Config keys

Top-level sections from `config.example.json`:

## server

| Key | Type | Description |
|-----|------|-------------|
| `port` | number | HTTP listen port |
| `bind` | string | Loopback bind address only (`127.0.0.1`, `localhost`, or `::1`) |

## webui

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Serve `public/` static UI |
| `allowRemote` | boolean | Legacy compatibility key; remote access is disabled |

## warp

| Key | Type | Description |
|-----|------|-------------|
| `cli` | string | Path or name of warp-cli |
| `killSwitch` | boolean | Desired kill switch state |
| `killSwitchAllowLan` | boolean | Allow LAN when KS active |

## ui

| Key | Type | Description |
|-----|------|-------------|
| `openBrowser` | boolean | Open browser on `--connect` style flows |
| `theme` | string | `system`, `light`, `dark` |
| `locale` | string | BCP-47 locale code |
| `notifications` | boolean | Desktop notifications |

## updates

| Key | Type | Description |
|-----|------|-------------|
| `channel` | string | `stable` or `beta` |
| `source.owner` / `source.repo` | string | GitHub update source |
| `checkOnStartup` | boolean | Check on daemon start |

## tray

| Key | Type | Description |
|-----|------|-------------|
| `autostart` | boolean | Start tray with session |

Additional keys may appear as features evolve — `/api/config` is authoritative at runtime.
