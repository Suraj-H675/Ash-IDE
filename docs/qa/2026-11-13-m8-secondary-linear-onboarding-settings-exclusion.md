# M8 — Remove remaining Linear setup from the Feature Wall, onboarding and Settings

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** canonical `main` at `8b7d9e46be865611890a6b72a57c0beaf8669c9d`, with GitHub Actions run `43405613911` successful.
**Isolated worktree/branch:** `m8-codex-native-settings-boundary` / `fix/m8-exclude-secondary-linear-onboarding-settings`.

## Finding

The previous M8 cleanup removed Jira/Linear credential cards from the core setup checklist and Integrations/Tasks Settings. A separate **Feature Wall Tasks tour** still rendered `LinearRow`, an inherited form that offered a Personal API-key connection dialog. The older onboarding integrations step explicitly advertised Linear and Jira; Settings dynamically registered a Linear-specific skill/credential section whenever saved connection state indicated Linear was connected, and its page/hook graph queried that state and installed-skill status.

## Correction and retained behavior

- The Feature Wall Tasks tour now presents retained **GitHub** setup only, without `LinearRow`; its setup column has a narrower width. Review and task visualizations are retained.
- Removed the Linear API-key onboarding component and its connection-check hook. The onboarding integration copy now names **Ash IDE** and available source-control services, without referring users to excluded trackers. New translation keys avoid old localized Orca/Jira/Linear copy overriding the new default.
- Removed the Linear Settings navigation section, conditional pane, and obsolete skill-status subscriptions. The legacy connection state does **not** surface a credential form or cause a provider-status request. Retained Agents, Accounts, Orchestration and Computer Use settings remain.
- No persisted settings, existing provider credentials, local files, or unrelated workspaces are changed by this UI-only edit.

## Verification evidence

- **Red-first:** three regressions failed against the prior code: Feature Wall rendered Linear setup, a legacy connected profile added Linear Settings, and the onboarding copy advertised Linear/Jira/Orca. All three passed after the correction.
- Broader renderer and exclusion tests: **30 passed across 11 files**. These include preserved code-host integration/Tasks Settings, privacy, updater, skills, mobile, speech, cloud and scheduled-automation exclusion checks.
- Renderer TypeScript (`config/tsconfig.tc.web.json`) **passed**, targeted Oxlint/Oxfmt and Git whitespace checks **passed**. After fast-forward integration on canonical `main` at `de3e4e0e008a3052fa166779aac5b93722648ac0`, the **full** `pnpm run typecheck` passed and the same expanded **30/30** renderer/exclusion tests passed again.
- `pnpm run build:desktop:assets` **passed**: 254 renderer chunks (previously 255), sandbox preload and the CLI runtime closure (1,224 files / three commands) all verified. Pinned source provenance verified **33,506 upstream file records, 504 Ash adaptations and 8,508 documented exclusions** with the MIT license notice.
- Fresh Linux AppImage build **passed** from integrated `main`: `dist/ash-ide-linux.AppImage`, **224,461,223 bytes**, SHA-256 **`5f3cb8b46fb5849b0453cac5449dc005b91948eabc037a2853205ebf619ecc88`**. Native binary/GLIBC checks, bundled daemon and Node PTY, plugin resources and package hygiene all passed. The actual ASAR has **5,202 entries** versus 5,205 in the previous build; the 16 previously excluded CLI artifacts remain absent and the packaged `ash-ide --help` still succeeds.
- Native Wayland AppImage lifecycle test **passed** using an isolated virtual compositor and disposable provider homes: app PID `3354929`, runtime ID `baec854d-ca9b-4edc-8804-12c57d7542c7`, terminal handle `term_223e6cac-5f2d-4257-a7a2-9b77bc54f264`, terminal PID `3355515` survived last-window close/reopen; test-owned daemon/runtime stopped. Evidence under `/var/tmp/ashwl.RDsPdb`.
- Hosted GitHub Actions for the new pushed HEAD must be confirmed separately. This package smoke proves runtime/PTY continuity, not pixel-level Feature Wall/Settings visual acceptance.

## Scope still open

This is not full Jira/Linear removal. The task dashboard and task composer still import tracker dialogs and models, and old compiled renderer chunks remain in the AppImage. Product telemetry IPC and transport sources also remain compiled, although current startup/preload paths do not expose their transmission APIs. Full EX-07 / EX-09 and M8 acceptance require separate dependency-safe removal and live/platform evidence; this step does not imply signed-in Codex or Claude acceptance.
