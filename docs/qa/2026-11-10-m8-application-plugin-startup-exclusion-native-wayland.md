# M8 — excluded application plugin bootstrap: native Wayland evidence

**Date:** 2026-11-10 (Asia/Kolkata)
**Branch:** `feat/m8-disable-application-plugin-bootstrap`, based on `9c91d2260211033eb9f81eacb59bd5734c44d0b6`
**Code commit:** `5f100d4aa4dfbca75b27eeaf318d37f82002d103`
**Classification:** Verified early M8 startup-path exclusion, **not** full M8 vertical removal or M2 acceptance.

## Approved boundary

The approved D-007 and 03 feature-capability matrix exclude the Orca-style general **application plugin host, application plugin catalogs, marketplaces, workers, panels and plugin-powered UI contributions**. D-020 and the feature matrix separately **retain Chromium browser extensions** and **provider-native skills/MCP**, whose lifecycles are not governed by this startup exclusion. The application still needs built-in color, syntax, terminal, UI-language and icon fallback.

The renderer now explicitly marks app-plugin host availability false. The actual app-plugin content stores (`themes`, `terminal themes`, `language packs`, `icon themes`) resolve to an **empty, loaded** state without invoking missing Main IPC. The panel list resolves to **empty, ready**, with no stale panel health, timers or plugin-change subscription. Plugin auto-update and status-bar override watchers do not subscribe or invoke their excluded handlers. A direct retry request observes the same exclusion as ordinary mounting. The built-in editor, terminal and appearance paths continue to mount; the browser-extension and provider-native integration code paths are not changed.

This **does not** complete source/bundle/API removal of the general plugin subsystem. The legacy plugin preload bridge, Main-side dormant services, explicit settings/catalog surfaces, and old tests still require their own classified removal before M8 can be accepted. This change does not add fake IPC handlers or redirect into a provider account.

## Source and test evidence

- Node Vitest forks: **7/7 PASS**, across the existing renderer startup gate suite and the new real React/Zustand app-plugin store mount test. Eight forbidden app-plugin IPC methods are recorded with spies; all eight remain uncalled; content `loaded` and panel `ready` states are asserted, including direct retry. No React act warnings in the final run.
- Node/renderer TypeScript check: **PASS**.
- Oxfmt plus native and type-aware Oxlint, with warnings denied on edited TypeScript: **PASS**.
- Electron desktop source bundle: **PASS**, sandbox preload verified; known ineffective dynamic import warnings remain.
- Source provenance: **PASS**, 33,506 pinned upstream records, 241 Ash source adaptations, 8,260 documented removals and intact MIT license hash. Temporary `node_modules` link into the canonical same-lockfile dependency installation was removed after tests/build.

## Native Arch Wayland, exact code commit

Tested `5f100d4aa4dfbca75b27eeaf318d37f82002d103` on the host's Hyprland Wayland desktop with a *new*, disposable private profile at `/tmp/ash-gui-ready-qa-gGQHB8/`. Isolated `HOME`, XDG paths, Ash userData, CODEX_HOME and CLAUDE_CONFIG_DIR prevented access to the user's normal Ash and provider profiles. No user credentials, real repositories or foreign hooks were changed.

The real `ash-ide` Electron window mapped and became visible; 535 Main handlers, completed startup barrier and isolated runtime pointer were observed. The renderer was reloaded after Main readiness while console, stderr and CDP logging were attached. **9/9 targeted assertions PASS**, including no stale Mobile, Skills or Automations sidebar entries, and no missing handler for the eight app-plugin IPCs or earlier excluded startup endpoints.

Compared with the immediately preceding native `main` baseline `9c91d226` (private profile `/tmp/ash-gui-ready-qa-mvEcHv/`):

- **17 distinct missing handler names before; 9 after.** No new names.
- Exactly eight removed: `plugins:getAutoUpdateState`, `plugins:list`, `plugins:listIconThemes`, `plugins:listLanguagePacks`, `plugins:listTerminalThemes`, `plugins:listThemes`, `plugins:statusBarState`, `plugins:takeUpdateReviewNotices`.
- Remaining nine: `gh:checkOrcaStarred`, `gh:reportVisiblePRRefreshCandidates`, `jira:status`, `linear:status`, `rateLimits:get`, `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`.

The disposable terminal daemon and local runtime were stopped using profile-scoped CLI commands (both exit status 0); no process referring to the profile remained. The screenshot, console event capture and result JSON remain only in that private test directory; nothing sensitive is committed.

## Remaining gates

Hosted feature-tip CI, fast-forward integration and post-integration CI must pass before accepting this checkpoint on `main`. Further M8 cleanup should remove Jira/Linear callers without disturbing GitHub/GitLab source control. The other seven errors require careful retain/adapt/exclude classification: provider-native skill discovery, ordinary Git SSH, usage/rate limits, and Ash-owned updater must not be silently lost. Inherited ORCA renderer branding and the generic application plugin vertical remain incomplete.

Full real authenticated Claude/Codex provider turns, root SessionStart trust correlation, Windows/macOS and packaged Wayland/X11 E2E, full M2 and full M8 acceptance remain **OPEN**.
