# KDE Plasma and NetworkManager integration

Cloudflare One WARP controls the official `warp-cli`; `warp-svc` owns the tunnel, keys, routes and DNS. NetworkManager companion profiles provide connect/disconnect controls without configuring the vendor tunnel interface.

## Companion profiles

| Connection | Marker interface | WARP mode |
|---|---|---|
| Cloudflare One WARP (MASQUE) | `cfw-masque` | MASQUE full tunnel |
| Cloudflare One WARP (WireGuard) | `cfw-wireguard` | WireGuard full tunnel |
| Cloudflare One WARP (Local proxy) | `cfw-proxy` | MASQUE local proxy |

These are `type=dummy` connections with IPv4 and IPv6 disabled and autoconnect off. They never run DHCP on `CloudflareWARP`. They are not importable VPN configurations and require no NetworkManager VPN plugin.

## Install and use

```bash
./scripts/cloudflare-one-warp-nm --user
./scripts/cloudflare-one-warp-nm --system  # privileged dispatcher and sysctl installation
```

The user installer generates keyfiles under `${XDG_CONFIG_HOME:-$HOME/.config}/NetworkManager/system-connections` and loads them individually with `nmcli connection load`. NetworkManager authorization is required; resolve authorization failures before trying to activate a connection. Packaged profiles are supplied under `/usr/share/cloudflare-one-warp/networkmanager/profiles/`.

```bash
nmcli connection up 'Cloudflare One WARP (MASQUE)'
nmcli connection down 'Cloudflare One WARP (MASQUE)'
```

With the dispatcher installed, marker activation runs the official CLI to set protocol and mode and connect. Deactivation disconnects WARP. Plasma may show these companion connections in its connection list; their presentation depends on the desktop and NetworkManager version.

The sysctl drop-in sets `net.ipv4.conf.all.src_valid_mark=1` for policy-routing compatibility. It does not replace the routing policy maintained by `warp-svc`.

## KDE proxy ownership

Local proxy integration uses the actual configured proxy port. `scripts/cloudflare-one-warp-kde-proxy-sync` writes `kioslaverc`, journals previous settings under the app's private configuration directory, and restores settings it owns when disabling the proxy. It refuses existing active or immutable KDE proxy policy and relinquishes ownership when another application changes it. Failed writes retain recovery information instead of discarding the user's prior policy.

```bash
./scripts/cloudflare-one-warp-kde-proxy-sync on 40000
./scripts/cloudflare-one-warp-kde-proxy-sync off
```

The default port is 40000; use the port shown by `warp-cli settings list` when changed. Local proxy mode routes applications that actually use the proxy and does not tunnel general UDP traffic. Use full tunnel mode for that requirement.

See [GETTING_STARTED.md](GETTING_STARTED.md) and [CONFIGURATION.md](CONFIGURATION.md).
