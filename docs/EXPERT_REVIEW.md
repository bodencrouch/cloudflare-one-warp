# Expert release review: 0.3.5

This review applies vendor-level release priorities to an independent WARP control plane. It does not claim Cloudflare endorsement or certification. The review targets concrete security, correctness, failure recovery, desktop ownership and distribution behavior rather than adding features without operational evidence.

## Priorities and implemented safeguards

| Priority | Integrated behavior | Regression coverage |
|---|---|---|
| Protect account information across local users | Owner-file authentication covers private reads, writes and event streams; health/version remain limited public endpoints. Browser launch uses a private handoff rather than unauthenticated credential discovery. | `ci-request-gate.test.mjs`, `ci-tray-client.test.mjs`, UI authentication smoke tests |
| Bound privileged and long-running work | CLI executions have hard deadlines, output budgets and shutdown cleanup; mutating workflows serialize to prevent overlapping enrollment, mode and disconnect commands. | `ci-bounded-child.test.mjs`, `ci-warp-integration.test.mjs` |
| Report actual protection | Firewall probes validate nftables structure instead of treating a table name as proof; strict rules permit necessary address acquisition without general DNS or arbitrary bootstrap ports. | `ci-network-ownership.test.mjs`, `ci-killswitch.test.mjs`, `ci-polkit-helper.test.mjs` |
| Preserve host network ownership | NetworkManager uses addressless `cfw-*` dummy markers; dispatcher identification uses exported connection metadata. The official WARP tunnel keeps its own addresses, routes and DNS. | `ci-nm-profiles.test.mjs`, `ci-network-ownership.test.mjs`, `ci-desktop-sync.test.mjs` |
| Preserve user and managed proxy policy | KDE synchronization edits `kioslaverc` only under an ownership journal, refuses active/immutable policy and preserves recovery information on interrupted changes. | `ci-network-ownership.test.mjs`, `ci-desktop-sync.test.mjs` |
| Keep desktop state honest and responsive | Status parsing distinguishes disconnected/connecting; readiness probes match tray dependencies; watchers isolate child generations and stop pending notifications when disabled. Native actions remain asynchronous. | `ci-status-listener.test.mjs`, `ci-readiness.test.mjs`, `ci-notify.test.mjs`, `ci-tray-workers.test.py` |
| Fail closed on update provenance | Detached signatures remain binary-safe; redirects remove credentials across origins; download hosts and paths are constrained; metadata caches separate authentication contexts. Stable pointers cannot choose prereleases, and confirmation tokens are bounded and single use. | `ci-update.test.mjs` |
| Avoid destructive installation | Local installation stages before replacement, uses a lock and ownership marker, rejects unsafe targets, preserves unrelated command links and quotes generated desktop/systemd paths. | `ci-packaging.test.mjs`, `ci-systemd-unit.test.mjs` |
| Harden distribution boundaries | Source staging excludes development/private material; workflows restrict permissions and pin actions; release artifacts include provenance and application dependency inventory. | Packaging checks and release workflow validation |
| Make UI recovery dependable | API headers preserve caller-provided headers, event streams authenticate, cached shell assets exclude account responses, and update/connection controls preserve valid state. | `ui-expert-regressions.mjs`, UI smoke tests, update release-picker tests |

The test files describe reproducible coverage; this table is not a claim that every native environment was exercised. See [CI.md](CI.md) for the required mock-control-plane checks and optional real tunnel checks. Release validation results belong in the release/PR record.

## Deliberate release limits

The shipped AppImage trusted-key ring is empty. Automatic replacement stays disabled and the UI directs users to manual release downloads. Tests exercise signature verification with isolated test keys; production key provisioning and rotation need separate operational ownership.

Artifact provenance and the application-dependency SBOM improve traceability. They do not inventory every bundled Node/Qt/operating-system dependency or certify native Windows signing, macOS notarization, device enrollment, captive portals, enterprise policy or tunnel operation on all supported machines.

Cloudflare continues to own server-side enrollment, organization policy and the official WARP data plane. This app must surface denied operations and uncertainty rather than manufacture success or bypass managed policy.

See [SECURITY.md](../SECURITY.md), [ARCHITECTURE.md](ARCHITECTURE.md), [NETWORKING.md](NETWORKING.md), and the earlier [REVIEW_FIXES.md](REVIEW_FIXES.md).
