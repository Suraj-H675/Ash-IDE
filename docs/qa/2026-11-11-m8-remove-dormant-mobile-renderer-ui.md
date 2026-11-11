# M8 — remove unreachable phone pairing and relay renderer UI

**Date:** 2026-11-11 (Asia/Kolkata).

**Branch:** `feat/m8-remove-dormant-mobile-renderer-ui`, based on the accepted `main` `e223c25fc65c55da8d598b9cce23d912cbddbd54`.

**Classification:** A scoped M8 desktop source-removal milestone, not full M8, packaged AppImage, X11 or cross-platform release acceptance.

## Source and retained functionality

- Removed **49 obsolete phone-facing renderer files**, including the old Mobile page and phone-install carousel, QR/address/network/Windows firewall pair controls, phone device polling, mobile Settings panes and search, the unused mobile sidebar badge, the hidden remote-runtime Share Computer/phone-based pairing panels, and the Ash-owned `require-legacy-mobile-api.ts` compatibility guard. All these entry points had already been excluded from live Ash navigation and preload.
- **48 deleted paths** are upstream-derived Orca sources, each entered into `docs/provenance/ash-exclusions.json` with its exact original source SHA-256. The one Ash-authored compatibility helper has no upstream source and was **not** invented as an Orca record.
- Preserved all **five retained local mobile-emulator Settings files**, including their live Settings renderer and search entry. Also preserved the shared `MobileBrandIcons.tsx` module because that emulator uses its Android and iOS icons. An initial removal candidate was restored after full TypeScript found this real dependency, before tests/commit; its proposed provenance removal entry was discarded.
- Preserved active desktop terminal `mobile-driver-state`, fit, native chat, WebSocket E2EE local-browser pairing, browser extensions, native emulator and provider workflows. Do not equate `mobile` in an internal code symbol with an excluded phone feature.
- Changed `ash-excluded-mobile-entrypoints.test.ts` to verify phone pairing source **absence** and emulator/source positive presence rather than merely checking that archived UI throws if someone clicks it. The retained Settings navigation and desktop active-view fallback tests continue to run.
- Did not edit or migrate historical device records, provider homes, repositories, outside application data, browser partitions or saved credentials. No existing worktree was deleted.

## Observed verification

- Direct renderer negative/positive gate: **4/4 PASS**.
- Expanded runtime, local encrypted browser and device-key authentication, terminal-fit/mobile-named desktop driver overlays, PTY streaming, agent launch/replay, native/headless Orcad, revocation, and renderer/preload negative surface tests: **226/226 PASS across 27 suites**.
- Full TypeScript project check: **PASS** after protecting `MobileBrandIcons.tsx` for the local emulator.
- Changed-source Oxfmt and both native and type-aware Oxlint `--deny-warnings`: **PASS**, zero warnings/errors.
- Provenance: **PASS**, 33,506 pinned Orca records, 350 current Ash adaptations, **8,330 documented removals**, unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded production Electron source build: **PASS**, plain Node daemon-entry and sandbox preload guards passed; renderer boot graph 255 chunks / 7,836.4 KB minified. Existing ineffective dynamic-import bundler warnings persist.
- Native Linux Wayland Electron source-app startup with disposable private profile `/tmp/ash-m8-no-phone-ui-wayland-OuN4ig`: **PASS**, real `Ash IDE` renderer DOM complete, preload present, local `pty.spawn`, `nativeChat` and `settings` retained, excluded `mobile`, `automations` and `speech` preload keys absent. HOME/XDG/Codex/Claude/GitHub CLI/Git global profiles redirected into the test directory. Test Electron and three profile-matched helpers were stopped.
- Feature-tip GitHub CI and integrated `main` CI remain **separate gates**; their exact SHA and results must be observed before accepting the milestone.

## Explicit remaining M8 work

The old i18n locale JSON files still include unreachable phone pairing translation strings. The Web client has phone-named legacy bridges. Dormant `src/main/runtime/mobile-desktop-relay`, cloud relay implementation, old managed-host sources and some runtime-remote pairing form fragments remain for later import/reachability/bundle audits. Do not claim all excluded mobile code or words are absent from compiled assets. Local browser pairing and optional local emulator are retained; do not delete them merely because a type or file name says `mobile`.

Packaged AppImage and standalone daemon/listener process-tree inspection, Linux X11, macOS/Windows and real provider E2E acceptance remain unverified. Full M8 is not accepted.

## Git workflow

Reused the existing clean `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward` implementation worktree and switched it to this feature branch. Canonical `main` stays the last accepted integration tip until hosted feature CI passes. No new checkout, force push, unrelated cleanup or destructive Git operation.
