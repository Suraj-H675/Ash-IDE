# M8 — excluded Jira and Linear status: native Wayland evidence

**Date:** 2026-11-10 (Asia/Kolkata)
**Base:** validated `main` `ff475c78618038b54d17df8f03c4024eddaafb40`
**Branch:** `feat/m8-excluded-task-tracker-status`
**Code commit:** `c02283624ca5e6ff546ba2fafbc09e7b11049eb3`
**Classification:** Partial M8 task-tracker exclusion, not full M8 or M2 acceptance.

## Implemented boundary

Jira and Linear vendor task-tracker **status** reads are disabled at the shared renderer runtime client boundary on all hosts. Both `jiraStatusForTarget` and `linearStatusForTarget` settle with `{ connected: false, viewer: null }` and never contact unregistered Ash local IPC or remote runtime RPC. This is an explicit disconnected state, not a fabricated successful connection. Existing GitHub/GitLab source-control, PR, issue and preflight routes are unaffected.

This is a deliberately narrow status-request gate: old Jira/Linear setup cards, other explicit tracker methods, task-source selectors and legacy data remain in the source and need their own classified removal. It does not delete user accounts, settings, credentials or previously saved provider data. No provider credentials or user workspace was read or changed.

## Source verification

- Direct Node Vitest forks: **8/8 PASS** across the two foundation-picked startup suites. Focused local and environment-target status tests assert disconnected results and verify both local preload status APIs and the remote RPC are **never called**.
- Node/renderer TypeScript check: **PASS**.
- Oxfmt; native and type-aware Oxlint with warnings denied: **PASS**.
- Electron source desktop bundle: **PASS**. Sandbox preload verified. Existing ineffective dynamic import warnings remain.
- Provenance: **PASS**, 33,506 pinned upstream source records; 243 documented adapted files; 8,260 documented removals; original MIT source license hash unchanged.
- Temporary same-lockfile `node_modules` symlink removed after verification. No change to canonical checkout or its installed dependencies.

## Exact-code native Arch Wayland run

Code commit `c02283624ca5e6ff546ba2fafbc09e7b11049eb3` launched under a fresh private `/tmp/ash-gui-ready-qa-hFJQBs/` profile on Arch Linux/Hyprland Wayland. HOME, XDG config/cache/data/state, Ash userData, CODEX_HOME and CLAUDE_CONFIG_DIR were all isolated; no normal provider profile, real user repository or browser profile was loaded.

The mapped native `ash-ide` Electron window was visible and titled *Ash IDE*. Main exposed 535 handlers, the first-window startup barrier settled, the isolated runtime pointer existed, and the renderer reload finished with console/stderr/CDP capture enabled. **9/9 targeted GUI assertions passed.**

Against the immediately preceding isolated `main` baseline `ff475c78` (profile `/tmp/ash-gui-ready-qa-gGQHB8/`), distinct missing-handler names decreased from **9 to 7**. Exactly `jira:status` and `linear:status` were removed, with **no new names**. Remaining names:
`gh:checkOrcaStarred`, `gh:reportVisiblePRRefreshCandidates`, `rateLimits:get`, `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`.

The isolated terminal daemon and persistent local runtime were stopped via profile-scoped CLI calls (both exit status 0); no processes linked to this temporary root remained. Detailed logs/screenshot remain inside the private test directory and are not committed.

## Acceptance limits

This milestone is accepted only after hosted feature-tip CI, deliberate fast-forward merge, post-integration checks and exact `main` CI. The seven remaining missing handlers need careful retention/adaptation: GitHub source control, provider-native skill discovery, local Git SSH and updater behavior are retained until proven otherwise. Inherited ORCA renderer text is visible and unaccepted. Full vendor connector vertical removal, authenticated provider turns, root SessionStart correlation, packaged Wayland/X11 and other desktop platform acceptance remain **OPEN**.
