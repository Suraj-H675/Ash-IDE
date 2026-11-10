# M8 — exclude legacy Orca relay from Ash desktop preload

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** validated clean `main` `74278062c160b38346bb4380ded1f22625c89090`
**Feature branch:** `feat/m8-no-legacy-relay-preload`
**Code commit:** `eec69be5a435b235f6d8b76e135082f262263dde`
**Classification:** verified, scoped M8 preload boundary removal — **not** full vertical excluded-code/package acceptance.

## Authoritative boundary and cause

D-005/D-006, the feature capability matrix, runtime architecture and M8 require no Ash-managed remote SSH development, legacy Orca remote relay or cloud-hosted app runtime. They explicitly preserve ordinary shell SSH, Git-over-SSH and locally owned persistent terminal/agent sessions.

A prior disposable native Arch Wayland run on `e2b9dc37` had one remaining *observed* missing IPC name, `legacyRelayBridge:listPanes`, despite no app-managed remote-SSH IPC service being registered. Root cause: `src/preload/index.ts` exposed a legacy relay API to every desktop renderer even though Ash never registered its Main bridge. The renderer's `legacy-relay-bridge-panes.ts` subscribed and invoked `listPanes` when that module was imported.

## Changes and limits

- Removed the `legacyRelayBridgeApi` import and `legacyRelayBridge` property from Ash's Electron preload. The renderer's pre-existing optional-bridge guards now resolve to no bridge without dispatching to Main. **No** fake/synthetic `listPanes` handler, remote runtime, SSH host reconnection or server was added.
- Added the direct Node regression test `legacy-relay-bridge-panes-no-preload.test.ts`: import/first-listing settles without a bridge; lookups, tab ownership/closing and PTY ID selections for absent remote panes remain empty/null; no remote bridge property appears in the test fixture.
- Registered the regression test in the hosted Node-forks excluded-renderer-startup gate.
- Retained the native PTY preload methods, existing local daemon/runtime, normal SSH shell command and Git-over-SSH paths untouched.

**Scope limit:** dormant legacy remote-relay implementation sources, optional TypeScript bridge contract, tests and some remote SSH code paths still exist in the repository. This milestone disables their *desktop preload exposure* but does not establish full M8 vertical deletion or prove all unused upstream assets absent from shipped installers. Preserve the user-facing ability to run `ssh` from a normal terminal.

## Local evidence

- Direct Node Vitest forks: **59/59 PASS** across five suites: the new no-bridge selector regression, the inherited 19-case bridge transport suite, the three-case unserved SSH pane suite, 35 committed-local PTY spawn evidence cases and the PTY SSH binding persistence case.
- Node/renderer TypeScript, Oxfmt, native Oxlint and type-aware Oxlint with denied warnings: **PASS**.
- Electron **source** build: **PASS**; sandbox preload validated and renderer built (260 chunks). Known inherited ineffective dynamic-import warnings remain.
- The generated source desktop bundle `out/preload/index.js` contains **zero** `legacyRelayBridge` symbols.
- Pinned Orca MIT license digest unchanged: `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`. Provenance PASS on 33,506 pinned upstream records / 270 Ash-adapted file hashes / 8,260 documented removals.

## Native Wayland — actual Electron application and exact SHA

Ran exact code commit `eec69be5a435b235f6d8b76e135082f262263dde` on Arch Linux/Hyprland native Wayland, using fresh private `/tmp/ash-gui-ready-qa-oe30cF/` HOME/XDG, Ash userData/browser, CODEX_HOME and CLAUDE_CONFIG_DIR. No regular user repositories, provider accounts, SSH credentials/hooks, other applications' data or global configuration were touched. A local disposable project skill was used for independent provider-native skill discovery.

**44/44 native assertions PASS**, including a mapped `ash-ide` Wayland window titled **Ash IDE**, first-window ready service barrier, renderer reload, local persistent runtime pointer, private provider-usage snapshot, GitHub PR refresh IPC, local provider-native skill discovery, read-only updater, Ash Help and onboarding surfaces, denial of excluded crash/diagnostic uploads, disabled telemetry preload, **absence** of `window.api.legacyRelayBridge`, **absence** of `legacyRelayBridge:*` Main registrations, and **presence** of local PTY spawn/write preload functions.

The previous verified native run `e2b9dc37` recorded one distinct missing-handler name (`legacyRelayBridge:listPanes`). The exact-commit run recorded **zero** missing IPC handler names in its Electron stderr, console and CDP capture. No new missing handlers appeared. This is a measured startup-log improvement, not a claim that every possible future renderer route has been tested.

The test-owned terminal daemon and local runtime both stopped with exit code 0, with no remaining profile-scoped processes. QA log, events, result JSON and screenshot stay in the private temporary test directory and are not committed.

## Remaining acceptance gates

Exact final-tip feature CI, deliberate main integration, post-integration tests, remote main-branch equality and exact main hosted CI are separate gates. Remaining M8 source/preload/RPC/CLI/assets exclusions, packaged AppImage and X11 smoke, full Windows/macOS native workflow, complete real authenticated provider turns, multi-window persistent-session reattachment, and trusted root SessionStart correlation remain **OPEN**.
