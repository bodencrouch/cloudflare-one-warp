# Kill switch

Native **nftables** kill switch blocks non-WARP traffic when enabled and WARP is disconnected.

## API

```bash
curl -s http://127.0.0.1:4173/api/killswitch | jq
curl -X POST http://127.0.0.1:4173/api/killswitch \
  -H 'Content-Type: application/json' \
  -H "x-thirdflare-session: $(cat ~/.config/thirdflare/session-4173.token)" \
  -d '{"enabled": true}'
```

Applying rules requires privilege — typically **pkexec** / polkit on Linux.

## Implementation

- Rule generation: `lib/killswitch/`
- Tests: `npm run test:killswitch`
- UI toggle in Web UI / native panel

## Safety

Review generated rules before enabling on production machines. Disable from UI or API before uninstalling ThirdFlare One if rules persist.

See repository `docs/ARCHITECTURE.md` for apply flow.
