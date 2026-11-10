# M8 — exclude speech preload and mounted dictation UI; native Wayland evidence

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** validated clean `main` `3de580cbd644114eaa2e6316da83ad78d8a88cac`
**Branch:** `feat/m8-exclude-speech-preload-and-ui`
**Feature code commit:** `4d066f574072ee4a33639dcbb6ea853fbf875e8d`
**Classification:** Scoped M8 voice/dictation startup/preload/Settings exclusion. **Not** complete M8 or release/package verification.

## Approved boundary and cause

The approved `03_FEATURE_CAPABILITY_MATRIX.md` classifies app voice, dictation, transcription and speech-model services **excluded**; ordinary typed chat, native chat, local terminal/PTY, Git and explicitly authorized Computer Use remain retained. `10_IMPLEMENTATION_MILESTONES.md` requires vertical exclusion from startup, renderer, IPC, preload, bundled assets and installers, verified progressively without breaking retained functionality.

Ash Main already did not register any `speech:*` handlers. Nevertheless, the inherited desktop preload still exposed the complete `speech` API (including model downloads and microphone-fed transcription), the Settings capability navigation still displayed Voice/model-download controls, and `AppRootSurfaces` could lazily mount `DictationController` when the saved voice setting was enabled or dictation state was non-idle. Those caller paths conflicted with the approved exclusion.

## Changes and retained protections

- Electron preload no longer imports or publishes `speechApi`; `PreloadApi.speech` is optional only to type remaining legacy source/test modules. It is **absent** from the Ash desktop object, rather than exposed as an inert synthetic IPC implementation. No new Main speech, cloud account, model-download, or microphone handler is registered.
- `AppRootSurfaces` no longer imports or mounts `DictationController` and no longer subscribes to persisted voice-enabled/dictation state. A stale prior voice preference therefore cannot cause that root component to start dictation.
- The desktop Settings renderer and navigation omit the Voice section, while retaining Computer Use, Agents and Accounts. Settings no longer launches an automatic speech-model state scan merely because the page opened.
- Archived, currently unmounted voice modules use `requireLegacySpeechApi()`, which throws a clear unavailable error when Ash's speech API is absent. The old audio capture hook performs this check **before** it calls `openMicrophoneCaptureStream` / `getUserMedia`, and the archived Voice enable button checks before requesting microphone permission. Local data/settings are not deleted or migrated by this slice.
- The new `ash-excluded-speech-entrypoints.test.ts` checks desktop Settings capability navigation, the fail-closed legacy API helper and source-level negative entrypoint contracts. The test is included in hosted Node-forks renderer exclusion CI.

This intentionally leaves unused upstream VoicePane, speech worker/model modules, some shortcuts/search/migration definitions and web-only bridge code for later classified M8 removal. This slice does **not** claim that a packaged application contains no speech asset or that all historical settings/shortcut paths have been migrated.

## Verification

- Direct Node Vitest forks: **14/14 PASS** across four suites (new speech boundary cases 3/3, excluded renderer startup 9/9, plugin-host boundary 1/1 and no-legacy-relay pane 1/1).
- Main/renderer TypeScript: **PASS**. Oxfmt plus native and type-aware Oxlint with warnings denied: **PASS**.
- Electron **source** build and sandbox preload verification: **PASS**, renderer boot graph 259 chunks / ~7,849 KB minified. The previous baseline used 260 chunks. The generated `out/preload/index.js` has **zero `speechApi` symbols**. Historical ineffective-dynamic-import warnings remain unrelated.
- Pinned Orca provenance: **PASS** (33,506 upstream records, 281 adapted Ash file hashes, 8,260 documented removals), original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` preserved.

## Native Arch Linux/Hyprland Wayland — exact source commit

The actual Electron `ash-ide` source app was launched from commit `4d066f574072ee4a33639dcbb6ea853fbf875e8d` in a disposable private `/tmp/ash-gui-ready-qa-BR3OrD/` profile: isolated HOME/XDG, Ash data, browser state, CODEX_HOME and CLAUDE_CONFIG_DIR. No normal user repositories, login credentials, microphone permissions, device data or foreign application files were changed. A disposable repo-local `.agents/skills` fixture was used for retained skill discovery.

**47/47 assertions PASS**, including a real mapped Wayland window titled **Ash IDE**, first-window runtime barrier, renderer reload, persistent local runtime pointer, independent GitHub PR refresh, provider usage, provider-native skill discovery, truthful read-only updater, Ash Help/onboarding, local-only report/telemetry boundaries, absent legacy relay, and zero missing startup IPC handler names. The actual `window.api` has **no own `speech` property**; Main has zero registered `speech:*` handlers. The retained `window.api.nativeChat`, `window.api.pty.spawn` and `window.api.computerUsePermissions` remain present. The immediate prior clean native baseline `3de580cb` also showed zero missing handlers; no new errors were introduced.

Test-owned local runtime and terminal daemon stopped by profile-scoped CLI commands, both exit status 0, and no private profile process remained. Raw screenshot, console/stderr/CDP logs and result JSON stay in the disposable temporary directory, not committed. This source-desktop test does **not** load a real persisted legacy voice-enabled profile and did **not** perform microphone capture, provider authentication or a packaged installer test.

## Remaining gates

Exact final-tip hosted feature CI, deliberate fast-forward to canonical `main`, focused post-integration tests, remote SHA verification and exact main CI are separate gates. Full M8 vertical removal (web/mobile/automations/voice sources, source assets, scripts, IPC and packaged binaries), real Claude/Codex authenticated provider turns, independent multi-window GUI/runtime reattachment, trusted root SessionStart correlation, AppImage/Arch X11 and macOS/Windows release acceptance remain **OPEN**.
