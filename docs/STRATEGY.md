---
last_updated: 2026-07-18
---

# Strategy

## Target problem

Cloudflare ships a full Cloudflare One desktop client on Windows. Other platforms get `warp-cli` without a comparable control plane. Operators need a trustworthy local UI/API that drives the same WARP daemon without reinventing the tunnel.

## Our approach

Cloudflare One WARP is a **control plane** over host `warp-cli`: Node HTTP API + optional Web UI. The tunnel, identity, and (on Linux) nftables kill-switch stay on the host. We prove the control plane in CI with a stateful mock on every OS; we prove the data plane with optional Linux real-WARP smoke (`cdn-cgi/trace`), not marketing-grade “green means VPN works everywhere.”

## Who it's for

- Linux (and Homebrew macOS) operators who already run Cloudflare WARP
- Developers and agents that automate via `/api/*`
- Contributors who need an honest CI confidence ladder

## Key metrics

| Metric | Where it lives |
|--------|----------------|
| Plane M CI green (mock contract on ubuntu/macos/windows) | GitHub Actions required checks |
| Plane R smoke (connect/disconnect + `warp=on`) | Optional/main push Ubuntu job |
| Release artifacts installable | `package.yml` + package-smoke |

## Tracks

1. **Control-plane CI** — Exhaustive mock integration, OpenAPI checks, thin UI smoke; cross-OS matrix.
2. **Consumer-basic Account** — Status, free register, license, collapsed ZT token/team; no full enrollment coach in UI.
3. **Linux-first data plane** — Real WARP network smoke on Ubuntu; kill-switch rules in unit tests only on shared runners.
4. **Packaging & updates** — Existing Release packages → Package → manifest pipeline.

## Not working on (now)

- Self-hosted WARP runner fleet as a required PR gate
- Browser SSO Zero Trust E2E in CI
- Claiming Win/Mac nftables or native shell parity via CI green
