# OpenAPI

Machine-readable contract: [`openapi/cloudflare-one-warp-api.json`](https://github.com/bodencrouch/cloudflare-one-warp/blob/main/openapi/cloudflare-one-warp-api.json).

## Validation

Plane M runs `npm run test:openapi` against a live mock daemon. Drift between `server.js` routes and the spec fails CI.

## Version field

The `info.version` in OpenAPI tracks the API revision — compare with `lib/api-revision.mjs` and package semver when debugging mismatches.

## Servers block

Example config lists port `4173`. The launcher uses the same default and may bind a nearby port when busy — read `/api/config` for the effective bind/port.

## Extending

When adding routes:

1. Implement handler in `server.js`
2. Extend `openapi/cloudflare-one-warp-api.json`
3. Add cases to `scripts/ci-openapi.test.mjs`

## External tools

Import the JSON into Insomnia, Postman, or Redocly for interactive exploration. For published docs, this site is the human-facing source of truth.
