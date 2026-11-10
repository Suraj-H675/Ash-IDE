# M8 — remove inherited Orca GitHub-star promotions

**Date:** 2026-11-10 (Asia/Kolkata)
**Base:** validated `main` `479fd5d8ca795ec05bd24aac87f64511e06bd588`
**Feature:** `feat/m8-remove-orca-star-promotions`; code commit `23e63f1cfc7583bba7f9e061e76cd3327dfc75d6`
**Classification:** Early M8 source/renderer exclusion and branding cleanup, not full M8 or M2 acceptance.

## Product boundary and changes

The approved Ash product does not promote or claim affiliation with Orca and must remove excluded/dead UI. The prior `gh:checkOrcaStarred` handler was missing from Ash Main, yet the Landing screen and General Settings eagerly called it to offer stars for **stablyai/orca**, an unrelated repository. The application also mounted inherited star-nag card/toast/agent milestone observers and sent an onboarding-completed star-nag notification.

This change removes the entire mounted Orca GitHub-star button from Landing, the Orca-support row from General Settings and the corresponding settings-search entry, both app-level star-nag notification mounts plus the agent milestone observer, and the onboarding-completion star-nag trigger. It preserves Landing workspace actions, preflight display, Settings sections, the native notification stack and non-promotional provider/GitHub source-control integration.

The upstream star-nag source files, preload API, Main service code, locale strings and old dormant promotional modules still exist and require deliberate source/bundle/API removal in later M8 work. This does not silently delete user data or re-register missing APIs. Inherited ORCA Landing title and logo are **still present** and require an Ash identity correction later; the star-promotion removal is not complete visual branding acceptance.

## Source verification

- Direct Node Vitest forks, existing foundation-wired startup and app-plugin tests: **9/9 PASS**, including removal of the promo settings search entry.
- Node/renderer TypeScript: **PASS**.
- Oxfmt, Oxlint native and type-aware with warnings denied: **PASS**.
- Electron source desktop bundle: **PASS**, sandbox preload verified; inherited ineffective dynamic import warnings remain.
- Pinned Orca provenance ledger updated and verified: 33,506 upstream file records, 247 documented adapted source hashes, 8,260 documented removals; unchanged MIT license hash.

## Exact-source native Arch Wayland evidence

Source commit `23e63f1cfc7583bba7f9e061e76cd3327dfc75d6` launched in a fresh private `/tmp/ash-gui-ready-qa-F78g3I/` under Arch Linux/Hyprland native Wayland with isolated HOME, XDG settings, Ash user data, CODEX_HOME, CLAUDE_CONFIG_DIR and browser state. No real provider credentials, user repositories or foreign hooks were loaded or changed.

The mapped visible `ash-ide` Electron window had a loaded renderer, 535 Main handlers, completed first-window service barrier and isolated runtime pointer. Console, stderr and CDP log listeners were active for a renderer reload after Main readiness. **10/10 assertions PASS**, including no visible `Star on GitHub` / `Star Orca` promotion and no missing handler for `gh:checkOrcaStarred` or the earlier excluded names.

Relative to the immediately preceding verified source baseline `479fd5d8` (private root `/tmp/ash-gui-ready-qa-hFJQBs/`), distinct missing-handler names decreased from **7 to 6**, exactly removing `gh:checkOrcaStarred` with **no new names**. Remaining six:
`gh:reportVisiblePRRefreshCandidates`, `rateLimits:get`, `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`.

Both test-profile runtime and terminal-daemon stop commands returned exit 0; no process referring to the temporary profile remained. Screenshots and full captured diagnostics remain inside the private test directory and are not committed.

## Acceptance limits and next work

Full retained GitHub PR refresh, rate limit usage, provider-native skill discovery, local Git SSH and Ash-owned desktop update endpoints remain **OPEN** and must be correctly routed, not suppressed. The `gh:reportVisiblePRRefreshCandidates` IPC is defined upstream but is not presently registered by the Ash startup; restoring it requires a deliberate retained-source-control review rather than blindly registering a broad excluded service.

Hosted final feature-tip CI, post-integration tests and exact `main` CI remain independent acceptance gates. Full source removal of promotional systems, Ash branding/visual parity, packaged applications, authenticated Claude turns, trusted root SessionStart correlation, full M2 and full M8: **OPEN**.
