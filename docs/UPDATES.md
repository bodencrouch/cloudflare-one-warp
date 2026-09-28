# Updates

ThirdFlare One checks GitHub Releases for newer versions, with optional AppImage auto-apply and fork/release selection (PyKotor-inspired, streamlined).

## Pipeline

```text
Conventional Commits on main
        │
        ▼
release-please.yml  →  Release PR  →  GitHub Release (tag vX.Y.Z)
        │
        ├─ (same push run) package.yml via workflow_call
        │     — required because GITHUB_TOKEN-created releases do not
        │       fire other workflows' `on: release` triggers
        │
        └─ package.yml also still listens for `release: published`
              (manual / non-Actions releases)

package.yml
        │
        ├─ deb / rpm / AppImage / Flatpak / Snap / Docker / Homebrew
        │
        └─ sync-manifest job
              updates config/update-manifest.json on main [skip ci]
```

### Release Please permissions

If Release Please fails with *GitHub Actions is not permitted to create or approve pull requests*:

1. Open the repo **Settings → Actions → General**
2. Under **Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**
3. Re-run the Release Please workflow

### Why Package is called from Release Please

GitHub does not start new workflow runs for `release` (or other) events that were produced using the default `GITHUB_TOKEN`. Release Please publishes with that token, so `package.yml`'s `on: release` alone never runs after an automated release. The `workflow_call` job in `release-please.yml` runs Package in the same workflow graph when `release_created` is true.

## Update manifest

[`config/update-manifest.json`](../config/update-manifest.json) is the stable URL clients fetch:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/config/update-manifest.json
```

Schema:

```json
{
  "schema": 1,
  "stable": { "version": "0.1.0", "tag": "v0.1.0" },
  "beta": null
}
```

- **stable** — latest non-prerelease
- **beta** — latest prerelease pointer (optional)

Regenerate locally:

```bash
node scripts/generate-update-manifest.mjs --version 1.2.0
node scripts/generate-update-manifest.mjs --version 1.3.0-beta.1 --prerelease --dry-run
```

## Client behavior

| Install format | In-app apply |
|----------------|--------------|
| AppImage | Download matching `thirdflare-*-x86_64.AppImage`, replace binary, prompt restart |
| deb / rpm / Homebrew / Flatpak / Snap | Show copy-paste upgrade commands |

Config keys (see [CONFIGURATION.md](CONFIGURATION.md)):

- `updates.channel` — `stable` | `beta`
- `updates.source` — `{ owner, repo }` (default upstream; change via config file/env to use a fork — **not** session-overridable)
- `updates.checkOnStartup` — non-blocking toast when Web UI is open

APIs:

- `GET /api/version`
- `GET /api/update/check` — includes one-time `applyConfirmToken` for AppImage applies
- `GET /api/update/releases?owner=&repo=`
- `GET /api/update/forks`
- `POST /api/update/prepare` — resolve tag + issue apply token
- `POST /api/update/apply` — AppImage only; requires `confirmToken` and a valid release signature; refused when bind is non-loopback unless `THIRDFLARE_ALLOW_REMOTE_APPLY=1`

The apply confirmation token is a one-time binding between a UI prompt and a release asset — it is not authentication. Callers must also pass the [request gate](ARCHITECTURE.md#request-gate).

Optional auth for higher GitHub rate limits: `THIRDFLARE_GITHUB_TOKEN` or `GITHUB_TOKEN`.

Override install detection: `THIRDFLARE_INSTALL_FORMAT=appimage|deb|rpm|…`  
AppImage path override: `THIRDFLARE_APPIMAGE_PATH=/path/to/ThirdFlare-One.AppImage`

AppImage downloads re-validate redirect hosts on every hop and verify against release `SHA256SUMS` when that asset is published. A checksum alone never authorizes a replacement — see below.

## Update signatures (required)

An AppImage is only installed when a detached Ed25519 signature from a pinned release key verifies against the downloaded bytes. If the signature is missing, unreadable, or made by an unknown key, ThirdFlare One deletes the download, leaves the installed binary and its `.bak` untouched, and tells the user to download the release manually.

| Item | Value |
|------|-------|
| Algorithm | Ed25519 over the **raw asset bytes** |
| Sidecar asset | `<asset name>.sig` (e.g. `thirdflare-1.2.0-x86_64.AppImage.sig`) |
| Sidecar contents | base64 of the 64-byte signature (raw 64 bytes also accepted) |
| Trusted keys | base64 of raw 32-byte public keys, pinned in [`lib/update/trusted-keys.mjs`](../lib/update/trusted-keys.mjs) |
| Verifier | [`lib/update/verify-signature.mjs`](../lib/update/verify-signature.mjs) |

Downgrades are refused: a release older than the installed version is never applied. `THIRDFLARE_ALLOW_DOWNGRADE=1` exists for operator recovery only and is deliberately absent from the UI.

### One-time key setup

The key ring ships **empty**, so self-update fails closed until a release key is pinned. Generate the key once, offline, on a machine that does not run CI:

```bash
node scripts/sign-release.mjs keygen --out ~/.thirdflare-signing/release.pem
```

Then:

1. Commit the printed entry to `lib/update/trusted-keys.mjs` (the **public** key only).
2. Store the private key offline with a backup; add it to CI as the `THIRDFLARE_SIGNING_KEY_PEM` secret.
3. Cut a release. Users on older builds still upgrade manually — they have no pinned key yet.

### Signing a release

`packaging/scripts/checksums.sh` signs every AppImage in `dist/packages` when `THIRDFLARE_SIGNING_KEY_PEM` (contents) or `THIRDFLARE_SIGNING_KEY` (path) is set, and **fails the build** if any AppImage would ship without a `.sig`. Local builds can pass `THIRDFLARE_ALLOW_UNSIGNED=1`; those builds cannot be used for self-update.

```bash
node scripts/sign-release.mjs sign --key ~/.thirdflare-signing/release.pem dist/packages/*.AppImage
node scripts/sign-release.mjs verify dist/packages/*.AppImage        # against pinned keys
```

Publish the `.sig` files as release assets next to the AppImage.

### Rotating keys

Add the new public key alongside the current one and ship that change as a normal release. Because the key ring only reaches users through an update signed by the *current* key, trust always chains from a key they already have. Remove the retired key one release later. If a private key is lost, users must reinstall from the releases page — recovery is deliberately outside the updater.

## Asset naming contract

Forks can be selected for update *checks*, but in-app AppImage apply only accepts signatures from keys this build pins. A fork that wants self-update must ship its own build with its own key in `trusted-keys.mjs`; otherwise its users upgrade manually.

Forks that want to be selectable must publish assets matching:

| Format | Pattern |
|--------|---------|
| AppImage | `thirdflare-<version>-x86_64.AppImage` (+ `.sig` signed by a key the client pins) |
| deb | `thirdflare_<version>_all.deb` |
| rpm | `thirdflare-<version>-1.noarch.rpm` (or similar `*.rpm`) |
| snap | `thirdflare_<version>_amd64.snap` |

## Tests

```bash
npm run test:update
npm run test:all
```
