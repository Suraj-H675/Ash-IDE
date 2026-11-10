# M8 — remove unmounted Orca feedback UI and desktop preload bridge

**Date:** 2026-11-10 (Asia/Kolkata)
**Base:** clean, hosted-CI-validated `main` `3de580cbd644114eaa2e6316da83ad78d8a88cac`.
**Feature:** `feat/m8-remove-orca-feedback-ui-preload`; code commit `da5a740206284828a3ded1aa8b965b22794fe3bb`.
**Classification:** Partial excluded vendor-feedback vertical source removal, **not** complete M8, M2 or a packaged-release acceptance.

## Approved boundary

Source-pack D-006, D-024, capability matrix and 13 security/privacy exclude Ash vendor feedback/cloud services and unsolicited diagnostic uploads; preserve local logs, conscious local diagnostic export/copy, GitHub source-control, coding-provider network access and source provenance. Prior validated Ash slices replaced the mounted Help feedback item with an explicit Ash GitHub Issues link, made crash/diagnostic upload IPC fail closed, removed the onboarding language feedback request and disabled telemetry transport.

Audit verified that the **six-file** `src/renderer/src/components/sidebar/sidebar-feedback/` tree had no external importer or mounted UI route. Its sole call to `window.api.feedback.submit` was therefore dead. However, the desktop preload still imported `feedbackApi`, exposed `feedback: feedbackApi`, and could dispatch a request to the unregistered `feedback:submit` channel. The feature removed the unmounted six-file feedback UI tree, its unused preload bridge `src/preload/api/feedback-bridge.ts`, the exported feedback field from the desktop `PreloadApi` contract, and the unused `FeedbackApi` type/contract import. No local crash copy/report, GitHub PR, terminal, SSH, browser or provider code was removed.

The seven deleted files are documented individually in `docs/provenance/ash-exclusions.json` using their original pinned upstream SHA-256 hashes and M8 exclusion reasons. **Previously recorded exclusions were not reordered or modified.** The adaptation hash ledger was regenerated with the original Orca MIT license untouched. The upstream Main feedback uploader implementation and shared, unused feedback payload types still exist in source and require separate review; this slice does not claim all vendor network-capable dormant code has been removed.

## Static and automated verification

- Node Vitest forks: **15/15 PASS** across five suites, including `ash-no-orca-feedback-surface.test.ts` (retired preload/UI source absent, local crash copy retained), mounted Ash Help link ownership, local-only Privacy rendering, Main report upload denial/copy, and renderer startup exclusions. New exclusion test is included in the hosted Node-forks foundation workflow.
- TypeScript node/renderer **PASS**; Oxfmt and native/type-aware Oxlint with warnings denied **PASS**.
- Electron desktop **source** bundle **PASS**, sandbox preload verified. Actual `out/preload/index.js` contains **zero** `feedback:submit` strings and retains `crashReports:copyLatestDiagnostics`.
- Pinned Orca source provenance **PASS**: 33,506 pinned upstream file records, 272 Ash-modified files, **8,267 documented upstream removals**, original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Native Wayland exact-commit evidence

Executed a real Electron source app on Arch Linux/Hyprland native Wayland with a fully isolated disposable private `/tmp/ash-gui-ready-qa-Ilw5zv/` HOME, XDG, Ash user data/browser profile, CODEX_HOME and CLAUDE_CONFIG_DIR. The fixture did not load or change a real user's credentials, providers, SSH configuration, repositories, hooks or browser data; no vendor feedback was submitted.

**47/47 native assertions PASS** on exact commit `da5a740206284828a3ded1aa8b965b22794fe3bb`. The mapped `ash-ide` desktop window was titled **Ash IDE**. Main first-window ready barrier and persistent local runtime pointer, renderer reload, provider-native disposable project skill discovery, GitHub PR refresh IPC, read-only updater, local PTY interface exposure, Ash Help and Onboarding, and no-vendor crash/diagnostic/telemetry guards all remained successful. The actual renderer preload had **no own `feedback` property**, while `crashReports.copyLatestDiagnostics` and `crashReports.dismiss` remained functions; Main's handler map had no `feedback:*` invoke routes.

Relative to preceding clean native baseline `3de580cb` in `/tmp/ash-gui-ready-qa-oe30cF/`, both runs recorded **zero missing IPC-handler names** in captured Electron stderr/console/CDP logs. No new startup handler warnings. The test-owned terminal daemon and local runtime stopped with exit code 0; no scoped processes remained. Raw logs, screenshot and result JSON remain only in the disposable private test profile.

## Separate integration and open gates

Exact code-tip/feature-tip CI, deliberate fast-forward to canonical `main`, post-merge tests and exact hosted `main` CI are separate acceptance gates. This **does not** prove safe packaged AppImage or signed release, all platform/locale exclusion paths, telemetry absence in network captures, or end-to-end authenticated agent/provider workflows. Remaining full M8 source/package exclusions, M2 real provider turns, root SessionStart trust correlation, independent multi-window persistent-session reattach, Windows/macOS and packaged cross-platform QA remain **OPEN**.
