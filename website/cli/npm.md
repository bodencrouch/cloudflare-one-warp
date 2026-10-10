# npm scripts

From repository root (`package.json`):

## Development

```bash
npm run dev              # server with CLOUDFLARE_ONE_WARP_WEBUI=1
npm run check            # syntax check all modules + UI
```

## Tests

```bash
npm run test:all         # all Plane M suites
npm run test:integration
npm run test:mock-warp
npm run test:openapi
npm run test:update
npm run test:notify
npm run test:registration
npm run test:killswitch
npm run test:ui          # Playwright (mock daemon)
npm run test:warp:real   # real warp-cli (soft-skip unless required)
npm run verify:install
```

## Packaging

```bash
npm run package:stage
npm run package:deb
# see docs/PACKAGING.md in repo for full matrix
```

Prefer `./cloudflare-one-warp test all` as the operator-facing alias for contributors.
