# M8 — Ash-owned Help routes and visible desktop identity, native Wayland evidence

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** validated and clean `main` `85fa2c6bc67deb6d4c40292ec7fa438195331583`
**Feature branch:** `feat/m8-ash-help-identity-routes`
**Code commit:** `6c40f4f21868121193c073ae67a5422d3f97652c`
**Classification:** Scoped verified renderer/identity and outbound-link exclusion, **not** full M8/EX acceptance.

## Approved boundaries and source changes

The authoritative D-001/M8/EX/UX decisions require Ash IDE's **independent application identity**, retained Orca-style desktop UX, no inherited Orca cloud/support/community destinations and no broken controls for capabilities excluded or not ready in Ash. Ash remains local-first with explicit, not automatic, provider/account data sharing.

On the mounted sidebar Help dropdown:
- Replaced the inherited `Send Feedback` action (which opened a network-submitting Orca-era feedback UI) with an **explicit browser link** to `https://github.com/Suraj-H675/Ash-IDE/issues`. No draft/environment data/screenshots are collected or submitted by this menu action. The actual public repository's **Issues** capability was verified enabled through GitHub before selecting the URL.
- Directed the GitHub item to the existing `https://github.com/Suraj-H675/Ash-IDE` repository, removing the inherited upstream GitHub destination.
- Removed dead/non-Ash Docs, Changelog, Discord and X outbound menu items rather than inventing Ash pages or route users to Orca accounts/community.
- Hid `Check for Updates` while read-only updater status is `unavailable` (all current source and unconfigured packaged Ash builds). The updater IPC itself remains **only** `getStatus` and `getVersion`; no check, download or install handler was added.
- Corrected Help restart button/toast to **Restart Ash IDE**. Retained local Settings, Keyboard Shortcuts, Milestones/Setup Guide and Onboarding entrypoints.

First-party visible text changes: empty-project Landing heading/accessible logo label **ASH IDE**; native macOS app-name titlebar **Ash IDE**; onboarding dialog, app header, welcome label, agent and notification text **Ash IDE**; first-project prompt and workspace render-error description use Ash branding. The layout, keyboard behavior, local commands, provider native skills and runtime were not reworked.

**Explicit limits:** the inherited logo SVG is still present; broader upstream-named source files, translations, other routes (including the legacy feedback service and onboarding language feedback), settings, assets, cloud endpoints and excluded app-feature implementations require the remainder of the M8 audit. The source-root branding and routing correction is not evidence that these are absent in a packaged build. No new Ash marketing/docs/changelog/community infrastructure was created.

## Automated verification

- Direct Node Vitest forks: **12/12 PASS** across renderer Help ownership/link/hide-unavailable contract, existing excluded-startup gates and updater-unavailable Settings UI.
- Node and renderer TypeScript: **PASS**.
- Oxfmt, native Oxlint and type-aware Oxlint with warnings denied: **PASS**.
- Electron **source** bundle: **PASS**, sandbox preload verified; known inherited ineffective dynamic-import warnings remain.
- Provenance ledger: **PASS** on 33,506 pinned upstream records, 259 Ash-adapted file hashes, 8,260 documented removals; original MIT license digest `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.
- CI foundation workflow includes the new Help surface test in the Node-forks renderer exclusions step.

## Real native Arch Wayland — exact code commit

Executed the Electron source app on Arch Linux/Hyprland **native Wayland** with fully disposable private HOME/XDG dirs, Ash data, CODEX_HOME, CLAUDE_CONFIG_DIR, browser state and a disposable project skill. Captured real Electron stderr, renderer console/CDP, first-window barrier, native mapped window metadata and screenshot; this did not use or modify normal user repositories, provider logins, browser profiles, SSH config or external hooks.

First run private profile `/tmp/ash-gui-ready-qa-7wAsmh/`: **30/30 native assertions PASS**, real Help button opened and exposed precisely these mounted items: `Keyboard Shortcuts`, `Report an issue`, `Milestones`, `Onboarding`, `GitHub`, `Restart Ash IDE`. No `Send Feedback`, `Docs`, `Changelog`, `Discord`, `X` or unavailable `Check for Updates` item appeared. The actual landing page read **ASH IDE** (not standalone ORCA). The native `ash-ide` Wayland window mapped with title **Ash IDE**. No missing startup IPC handlers were observed.

Follow-up exact-commit private profile `/tmp/ash-gui-ready-qa-YOutOL/`: **32/32 assertions PASS**, including clicking the real Help → Onboarding action and verifying the rendered dialog's accessible name **Ash IDE onboarding** and first-step visible heading **Welcome to Ash IDE**. Other prior native checks—retained GitHub PR IPC, empty provider-scoped rate-limit snapshot, disposable provider-native skill discovery, exactly two read-only updater handlers, persistent local runtime pointer and GUI reload—also passed.

In both runs, test-owned local runtime and terminal-daemon stop commands returned exit code 0, and no profile-owned processes remained. Screenshots and raw logs remain in the private disposable `/tmp` profiles; they are not committed. Browser link destinations were verified through a mounted React interaction test, **not** by launching an external browser or submitting feedback during native QA.

## Acceptance remaining

This is **partial M8**. Full excluded-code/preload/RPC/assets removal, all Orca brand/logos and provenance-appropriate replacements, packaging/Arch AppImage, real X11/macOS/Windows, complete screenshot parity, user-credential-safe provider tests, M2 live-session reattach, and trusted root SessionStart correlation remain **OPEN**. Do not infer release readiness from a clean startup-error inventory.

Exact final-tip feature CI, fast-forward merge, post-integration tests and `main` CI must each pass before this slice is called integrated.
