# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the canonical repo guidelines (structure, command list, learned user preferences). Read it too — this file covers the architecture and workflow reasoning that isn't obvious from a file listing.

## What this is

ThirdFlare One is an unofficial Cloudflare One client for Linux/macOS/headless. It owns **no** VPN logic: it shells out to the host's `warp-cli` and exposes that control surface as a localhost HTTP API (`server.js`), an optional Web UI (`public/`), and a PyQt6 native shell (`scripts/tray-qt.py`). Everything the product can do, `warp-cli` already does — ThirdFlare's value is the guarded API, the parity UI, and the Linux-only features Cloudflare doesn't ship (nftables kill-switch, NetworkManager profiles, per-app proxy launchers).

npm package name is `thirdflare`; product name in all user-facing text is **ThirdFlare One**.

## Daily commands

```bash
npm install
export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"   # required for local tests — never hits real WARP
npm run check            # node --check over every source file (this is the "lint")
npm run test:all         # all Plane M suites
npm run dev              # THIRDFLARE_WEBUI=1 node server.js → http://127.0.0.1:4173
```

Run a single suite directly rather than through `test:all`:

```bash
node --test scripts/ci-killswitch.test.mjs
node --test --test-name-pattern "redact" scripts/ci-warp-integration.test.mjs
```

Every `npm run test:*` script is a one-line wrapper over `node --test scripts/ci-<area>.test.mjs`, so adding a suite means adding both the file and a `test:<area>` script **and** appending it to `test:all` and to the giant `check` chain. Playwright smoke (`npm run test:ui`) is separate and not part of `test:all`.

`./thirdflare-one <install|build|run|test|dev|check>` is the operator entrypoint and mirrors the npm scripts.

## Two CI planes — know which one your change needs

- **Plane M (required, all three OSes)** — everything runs against `scripts/mock-warp-cli.mjs`, a stateful fake. Proves argv construction, allow-lists, parsers, DTO shapes, OpenAPI conformance. Proves nothing about real tunnels.
- **Plane R (optional, Ubuntu only)** — `npm run test:warp:real`, soft-skips unless `WARP_CI_REQUIRE_REAL=1`. The connectivity oracle is `cdn-cgi/trace` containing `warp=on`.

Mock harnesses set `THIRDFLARE_NFT_NO_PKEXEC=1` to simulate an unprivileged daemon, so `sudo npm run test:all` still matches hosted CI. **Never** enable the kill-switch apply path on a shared runner — it can brick egress. See `docs/CI.md`.

## The allow-list boundary (most important invariant)

`server.js` never builds a shell string and never passes user input through unfiltered. Two static tables plus one validator function define the entire `warp-cli` surface:

- `COMMANDS` — read-only invocations fanned out by `/api/snapshot`.
- `ACTIONS` — fixed-argv mutations for `/api/action`.
- `actionArgs(body)` — parameterized actions; each one regex/Set-validates `value` (`MODES`, `PROTOCOLS`, `TEAM_NAME_RE`, `WARP_TOKEN_RE`, …) and returns `null` to reject. Returning `null` is the rejection path — there is no fallthrough.

`spawnWarpCli()` uses `spawn` with an argv array (no shell), and routes through `flatpak-spawn --host` under Flatpak or `process.execPath` when `WARP_CLI` points at a `.mjs`/`.js` file — that last branch is what makes the portable mock work on Windows.

All command output passes through `redactWarpOutput()` before serialization (device ID, public key, license, account ID). Anything new that echoes `warp-cli` output must go through `redactCommand()`.

Adding a parity feature means: add to `COMMANDS`/`ACTIONS`/`actionArgs` → extend `public/app.js` → update `openapi/thirdflare-api.json` (it's contract-tested) → note in `CHANGELOG.md`. Bump `API_REVISION` in `lib/api-revision.mjs` when route semantics change — it is served on `/api/health` and `scripts/daemon-ready.mjs` compares it so the launcher restarts a stale daemon instead of talking to it.

There is still no CSRF token. In its place, `crossSiteRejection()` in `server.js` gates every non-GET request on three signals: `Sec-Fetch-Site` (only `same-origin`/`none` pass), `Origin` (must match the host we were reached on), and `Content-Type` (must be `application/json`, which a cross-origin form cannot send). Non-browser clients send none of these and are unaffected. This stops a hostile page driving the daemon, but it is not authentication — do not expose the Web UI remotely without adding auth.

## Configuration layering

`lib/config.mjs` merges, lowest to highest: `DEFAULTS` → `/etc/thirdflare/config.json` → legacy `~/.config/cloudflare-one-gui/` → `~/.config/thirdflare/config.json` → `THIRDFLARE_*` env → in-memory session overrides.

Three deliberate rules live here:

- `SESSION_ALLOWLIST` restricts `POST /api/config/session` to `ui.*` and `updates.channel/checkOnStartup/source`. `warp.cli` and `server.*` are never session-settable — that would be a command-injection vector.
- `getPinnedUpdateSource()` re-merges *without* the session layer, so a session override can't point the updater at an arbitrary repo; forks must be reachable through the fork graph.
- `webui.enabled` defaults to **false** (systemd safety). `effectiveBind()` only leaves `127.0.0.1` when `webui.enabled && webui.allowRemote`. `webui.*` and `server.*` changes require a restart and have dedicated POST endpoints instead of the session route.

## Subsystems worth knowing before you touch them

- `lib/warp/status-listener.mjs` — one shared `warp-cli --listen status` child process feeds both `/api/events` SSE clients and the notification watcher. Reconnecting UI tabs must not spawn additional listeners.
- `lib/notify/status-watcher.mjs` — starts on `listen()`, independent of the Web UI. Fires `notify-send` only on meaningful transitions, ~1.5s debounce.
- `lib/killswitch/` — generates a validated nftables script (`inet thirdflare_killswitch`), applies it via `pkexec thirdflare-nft-apply` under polkit action `com.thirdflare.one.nft-apply`. GET only ever runs read-only `nft list` and never escalates. `enroll-pause.mjs` pauses rules for Zero Trust enrollment without clearing persisted desired state. Rule generation is unit-tested; apply stays Linux-local and manual.
- `lib/apps/proxy-launcher.mjs` — the per-app routing answer: local proxy mode plus generated `.desktop` launchers, so users never hand-edit CIDRs.
- `lib/update/` — channel/manifest/GitHub check, prepare-then-apply with a token, AppImage self-replace.
- `public/app.js` — one bundle serving two layouts: expert (default) and the simple shell loaded at `/?shell=1` by the PyQt6 window. Nav items are declared in `simpleNavItems`.

## Conventions

2-space indent, ES modules (`"type": "module"`), `camelCase` in JS, `kebab-case` filenames. Conventional Commits — release-please drives versioning off them.

User-facing copy is governed by `.cursor/rules/user-facing-copy.mdc`: plain language, no OS internals, never explain what Cloudflare "does not support" — ship a ThirdFlare workaround instead. Never paste planning or prompt text into `public/locales/`, tooltips, or guides. UI strings go in `public/locales/en.json` via `i18n.js`, not inline.
