# KDE Plasma and NetworkManager integration

Cloudflare One WARP integrates Cloudflare WARP with **NetworkManager** and **KDE Plasma** so you can connect from the same places as Wi‑Fi and other networks.

WARP is **not** a traditional OpenVPN/WireGuard file you paste into NetworkManager — the official client uses the **`CloudflareWARP`** tunnel interface and **`warp-cli`**. Cloudflare One WARP ships ready-made profiles and hooks that call `warp-cli` for you.

Research note: the [warp-docker](https://github.com/cmj2002/warp-docker) project documents low-level WARP behaviour (TUN device, MASQUE vs WireGuard, local proxy on port 40000, policy routing). Cloudflare One WARP follows those same `warp-cli` commands on native Linux.

## Profiles (MASQUE, WireGuard, local proxy)

| Profile | Protocol | Mode | Use when |
|---------|----------|------|----------|
| **Cloudflare One WARP (MASQUE)** | MASQUE (HTTP/3) | Full tunnel | Default; works on restrictive networks |
| **Cloudflare One WARP (WireGuard)** | WireGuard | Full tunnel | You prefer UDP WireGuard to the edge |
| **Cloudflare One WARP (Local proxy)** | MASQUE | Local proxy | Only apps using the proxy / WARP shortcuts use the tunnel |

Full-tunnel profiles bind to interface **`CloudflareWARP`** (created by `warp-svc` when connected). Local proxy listens on **`127.0.0.1:40000`** (SOCKS/HTTP).

## Install integration

After `./cloudflare-one-warp install` or `./scripts/install-local.sh`:

```bash
# User profiles (~/.config/NetworkManager/system-connections/)
./scripts/cloudflare-one-warp-nm --user

# Dispatcher + sysctl (recommended once; prompts for admin)
./scripts/cloudflare-one-warp-nm --system
```

If `nmcli` reports **access denied** when loading profiles, open **System Settings → Network → + → Import VPN connection…** and choose a file from `~/.config/NetworkManager/system-connections/Cloudflare One WARP-WARP-*.nmconnection`, then log out and back in (or restart NetworkManager) if they do not appear immediately.

Packaged `.deb` / `.rpm` installs include dispatcher, sysctl drop-in, and importable profiles under `/usr/share/cloudflare-one-warp/networkmanager/profiles/`.

### Sysctl

WARP policy routing needs:

```ini
net.ipv4.conf.all.src_valid_mark=1
```

Installed to `/etc/sysctl.d/99-cloudflare-one-warp.conf` with `--system` or packages.

## Using KDE Plasma

1. **System Settings → Network** — connect **Cloudflare One WARP (MASQUE)**, **WireGuard**, or **Local proxy**.
2. **Import VPN connection…** (bottom of the “Add connection” dialog) — pick a file from:
   - `~/.config/NetworkManager/system-connections/Cloudflare One WARP-WARP-*.nmconnection`
   - `/usr/share/cloudflare-one-warp/networkmanager/profiles/` (packages)
3. **Plasma Networks widget** — configured WARP profiles appear alongside other connections.
4. **Local proxy mode** — Cloudflare One WARP can sync **System Settings → Proxy** to `127.0.0.1:40000` when the local proxy profile is active.

Connecting from KDE runs `scripts/cloudflare-one-warp-connect`, which executes the same steps as the official client:

```bash
# MASQUE full tunnel
warp-cli tunnel protocol set MASQUE
warp-cli mode warp
warp-cli connect

# WireGuard full tunnel
warp-cli tunnel protocol set WireGuard
warp-cli mode warp
warp-cli connect

# Local proxy (MASQUE required)
warp-cli tunnel protocol set MASQUE
warp-cli mode proxy
warp-cli proxy port 40000
warp-cli connect
```

Disconnecting from KDE runs `warp-cli disconnect` and clears KDE proxy settings when applicable.

## Cloudflare One WARP app ↔ NetworkManager sync

When you connect or disconnect from the Cloudflare One WARP UI, the daemon tries to activate or deactivate the matching NetworkManager profile (`nmcli`). Requires `nmcli` on `PATH`.

## Requirements

- **NetworkManager** (`nmcli`)
- **Cloudflare WARP** (`warp-cli`, `warp-svc`) on the host
- Linux (KDE Plasma, GNOME, etc.)
- For dispatcher hooks: write access to `/etc/NetworkManager/dispatcher.d/` (via `pkexec` or package install)

## Limitations

- WARP cannot appear as a native **WireGuard peer editor** in NetworkManager — Cloudflare owns keys and endpoints inside `warp-svc`.
- A full **NetworkManager VPN plugin** (`.so`) would be needed for a custom row in the “Add VPN” type list without import; Cloudflare One WARP uses importable profiles + generic connections instead.
- Local proxy mode does not tunnel UDP; use full tunnel profiles when you need UDP through WARP.

See also [GETTING_STARTED.md](GETTING_STARTED.md) and [CONFIGURATION.md](CONFIGURATION.md).
