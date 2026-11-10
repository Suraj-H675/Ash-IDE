# M8 — prevent inherited vendor crash/diagnostics uploads; remove telemetry opt-in surfaces

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** validated main `999858c794e6e653c88544eef170d5c71f0a8b8d`
**Feature branch:** `feat/m8-no-vendor-diagnostics-upload`
**Code commits:** `a590f63e9c98e5740deb512a701f8cc71bd5b505` (local-only crash/diagnostics UI and Main IPC); `e2b9dc37de970efb844b1eb4b51a7488341801d2` (fail-closed preload telemetry gate and no first-launch opt-in surface).
**Scope:** M8 partial privacy/security exclusion only; not full M8 or production diagnostic export acceptance.

## Authoritative product boundary

D-006, D-024, EX and 13 security/privacy require no Ash product analytics, vendor cloud feedback, automatic crash upload or unsolicited background data sharing. Retain local diagnostic logs, manual review/copy and redacted user-directed local export with honest disclosure that sensitive data can remain. Provider-native auth and ordinary outbound Git/provider/browser traffic are separate.

The prior Main `crashReports:submit` IPC invoked a legacy `submitFeedback` implementation that targeted `https://www.onorca.dev/v1/feedback`. The registered diagnostic upload/delete IPC could resolve `ORCA_DIAGNOSTICS_TOKEN_URL` and send bytes to an upstream support service. Privacy still showed an anonymous telemetry opt-in, first-run consent overlay, remote diagnostic support-send controls and a language request using `window.api.feedback.submit`, even though Main did not register telemetry/feedback handlers.

## Implemented source boundary

- Main `crashReports:submit` now returns a stable **failure**, `ok:false` and a clear Ash local-copy explanation, without invoking `submitFeedback`. Local getLatestPending/getLatestReport, record, dismiss and `copyLatestDiagnostics` remain registered.
- Main `diagnostics:uploadBundle` and `diagnostics:deleteBundle` now reject **before endpoint resolution, request payloads, token exchange or network transport**. Local `getStatus`, `collectBundle`, `openBundlePreview` and `discardBundlePreview` remain. New preview directory uses Ash-owned `ash-diagnostic-bundle-previews` in Electron's temporary path; legacy Orca preview directories were not modified/deleted.
- Crash dialog exposes local detail review/copy and dismiss, with no upload or GitHub identity lookup, and says explicitly that Ash does not upload reports. Privacy Settings no longer offers product telemetry opt-in; it offers local-only diagnostic creation, open/review and discard, without send, cloud tickets or remote delete actions. The privacy settings search catalog no longer advertises analytics opt-in.
- Onboarding language selection remains; its unused cloud language-request form and associated telemetry event/consent cohort behavior were removed. The ability to select supported UI languages and save the language setting remains.
- Electron preload telemetry methods now return **disabled/no-op responses without IPC**; web preload mirrors the same behavior. Ash's root overlay no longer mounts the inherited telemetry first-launch opt-in notice. Main has never registered `telemetry:*` or `feedback:submit` in the current Ash core startup path, and this slice does not introduce them.

**Important limitations:** upstream telemetry types, legacy source components, crash-report upload implementation, feedback-request and diagnostic-upload helpers, raw preload legacy feedback surface, and some source/bundled assets remain and require removal or explicit dead-code review later. The fact that the *registered* IPC routes are fail-closed does not prove the entire distributed application contains no unused upstream code or all outgoing traffic is absent. Local preview file lifetime remains ephemeral (a private temporary review file, not yet a polished persisted export workflow). No authenticated provider traffic was exercised.

## Source tests and builds

- Direct Node Vitest forks: initial Main no-vendor IPC test **1/1 PASS** and renderer privacy controls **2/2 PASS**, plus existing excluded startup **9/9 PASS**. After the preload/overlay update, **13/13 PASS** across four suites including explicit disabled browser preload telemetry test.
- Main test verifies real registered IPC responses deny crash upload and diagnostic upload/delete without touching any mocked endpoint/transport; local diagnostic create/open/discard uses a disposable temporary directory and crash copy remains available.
- Renderer tests verify Privacy displays local-only controls, no anonymous telemetry opt-in or upload buttons, and user-directed create/review/discard behavior.
- Node/renderer TypeScript, Oxfmt, native Oxlint and type-aware Oxlint with denied warnings **PASS**.
- Electron **source** build **PASS** on the final code, sandbox preload verified, 260 renderer chunks / 7,852 KB minified. Inherited ineffective-dynamic-import warning remains.
- Provenance **PASS**: 33,506 upstream source records, 270 documented Ash source hashes, 8,260 documented removals, and unchanged Orca MIT license digest `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Native Arch Linux/Hyprland Wayland verification

The exact `a590f63e` code ran under a fresh, fully disposable private `/tmp/ash-gui-ready-qa-6kEAkI/` profile with HOME/XDG, userData, browser, CODEX_HOME and CLAUDE_CONFIG_DIR isolated. **37/37 native assertions passed**: visible mapped `ash-ide` window, ready barrier, renderer reload, persistent runtime pointer, provider-native skill-discovery fixture, scoped usage snapshot, PR refresh IPC, read-only updater, Ash Help and onboarding surfaces, and explicit denied report/upload/delete IPC. The previous native baseline `999858c7` and this run both recorded two inherited missing IPC names in collected logs: `telemetry:track` and `legacyRelayBridge:listPanes`.

Final source code `e2b9dc37de970efb844b1eb4b51a7488341801d2` ran in a separate fresh private `/tmp/ash-gui-ready-qa-Q4zlVE/` profile. **40/40 native assertions passed**. `window.api.telemetryTrack('app_opened',{})` returned `false`, `telemetryGetConsentState` returned `{effective:'disabled',reason:'user_opt_out'}`, and legacy opt-in/acknowledge methods returned harmless no-ops. `crashReports:submit` returned `ok:false` and the local-copy explanation; `diagnostics:uploadBundle` and `diagnostics:deleteBundle` rejected with Ash backend-unavailable errors; local diagnostic status remained enabled. The final event log showed **no `telemetry:track` missing-handler warning**, removing that name compared with the immediately previous native test, with **no new handler failures**.

**One pre-existing missing IPC remains:** `legacyRelayBridge:listPanes`. This is excluded remote/legacy behavior and must be handled in another M8 worktree rather than registering a remote relay service. This slice does not claim that the historical startup inventory is empty after the deeper event inspection.

Both source-test profiles' terminal daemon and local runtime were explicitly stopped via profile-scoped CLI operations (exit code 0), and no scoped processes remained. No real provider credentials, user repositories, global hooks, other application's data, uploads or real feedback submissions were used. Raw native screenshot/events/result JSON remain private in temporary roots, not committed.

## Remaining acceptance

Hosted CI exact feature tip, deliberate fast-forward, post-integration tests and exact main CI are separate gates. Full M8 source/package exclusions, strict network trace and packaged verification, first-class durable diagnostic export, actual authenticated Claude/Codex turns, host-root SessionStart trust correlation, multi-window GUI/daemon reattach, full GUI visual parity, AppImage/Arch X11, Windows/macOS remain **OPEN**.
