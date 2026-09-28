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

## 2. Install ThirdFlare One

```bash
./thirdflare-one install
thirdflare --version
```

## 3. Start the client

```bash
thirdflare
```

Or API-only:

```bash
thirdflare --no-open
```

## 4. Connect

From CLI:

```bash
thirdflare --connect
```

From API:

```bash
curl -X POST http://127.0.0.1:4173/api/action \
  -H 'Content-Type: application/json' \
  -H "x-thirdflare-session: $(cat ~/.config/thirdflare/session-4173.token)" \
  -d '{"action":"connect"}'
```

From UI: use the connect toggle in the native panel or Web UI.

## 5. Confirm

```bash
thirdflare --warp-status
curl -s http://127.0.0.1:4173/api/snapshot | jq '.status'
```

## Operating mode

Expert mode exposes MASQUE vs WireGuard and split tunnel controls. Mode is normalized server-side — invalid values fall back safely.

See [Configuration](/configuration/) for layered config (system, user, env, session).
