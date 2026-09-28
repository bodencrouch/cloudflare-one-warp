# Contributing to ThirdFlare One

Thank you for helping improve ThirdFlare One. This guide covers local setup, the codebase layout, how to run tests, and what we expect in pull requests.

> **Product name:** Use **ThirdFlare One** in user-facing text (UI, docs, commit descriptions). The short CLI name is `thirdflare` / `thirdflare-one`.

Repository: [github.com/bodencrouch/thirdflare-one](https://github.com/bodencrouch/thirdflare-one)

---

## Quick contributor setup

```bash
git clone https://github.com/bodencrouch/thirdflare-one.git
cd thirdflare-one
npm install

# Syntax check + full Plane M test suite (mock warp-cli)
export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"
npm run check
npm run test:all
```

Optional — install Playwright for UI smoke tests:

```bash
npx playwright install --with-deps chromium
npm run test:ui
```

Optional — real WARP smoke on Linux (soft-skips if WARP is unavailable):

```bash
npm run test:warp:real
# hard fail if WARP missing:
WARP_CI_REQUIRE_REAL=1 npm run test:warp:real
```

---

## Operator entrypoint

Use **`./thirdflare-one`** as the main CLI when working in the repo:

| Command | Purpose |
|---------|---------|
| `./thirdflare-one dev` | Dev server with Web UI (`THIRDFLARE_WEBUI=1`) |
| `./thirdflare-one run` | Production-style launcher (`bin/thirdflare`) |
| `./thirdflare-one check` | Syntax check all JS/MJS sources |
| `./thirdflare-one test all` | Plane M unit + integration suites |
| `./thirdflare-one test ui` | Playwright smoke |
| `./thirdflare-one test warp:real` | Plane R real WARP (Linux) |
| `./thirdflare-one install` | User install to `~/.local/share/thirdflare-one` |
| `./thirdflare-one build appimage` | Build AppImage locally |

`npm run …` scripts mirror these — see [package.json](../package.json).

---

## Repository layout

```
thirdflare-one/                 # repo root (operator entrypoint)
├── thirdflare-one              # install | build | run | test | dev
├── server.js                   # HTTP API + warp-cli orchestration
├── bin/
│   ├── thirdflare              # launcher (daemon lifecycle, selected desktop app)
│   ├── thirdflare-tray         # selected desktop app / PyQt6 tray
│   ├── thirdflare-one-gui      # alias → thirdflare
│   └── thirdflare-one-tray     # alias → thirdflare-tray
├── lib/
│   ├── config.mjs              # layered configuration merge
│   ├── version.mjs
│   ├── warp/                   # status + registration parsers
│   ├── tray/                   # XDG autostart + Cloudflare/ThirdFlare desktop shell
│   ├── notify/                 # libnotify / status watcher
│   ├── killswitch/             # nftables rule generation + apply
│   └── update/                 # GitHub release checks, AppImage apply
├── scripts/
│   ├── tray-qt.py              # PyQt6 embedded Web UI
│   ├── thirdflare-nft-apply    # polkit-scoped kill-switch helper
│   └── mock-warp-cli.mjs       # CI mock
├── public/                     # Web UI (app.js, i18n, locales/, PWA shell)
├── config/
│   ├── config.example.json     # documented defaults
│   └── update-manifest.json    # stable/beta release pointers
├── scripts/
│   ├── install-local.sh        # idempotent ~/.local/share/thirdflare-one install
│   ├── uninstall-local.sh
│   ├── lib/common.sh           # shared shell helpers
│   ├── mock-warp-cli.mjs       # stateful mock for CI (Plane M)
│   ├── ci-*.test.mjs           # Node test suites
│   └── ui-smoke.mjs            # Playwright smoke
├── packaging/
│   ├── scripts/                # build-appimage, stage-payload, deb/rpm, …
│   ├── nfpm.yaml
│   └── thirdflare-one.desktop
├── openapi/thirdflare-api.json # HTTP contract for OpenAPI tests
└── docs/                       # user + contributor documentation
```

Deep dive: **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## Development workflows

### Hack on the Web UI or API

```bash
npm run dev
# open http://127.0.0.1:4173
```

`npm run dev` sets `THIRDFLARE_WEBUI=1` and runs `node server.js` in the foreground.

### Test against the mock WARP CLI

Plane M tests **never** require a real Cloudflare tunnel. Set:

```bash
export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"
```

The mock is stateful — connect/disconnect, modes, split tunnel, registration, etc. behave predictably. Used in CI on Linux, macOS, and Windows.

Run individual suites:

```bash
npm run test:mock-warp        # mock CLI unit tests
npm run test:integration      # HTTP API against mock daemon
npm run test:openapi          # response shapes vs openapi/thirdflare-api.json
npm run test:update           # semver, manifest, AppImage apply (mocked GitHub)
npm run test:notify           # desktop notification transitions
npm run test:registration     # registration parser
npm run test:killswitch       # nft rule generation (no live apply)
```

### Change packaging

After touching `packaging/` or `stage-payload.sh`:

```bash
npm run package:stage
npm run package:deb           # requires nfpm
./thirdflare-one build appimage
npm run package:verify        # if artifacts exist under dist/
```

See **[PACKAGING.md](PACKAGING.md)**.

### Change configuration defaults

1. Update `config/config.example.json` with comments.  
2. Document keys in **[CONFIGURATION.md](CONFIGURATION.md)**.  
3. Extend `lib/config.mjs` merge logic if adding layers.

---

## Testing expectations

### Before opening a PR

```bash
export WARP_CLI="$PWD/scripts/mock-warp-cli.mjs"
npm run check
npm run test:all
```

If you changed the Web UI or critical flows:

```bash
npm run test:ui
```

If you changed packaging:

```bash
npm run package:stage
# deb smoke when nfpm/docker available:
npm run package:deb
```

If you touched `/api/health`, `/api/version`, `/api/account`, `/api/killswitch`, or `/api/update/check`, manually smoke those routes or rely on integration/OpenAPI tests.

### CI confidence levels

| Plane | Required? | What it proves |
|-------|-----------|----------------|
| **M (mock)** | Yes — Linux, macOS, Windows | API contracts, parsers, mock integration, units |
| **R (real WARP)** | No — Ubuntu `main` only | Live connect/disconnect via `cdn-cgi/trace` |

Details: **[CI.md](CI.md)**

**Hard rule:** Do not enable kill-switch **apply** on shared GitHub-hosted runners. Rule **generation** belongs in unit tests; live apply is local/manual only.

---

## Code conventions

| Area | Convention |
|------|------------|
| Indentation | 2 spaces |
| JavaScript | `camelCase` identifiers; ES modules (`.mjs`) |
| Filenames | `kebab-case` |
| Commits | [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `chore:`, etc. |
| Releases | Release Please opens version bump PRs from conventional commits |

### UI / UX preferences (please follow)

- Use **ThirdFlare One** in user-visible strings, not bare “ThirdFlare”.
- Prefer a **single toggle** for connect/disconnect-style actions over separate On/Off buttons.
- Update-source controls use **comboboxes** for official repo and forks, not free-text fields.
- Tooltips and account UX should align with [Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/) — avoid placeholder account UI.
- UI polling must **preserve scroll position** (no jumping to top on refresh).

### Shell scripts

New scripts should use `set -euo pipefail`. CI runs `shellcheck` on Linux for `thirdflare-one`, `bin/*`, `scripts/*.sh`, and `packaging/scripts/*.sh`.

---

## Making changes by area

| You want to… | Start here |
|--------------|------------|
| Add a `warp-cli` command surface | `server.js` (`COMMANDS`, `/api/action` allow-list), then Web UI in `public/app.js` |
| Add an HTTP route | `server.js` + `openapi/thirdflare-api.json` + `scripts/ci-openapi.test.mjs` |
| Add config key | `lib/config.mjs`, `config/config.example.json`, `docs/CONFIGURATION.md` |
| Add update format / install detection | `lib/update/detect-format.mjs`, `lib/update/index.mjs` |
| Add desktop notification | `lib/notify/` |
| Add kill-switch behavior | `lib/killswitch/rules.mjs`, `scripts/thirdflare-nft-apply`, `packaging/polkit/` (unit tests in `ci-killswitch.test.mjs`, `ci-polkit-helper.test.mjs`) |
| Add tray / native shell behavior | `scripts/tray-qt.py`, `bin/thirdflare-tray`, `lib/tray/autostart.mjs`, `lib/tray/shell.mjs` |
| Add locale string | `public/locales/en.json` + `public/i18n.js` patterns |
| Add packaging format | `packaging/scripts/`, `packaging/nfpm.yaml` or format-specific manifest |

Parity with the Windows Cloudflare One app is tracked via the native simple shell and expert Web UI — extend both when adding major surfaces.

---

## Pull request checklist

- [ ] `npm run check` passes  
- [ ] `npm run test:all` passes with `WARP_CLI=scripts/mock-warp-cli.mjs`  
- [ ] User-facing changes documented in `docs/` or README if behavior changed  
- [ ] OpenAPI updated if HTTP contract changed  
- [ ] No secrets or registration tokens in commits, logs, or fixtures  
- [ ] Conventional Commit message(s)  
- [ ] Packaging smoke if you changed `packaging/` or install paths  

---

## Reporting issues

Include:

- ThirdFlare One version (`thirdflare-one --version`)
- OS and install method (AppImage, deb, `./thirdflare-one install`, checkout)
- `warp-cli status` output (redact account IDs if sensitive)
- Relevant log: `~/.cache/thirdflare/server.log`
- Steps to reproduce

---

## Where to help

High-impact areas:

- AppImage-bundled PyQt6/WebEngine (Phase 2 — host deps documented today)
- Self-contained Tauri/Electron shell (optional alternative to PyQt6)
- Windows visual parity
- Documentation and localization (`public/locales/`)

Read **[docs/STRATEGY.md](STRATEGY.md)** for product direction.

---

## Documentation map

| Document | Audience |
|----------|----------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Install, daily use, troubleshooting |
| [CONFIGURATION.md](CONFIGURATION.md) | Every config key and env var |
| [ARCHITECTURE.md](ARCHITECTURE.md) | API, components, security model |
| [PACKAGING.md](PACKAGING.md) | Build artifacts and release CI |
| [UPDATES.md](UPDATES.md) | Update manifest and channels |
| [CI.md](CI.md) | Plane M vs Plane R testing |
| [AGENTS.md](../AGENTS.md) | Agent/coding-assistant repo summary |

License: **MIT** — see [LICENSE](../LICENSE).
