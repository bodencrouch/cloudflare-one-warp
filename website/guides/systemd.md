# systemd user daemon

Install with systemd user unit:

```bash
./cloudflare-one-warp install --service
systemctl --user enable --now cloudflare-one-warp.service
```

## Default posture

The packaged unit runs **API-only** (Web UI off). Enable UI via config file or drop-in:

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

Unit files live under `packaging/systemd/` in the repository.
