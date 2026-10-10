# Repository Guidelines

## Project

**Cloudflare One WARP** — unofficial third-party Cloudflare One client (`cloudflare-one-warp` npm package). Wraps host `warp-cli` through a Node daemon and optional Web UI. GitHub repository: `bodencrouch/cloudflare-one-warp`.

## Project Structure

- `server.js` — HTTP API and guarded `warp-cli` execution.
- `lib/config.mjs` — layered configuration (system, user, env, session).
- `lib/version.mjs` — installed semver from `package.json`.
- `lib/update/` — GitHub/manifest update engine and AppImage apply.
- `lib/killswitch/` — nftables kill-switch rules and privileged apply (`cloudflare-one-warp-nft-apply` / polkit).
- `lib/tray/` — XDG autostart and desktop-shell swap (`tray.autostart`, `tray.shell`: Cloudflare One Client vs Cloudflare One WARP tray). Default is Cloudflare One Client — host `warp-taskbar` plus `warp-desktop-svc`. On that path the daemon runs API-only and leaves notifications to Cloudflare's tray; Cloudflare One WARP's own tray and Web UI are opt-in.
- `scripts/tray-qt.py`, `scripts/cloudflare-one-warp-nft-apply` — native shell and polkit helper.
- `config/config.example.json` — documented defaults.
- `config/update-manifest.json` — stable/beta pointers for client update checks.
- `public/` — optional Web UI (off by default for systemd daemon); `i18n.js` + `locales/`.
- `cloudflare-one-warp` — operator entrypoint (install, build, run, test).
- `bin/cloudflare-one-warp` — primary launcher (`bin/cloudflare-one-warp-gui` alias).
- `scripts/install-local.sh` — idempotent user install to `~/.local/share/cloudflare-one-warp`.
- `packaging/` — FHS staging, nfpm, AppImage, Flatpak, Snap, systemd units.
- `docs/GETTING_STARTED.md`, `docs/CONTRIBUTING.md` — user setup and contributor guides.
- `docs/DISTRIBUTION.md` — Flathub, Snap, COPR, AUR, AppImageHub channels.
- `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, `docs/PACKAGING.md`, `docs/UPDATES.md`, `docs/CI.md`.
- `docs/STRATEGY.md` — product strategy (control-plane CI, consumer-basic Account).
- `scripts/mock-warp-cli.mjs` — portable stateful mock for Plane M CI.
- `openapi/cloudflare-one-warp-api.json` — HTTP contract for OpenAPI checks.

## Commands

- `npm run dev` — server with `CLOUDFLARE_ONE_WARP_WEBUI=1`.
- `npm run check` — syntax including config, update modules, and UI.
- `npm run test:integration` — mock warp-cli integration tests.
- `npm run test:mock-warp` — stateful mock CLI unit tests.
- `npm run test:openapi` — live response checks vs OpenAPI.
- `npm run test:update` — update engine unit tests (mocked GitHub).
- `npm run test:notify` — desktop notification / status transition tests.
- `npm run test:registration` — registration parser unit tests.
- `npm run test:polkit` — polkit helper script validation tests.
- `npm run test:killswitch` — nftables kill-switch rule generation tests.
- `npm run test:tray` — tray XDG autostart config and desktop entry tests.
- `npm run test:readiness` — readiness hard/soft blocker and diagnostics clipboard unit tests.
- `npm run test:request-gate` — HTTP request authenticity gate unit tests.
- `npm run test:systemd` — systemd unit confinement and packaged/user unit drift checks.
- `npm run test:tray-client` — Python tray client session credential wiring against a live daemon.
- `npm run test:ui` — Playwright UI smoke (mock daemon).
- `npm run test:all` — all Plane M Node test suites (not Playwright).
- `npm run test:warp:real` — Plane R real WARP smoke (Linux; soft-skip unless required).
- `./cloudflare-one-warp install` / `./cloudflare-one-warp build appimage` — user install and packaging entrypoints.
- `./bin/cloudflare-one-warp` / `./bin/cloudflare-one-warp --version` — launcher.
- `npm run package:*` — see `docs/PACKAGING.md`.

## Conventions

2-space indent; `camelCase` in JS; `kebab-case` for filenames. Conventional Commits for clear changelogs.

## Testing

Run `npm run check` and `npm run test:all` before handoff. See **[docs/CI.md](docs/CI.md)** for Plane M vs Plane R. After packaging changes: `npm run package:stage` and `npm run package:deb`. Smoke `/api/health`, `/api/version`, `/api/account`, `/api/killswitch`, and `/api/update/check` after related work. See `docs/UPDATES.md` for the release → manifest pipeline.

## Learned User Preferences

- Use the product name **Cloudflare One WARP** in user-facing docs and UI (not bare "Cloudflare One WARP").
- When asked to pick the next Compound Engineering step or continue, choose a skill/command/subagent and proceed autonomously without waiting for interactive confirmation.
- Update-source controls should use comboboxes for the official repo and forks, not free-text fields.
- Prefer a single state-revealing toggle for connect/disconnect-style actions over separate On/Off buttons.
- Align tooltips and account UX with Cloudflare One documentation; avoid placeholder account UI.
- UI polling/refreshes must preserve scroll position (do not jump the page to the top).
- User-facing copy must use plain language; never paste prompt/planning text or “Cloudflare does not support…” lectures into the UI. Prefer Cloudflare One WARP workarounds (e.g. app routing shortcuts) over explaining platform gaps.

## Learned Workspace Facts

- GitHub repository: `bodencrouch/cloudflare-one-warp`.
- Optional Web UI is off by default; settings are layered (systemd/system defaults with provisional session and in-app overrides).
- Packaging/CI targets include AppImage, deb, rpm, Flatpak, Snap, GHCR Docker images, and Homebrew. Required CI is Plane M (mock) on Linux/macOS/Windows; Plane R real WARP smoke is Ubuntu-only and optional — see `docs/CI.md`.
- Native nftables kill-switch lives under `lib/killswitch/` and is exposed via `/api/killswitch`.
- KDE Plasma / NetworkManager integration: prebuilt WARP profiles (MASQUE, WireGuard, local proxy), dispatcher hooks, and optional KDE proxy sync — see `docs/NETWORKING.md` and `scripts/cloudflare-one-warp-nm`.
- Outstanding native gaps often tracked: self-contained native shell (Tauri/Electron or bundled Qt in AppImage), and Windows visual parity. Tray packaging and polkit kill-switch helper ship in deb/rpm/AppImage payloads as of 0.2.x.
