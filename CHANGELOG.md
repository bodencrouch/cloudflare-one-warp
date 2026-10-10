# 0.3.2 (2026-10-10)

* Quote the product name in the interactive installer.
* Use filesystem URL conversion in the Windows readiness test.
* Keep the documentation build artifact available when Pages administration is unavailable.

# 0.3.1 (2026-10-10)

* Resolve the AppImage launcher inside the bundled filesystem.
* Preserve the XML declaration and apply manifest permissions when finishing Flatpak builds.

# 0.3.0 (2026-10-10)

* Rename the client, commands, configuration, services, app IDs, and distribution packages to Cloudflare One WARP.
* Fix documentation asset paths and configure GitHub Pages before deployment.
* Rebuild all release formats under the new package names.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Local API mutations now require a loopback Host and peer, a same-origin request, a JSON body, and this daemon's session credential (`X-Cloudflare-One-Warp-Session`), so a web page cannot drive WARP or change settings. Read-only endpoints stay open for diagnostics
- Serve `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a Content-Security-Policy on API and Web UI responses
- AppImage self-update installs only after a detached Ed25519 signature from a pinned release key verifies; missing, malformed, and unknown-key signatures fail closed and leave the installed binary untouched
- Refuse to install a release older than the installed version
- Fail the release build when an AppImage would ship without its `.sig` sidecar
- Run the daemon service with `ProtectSystem=strict` and a narrow set of writable paths, restricted socket families, and no namespace, realtime, or SUID access

### Added

- Shared readiness answer (`GET /api/readiness`, also embedded in `/api/snapshot`) so tray, Web UI, and launcher agree on hard blockers vs soft warnings
- Clipboard diagnostics (`GET /api/diagnostics` + Copy diagnostics on Home)
- Tray icons that distinguish connected, connecting, disconnected, and needs-attention
- Always On kill-switch UI modes: Off, Always On, and Paused (enrollment)

### Fixes

- Ship the modules the packaged daemon actually imports: `lib/api-revision.mjs`, `lib/tray/shell.mjs`, `lib/warp/split-tunnel.mjs`, `lib/warp/status-listener.mjs`, plus `daemon-ready.mjs`, `tray-shell-cli.mjs`, and `tray-warp-action.py`. The installed `.deb` failed at startup with `ERR_MODULE_NOT_FOUND`
- Add `npm run test:packaging`, which derives the required file set from the code and fails when `stage-payload.sh` misses one
- Green up Plane M CI: the proxy-launcher XDG tests asserted Linux-only behaviour on macOS and Windows, where `listDesktopApps()` returns `[]` by design, so every OS had been failing since July
- Reject cross-site writes on every mutating route (`Sec-Fetch-Site`, `Origin`, and a required `application/json` content type), so a hostile page can no longer drive `warp-cli`, systemd, or the user's config through the loopback daemon
- Run `systemctl --user` and `pkill` off the event loop — a hung user manager could block every SSE subscriber and health check for the length of the timeout
- Fix tray autostart never starting: the generated entry carried `Hidden=true`, which in an autostart directory means "ignore this entry" (`systemd-xdg-autostart-generator` logs "not generating unit, entry is hidden")
- Keep `tray.autostart` as a remembered preference instead of forcing it off when Cloudflare One Client is selected, so it survives a switch there and back
- Report `active` and `effective` from `POST /api/config/tray-autostart` rather than a bare `ok` for a preference that changes nothing today
- Re-evaluate notification ownership when the desktop app or `ui.notifications` changes, instead of freezing it at daemon startup
- Stop a scripted or piped re-install from resetting the user's desktop-app choice (`sync-tray-autostart --if-unset`)
- Close the Cloudflare One WARP tray and panel before restarting the daemon they talk to, so switching to Cloudflare One Client no longer leaves an open panel showing a connection error
- Do not swap the running shell twice when saving from the native settings dialog — the daemon already does it, and the second pass could leave two Cloudflare tray icons
- Skip the live shell swap on non-Linux instead of falling through to the Cloudflare One WARP branch and running `pkill`/`spawn` there

- Keep the Cloudflare One WARP Web UI off while Cloudflare One Client is the desktop app — the daemon now starts API-only on that path
- Turn the Web UI back off when switching from the Cloudflare One WARP tray to Cloudflare One Client, unless `webui.enabled` is set
- Leave `warp-desktop-svc` unit management to the host under Flatpak instead of writing a unit systemd never reads
- Let Cloudflare One Client own status notifications while it is active, so one WARP transition no longer notifies twice
- Detect a running `warp-desktop-svc` by command line — `pgrep -x` never matched its 16-character process name, so the fallback could start a second copy
- Report WARP status from the active desktop app in `cloudflare-one-warp-tray --status`
- Start `warp-taskbar` from the user's home so its `.sentry-native/` cache no longer lands in the Cloudflare One WARP install tree
- Sandbox `HOME` and `XDG_CONFIG_HOME` in the suites that spawn the daemon — `npm run test:all` was rewriting the developer's real `~/.config/cloudflare-one-warp/config.json` and deleting their real tray autostart entry
- Thread `env` through `describeTrayShell` into `detectCloudflareGui`, so Flatpak detection reads the caller's environment instead of the sandbox
- Re-enable `warp-desktop-svc.service` on uninstall when Cloudflare One WARP had taken over the desktop app, so Cloudflare One Client keeps its background service
- Scope `--force-cloudflare-one-warp` to the session: stop only the Cloudflare tray icon, leave `warp-desktop-svc` running, and put the icon back if the Cloudflare One WARP tray fails to start

### Documentation

- Publish VitePress docs to GitHub Pages (install, CLI, API, guides, packaging)
- Rewrite docs homepage hero: plain-language copy, correct default port (4173), simple vs expert UI, opt-in kill switch
- Refresh docs hero for app routing, WARP internals page, and 0.2.7 capability map
- Fix docs site port drift (4173) and snapshot paths for split tunnel examples
- Add docs/WARP_INTERNALS.md (warp-cli modes, warp-docker reference)
- Add UI controls smoke test for expert-mode toggles, segmented controls, and app routing picker

### Features

- Document every mutating route in `openapi/cloudflare-one-warp-api.json`, including `POST /api/config/tray-autostart` and the shared `403` cross-site response
- Desktop app switch: default to host Cloudflare One Client tray, or Cloudflare One WARP’s PyQt6 tray (`tray.shell`, `POST /api/config/tray-shell`, install `--shell`)
- Run `warp-desktop-svc` from a Cloudflare One WARP-managed systemd user unit when the WARP package ships none (`~/.config/systemd/user/cloudflare-one-warp-desktop-svc.service`)
- Launch `warp-taskbar` and `warp-desktop-svc` on the host through `flatpak-spawn --host` when Cloudflare One WARP runs under Flatpak
- Report `warp-taskbar` and `warp-desktop-svc` state in `cloudflare-one-warp-tray --check`
- Linux native shell: PyQt6 tray + embedded Web UI with Cloudflare One Client–style simple layout (`/?shell=1`) and expert-mode toggle
- Native PyQt6 system settings (`cloudflare-one-warp-tray --settings`) for Web UI enable, HTTP port, desktop app, tray autostart, and notifications
- Web UI startup modes: API-only by default (`--no-open`, systemd); `--daemon` serves full static UI with no runtime disable toggle
- Persist Web UI and server settings via `POST /api/config/webui`, `POST /api/config/server`, and `POST /api/config/ui`
- First-class tray packaging: stage tray Python modules, `/usr/bin/cloudflare-one-warp-tray`, PyQt6 recommends in deb/rpm/Fedora spec
- Polkit-scoped kill switch: `cloudflare-one-warp-nft-apply` helper + `com.cloudflare.one.warp.policy`; GET `/api/killswitch` stays unprivileged
- Opt-in tray autostart (`tray.autostart` config + `POST /api/config/tray-autostart`)
- Always On (Linux) UX: kill switch labeled as Windows Always On equivalent in UI and docs
- Recognize warp-cli `WarpProxy on port …` Mode string for app routing UI (see docs/WARP_INTERNALS.md)
- Split tunnel in-app guide (IP/domain routing vs per-app limitations)
- Scenario-driven routing UX: Split Tunnel status banner, three setup cards (Exclude / Include / Local proxy), removable route lists, Tunnel proxy guide, and simple Connectivity entry point
- Structured `splitTunnel` snapshot from `lib/warp/split-tunnel.mjs` for live mode and route counts

### Bug Fixes

- Share one `warp-cli --listen status` process per daemon (SSE + notifications); fixes leaked listener processes on UI reconnect
- Web UI: eliminate half-enabled 503 state; tray starts `--daemon` with full static serving; KDE Settings desktop entry
- App routing: recognize real warp-cli Mode string `WarpProxy on port 40000` so the app picker appears after enabling local proxy
- KDE launcher: single app menu entry launches native PyQt6 tray (not Firefox); removed Desktop Actions that Plasma indexed as duplicates
- Stale daemon detection: restart API server after install or when `apiRevision`/version mismatch (fixes “Unknown API route” on Settings toggles)

## [0.2.7](https://github.com/bodencrouch/cloudflare-one-warp/compare/v0.2.6...v0.2.7) (2026-07-18)


### Bug Fixes

* **ci:** gate publish-stores jobs via check-secrets job ([e27a3db](https://github.com/bodencrouch/cloudflare-one-warp/commit/e27a3db97b06f828d6a88ef7e47ab979845aa71d))
* **ci:** trigger publish-stores on workflow file push ([963f156](https://github.com/bodencrouch/cloudflare-one-warp/commit/963f15667a7878867811662fc03bef809858df96))
* stabilize killswitch tests under sudo and enrollment pause ([d2837b2](https://github.com/bodencrouch/cloudflare-one-warp/commit/d2837b20d2414fa71ef3d7b1e78bd6bb2213fb2c))

## [0.2.6](https://github.com/bodencrouch/cloudflare-one-warp/compare/v0.2.5...v0.2.6) (2026-07-18)


### Features

* add Linux store discoverability and publish automation
* rename Flatpak app-id to `io.github.bodencrouch.CloudflareOneWarp`
* add Flathub, Snap, Fedora COPR (Packit), AUR, and AppImageHub packaging scaffolding
* add `publish-stores.yml` workflow and publish helper scripts
* add [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) install matrix per channel

## [0.2.4](https://github.com/bodencrouch/cloudflare-one-warp/compare/v0.2.3...v0.2.4) (2026-07-18)


### Bug Fixes

* **ci:** disambiguate homebrew-tap branch vs Formula dir ([#13](https://github.com/bodencrouch/cloudflare-one-warp/issues/13)) ([597b637](https://github.com/bodencrouch/cloudflare-one-warp/commit/597b637e9796a3139f08b357fdb1ea027961829b))

## [0.2.3](https://github.com/bodencrouch/cloudflare-one-warp/compare/v0.2.2...v0.2.3) (2026-07-18)


### Features

* **ci:** Cross-OS CI confidence + basic Account ([#12](https://github.com/bodencrouch/cloudflare-one-warp/issues/12)) ([352a4dc](https://github.com/bodencrouch/cloudflare-one-warp/commit/352a4dcf9e2c518a9708ec299e202deb4547add3))
* **config:** persist kill switch desired state to user config ([#10](https://github.com/bodencrouch/cloudflare-one-warp/issues/10)) ([8b3a6c2](https://github.com/bodencrouch/cloudflare-one-warp/commit/8b3a6c2f6014cf7896f72df886a8a715336c2e82))
* **killswitch:** pause nft rules during Zero Trust enrollment ([#11](https://github.com/bodencrouch/cloudflare-one-warp/issues/11)) ([51096a7](https://github.com/bodencrouch/cloudflare-one-warp/commit/51096a7e9b11793729db42c8784751c6cb355132))


### Bug Fixes

* **ci:** chain Package from Release Please via workflow_call ([#8](https://github.com/bodencrouch/cloudflare-one-warp/issues/8)) ([20c7a8b](https://github.com/bodencrouch/cloudflare-one-warp/commit/20c7a8b95a876a3807cadd679bd00e88ca43fb34))

## [0.2.2](https://github.com/bodencrouch/cloudflare-one-warp/compare/v0.2.1...v0.2.2) (2026-07-18)


### Features

* Account enrollment, kill switch, tips, and update comboboxes ([#6](https://github.com/bodencrouch/cloudflare-one-warp/issues/6)) ([79f0886](https://github.com/bodencrouch/cloudflare-one-warp/commit/79f0886b0d8c9cafe30ae0985897f3dbf123d5d5))

## [0.2.1](https://github.com/bodencrouch/cloudflare-one-gui-linux/compare/v0.2.0...v0.2.1) (2026-07-17)


### Features

* desktop notifications on WARP status transitions ([f357041](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/f357041e41fdfb7f8fda6b60000ba14d241e1e0f))
* emit desktop notifications on WARP status transitions ([e4bd3b1](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/e4bd3b1abf26c7fd68d8aa6c158620d95e1f8745))

## [0.2.0](https://github.com/bodencrouch/cloudflare-one-gui-linux/compare/v0.1.0...v0.2.0) (2026-07-17)


### ⚠ BREAKING CHANGES

* rebrand project to Cloudflare One WARP

### Features

* add CI/CD, WARP tests, packaging, GHCR, and Homebrew tap ([ba07197](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/ba071971c68c1f1ac44b446bb2111f7de481d2b4))
* add i18n, tooltips, and release-synced updates ([163ff94](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/163ff94e472733ac543a152533a0a7293026d5bc))
* rebrand project to Cloudflare One WARP ([3ac222d](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/3ac222d2385c73478322ee1175a8336fa25ae362))
* Cloudflare One WARP rebrand, i18n, and release-synced updates ([54076a7](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/54076a79c34e861877a844cb59baea6b3e646585))


### Bug Fixes

* **ci:** skip Flatpak appstream compose and fix arch verify pipe ([081fee8](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/081fee871f4d0344943824b817ede629f5507e83))
* **ci:** stabilize package verification and flatpak build ([5299b35](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/5299b35ba810cb5d245606e9fd2356b7b6ee2c39))
* **flatpak:** drop unsupported build-export flag on CI ([dd2865a](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/dd2865a44fe651c69d40955f93da6db3e3a16005))
* **flatpak:** finish build dir and skip appstream branch update ([9731bac](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/9731bacdd8b75e2949eab0922a73f3caf8411412))
* **flatpak:** normalize xdg filesystem finish-args ([068e6fe](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/068e6fe8e298652152d0f0d45a6e67723ab4638d))
* **flatpak:** restore flatpak-builder repo export after metainfo fix ([07ba7cc](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/07ba7cc2f028725e936f645916167760ed8a01de))
* **flatpak:** use valid xdg filesystem paths in build-finish ([2c87c21](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/2c87c21a44084cd492e544ca5392cbc8b1a3cb0f))
* **flatpak:** validate AppStream metadata and export build dir ([69e7db8](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/69e7db86c455b71f903ef595bd96b9dbf89062fb))
* harden AppImage apply against remote session pivot ([1ba701f](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/1ba701f4b3190aa1fab05ecc54f40643db7be961))
* harden update apply and session config allowlist ([26f6e91](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/26f6e91ce263327a2589817ad4db305fb288731b))
* **packaging:** correct deb Depends syntax and Flatpak metainfo ([5e9a30c](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/5e9a30c6b38a841840edc9f94d231594e1408856))
* **packaging:** stage lib/update/confirm.mjs in package payload ([5584287](https://github.com/bodencrouch/cloudflare-one-gui-linux/commit/5584287ae60890771c96eae013531a5f05469b26))

## [0.1.0] - 2026-07-17

### Added

- Initial local Cloudflare One / WARP GUI for Linux (`server.js` + browser UI).
- Desktop launcher, optional yad tray, and user systemd helpers.
