# systemd user daemon

Install with systemd user unit:

```bash
./cloudflare-one-warp install --service
systemctl --user enable --now cloudflare-one-warp.service
```

## Default posture

The packaged unit runs **API-only** (Web UI off). The unit explicitly disables the Web UI through its environment, which takes precedence over the config file. Enable it with `systemctl --user edit cloudflare-one-warp.service` and this drop-in:

```ini
[Service]
Environment=CLOUDFLARE_ONE_WARP_WEBUI=1
```

## Commands

```bash
systemctl --user status cloudflare-one-warp.service
journalctl --user -u cloudflare-one-warp.service -f
systemctl --user restart cloudflare-one-warp.service
```

## Health

```bash
curl -s http://127.0.0.1:4173/api/health
```

The packaged unit is `packaging/cloudflare-one-warp.service`; the local installer writes `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/cloudflare-one-warp.service`.

After editing a drop-in, run `systemctl --user daemon-reload` and restart the service. The port comes from the selected configuration unless an explicit environment override is set.

The service uses `%t/cloudflare-one-warp` for temporary files. Its pre-start command prepares desktop integration paths before filesystem confinement, and the main daemon keeps explicit writable grants for app state, user units, launcher entries and KDE configuration.
