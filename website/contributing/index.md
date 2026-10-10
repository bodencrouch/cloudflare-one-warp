# Contributing

Thank you for improving **Cloudflare One WARP**.

## Setup

```bash
git clone https://github.com/bodencrouch/cloudflare-one-warp.git
cd cloudflare-one-warp
npm install
npm run check
npm run test:all
```

## Conventions

- 2-space indent, `camelCase` in JS, `kebab-case` filenames
- [Conventional Commits](https://www.conventionalcommits.org/) for clear changelogs
- Product name **Cloudflare One WARP** in user-facing strings
- Plain language in UI — no planning/prompt copy

## Test planes

| Plane | Scope |
|-------|-------|
| **M** | Mock warp-cli — required CI on Linux/macOS/Windows |
| **R** | Real WARP smoke — optional Ubuntu |

See [CI.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/CI.md).

## Before handoff

```bash
npm run check
npm run test:all
```

After API changes, smoke `/api/health`, `/api/version`, `/api/account`, `/api/killswitch`, `/api/update/check`.

## Docs

- Repository markdown: `docs/`
- Published site: this VitePress site (`website/`)
- Update both when behavior changes

Full guide: [CONTRIBUTING.md](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/docs/CONTRIBUTING.md).
