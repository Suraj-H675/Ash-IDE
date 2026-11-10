# M8 — scheduled-automation renderer/preload exclusion and native Wayland smoke

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-exclude-scheduled-automation-ui-preload`, based on validated `main` `46cda416e10c64956bd625a365f328ff1c640833`.
**Classification:** Scoped M8 renderer/preload exclusion, **not** complete M8, a packaged-build acceptance, or scheduler-backend exclusion.

## Boundary

- Desktop preload no longer publishes `window.api.automations`. The legacy TypeScript surface is optional only so archived, unmounted modules can fail closed rather than silently invoking missing IPC handlers.
- The workspace shell, Settings navigation/search, scheduled-delete preference control, workspace-card click actions, activity hover actions and forward-history admission no longer lead to the excluded scheduling page.
- Saved worktree automation provenance continues to render name/title snapshots read-only, without live scheduler lookups or links. No existing automation records, worktrees, credentials, provider settings or repository data were migrated, deleted or modified.
- Manual terminal-first orchestration Runs, native chat and PTY APIs were left intact. Main-runtime automation RPC, CLI and scheduler lifecycle are **not** addressed by this feature branch; they require an independent removal milestone.

## Source and regression evidence

- Codex feature verification: **46/46 targeted Vitest tests** across 11 files; node and renderer TypeScript checks, targeted Oxfmt/Oxlint with warnings denied, Electron source build and clean Git diff **PASS**.
- Independent reviewer reran five Vitest files, **45/45 PASS**, including the new exclusion suite, retained speech/startup boundaries, `orchestration/runs/runs.test.ts` and `orchestration/worker/workers-recovery.test.ts`.
- Independent full project typecheck, built preload contract and `git diff --check`: **PASS**. `out/preload/index.js` does not contain the legacy `automationsApi` export.
- In the actual worktree, `node config/scripts/provenance/verify-source-ledger.mjs` **PASS**: 33,506 pinned upstream records, 301 adapted Ash files, 8,267 documented removals, and original MIT license hash `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`. Codex's earlier sandboxed ledger-verification attempt failed with `spawnSync git EPERM`; this independently rerun, non-sandboxed check passed without editing or bypassing the verifier.

## Actual Wayland desktop smoke

The built Electron source desktop was started under the machine's Wayland session (`WAYLAND_DISPLAY=wayland-1`, `XDG_SESSION_TYPE=wayland`) with `--ozone-platform=wayland`, a dedicated localhost CDP debugging port, and disposable private profile `/tmp/ash-m8-ui-wayland-smoke-r7Kwsr`. Private HOME, XDG config/data/cache/state, Codex home, Claude config, GitHub CLI config and Git global configuration were isolated. No real provider login, microphone, browser profile, or user repository was loaded.

The actual Electron renderer CDP reported:

```
{
  "title": "Ash IDE",
  "href": "file:",
  "hasPreload": true,
  "automationsPublished": false,
  "speechPublished": false,
  "ptyPresent": true,
  "nativeChatPresent": true,
  "readyState": "complete"
}
```

**PASS:** the requested desktop preload capability boundary. The isolated Electron GUI process was terminated after the check, and its test-owned runtime daemon and Crashpad helper (identified by the disposable profile path) were separately stopped; no matching test-profile helper remained in the subsequent process snapshot.

This smoke verifies real Electron renderer/Wayland startup and API presence, **not** a recorded Hyprland window mapping, user interaction flow, provider login, independent window persistence, or a distributable AppImage.

## Outstanding acceptance gates

The scheduled automation RPC, headless host scheduler and legacy CLI remain separately reachable until the backend exclusion is integrated. Browser automation and manual orchestration must be preserved when that happens. Hosted feature-tip and post-integration `main` CI, combined desktop smoke, packaged app testing, other M8 exclusions and full M2 acceptance remain separate gates.
