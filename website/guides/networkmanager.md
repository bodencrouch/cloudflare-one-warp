# KDE / NetworkManager

Cloudflare One WARP supplies three companion connections: **Cloudflare One WARP (MASQUE)**, **Cloudflare One WARP (WireGuard)** and **Cloudflare One WARP (Local proxy)**.

They use addressless NetworkManager dummy interfaces (`cfw-masque`, `cfw-wireguard`, `cfw-proxy`) with IPv4/IPv6 disabled. The official `warp-svc` continues to own `CloudflareWARP`, routing and DNS. These are not VPN import files and do not need a VPN plugin.

## Install integration

```bash
cloudflare-one-warp-nm --user
cloudflare-one-warp-nm --system
nmcli connection up 'Cloudflare One WARP (MASQUE)'
nmcli connection down 'Cloudflare One WARP (MASQUE)'
```

The system step requires administrator authorization and installs the dispatcher and sysctl drop-in. The dispatcher runs official WARP commands on marker activation/deactivation. Loading connections also requires NetworkManager authorization; an access-denied error must be resolved with an authorized session.

Plasma may display companion connections alongside other configured connections. Desktop presentation varies; `nmcli` provides explicit activation commands.

## KDE proxy settings

Local proxy synchronization uses the configured WARP port and edits `kioslaverc`. An ownership journal preserves previous values; existing active or immutable proxy policy is respected. Disabling restores settings owned by this app instead of clearing arbitrary user settings.

```bash
cloudflare-one-warp-kde-proxy-sync on 40000
cloudflare-one-warp-kde-proxy-sync off
```

Full details: [NETWORKING.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/NETWORKING.md).
