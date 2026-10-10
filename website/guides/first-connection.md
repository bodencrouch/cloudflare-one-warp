# First connection

## 1. Install Cloudflare WARP

Install **warp-cli** from Cloudflare and ensure the service runs:

```bash
warp-cli --version
warp-cli registration show
```

If unregistered:

```bash
warp-cli registration new
```

## 2. Install Cloudflare One WARP

```bash
./cloudflare-one-warp install
cloudflare-one-warp --version
```

## 3. Start the client

```bash
cloudflare-one-warp
```

Or API-only:

```bash
cloudflare-one-warp --no-open
```

## 4. Connect

From CLI:

```bash
cloudflare-one-warp --connect
```

From API:

```bash
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' \
  -H "x-cloudflare-one-warp-session: $(cat ~/.config/cloudflare-one-warp/session-4173.token)" \
  -d '{"action":"connect"}'
```

From UI: use the connect toggle in the native panel or Web UI.

## 5. Confirm

```bash
cloudflare-one-warp --warp-status
curl -s http://127.0.0.1:4173/api/snapshot | jq '.status'
```

## Operating mode

Expert mode exposes MASQUE vs WireGuard and split tunnel controls. Mode is normalized server-side — invalid values fall back safely.

See [Configuration](/configuration/) for layered config (system, user, env, session).
