# M8 — combined scheduled automation exclusion; independent integration and native Wayland evidence

**Date:** 2026-11-10 (Asia/Kolkata)

**Integration worktree:** `feat/m8-integrate-scheduled-automation-exclusion`, based on validated `main` `a29216a5e572e83c30d822f4a93ed44fdbc77bcc` and merged backend feature `656731675b2822f8453c086ffbe344bab0889198` with merge commit `df6b44f917e5d63c9ac7d192192da0dc606b9f78`.

**Classification:** Scoped M8 desktop scheduling exclusion (renderer/preload plus headless runtime/RPC/legacy CLI), **not** full M8, M2 or packaged-release acceptance.

## Combined behavior and preserved boundaries

- Desktop Settings, workspace and navigation no longer open the excluded scheduled-automations page; the desktop preload no longer publishes `window.api.automations`.
- Orcad no longer starts its scheduled automation service. WSL host service construction no longer creates a saved-schedule wake loop. Persisted schedules no longer prevent host idle exit.
- Registered runtime RPC and mobile method-routing manifests omit `automation.*`; the generated RPC parameters catalog matches. Legacy `orca automations` commands and their lazy handler routes are not registered.
- Manual `orchestration.*` Runs, terminal/PTY, native chat, Git and other retained capabilities are not disabled. Persisted automation and run-history records remain intact, and historic worktree provenance is rendered using saved snapshots rather than live scheduler queries.
- No live provider credentials, user repositories, application data or third-party profiles were modified during this integration.

## Independent source/build tests

- Combined Vitest forks: **59/59 PASS, 10 files**, including scheduler exclusions, RPC and legacy CLI registration, retained manual Run creation/worker recovery, and existing renderer startup/speech exclusions.
- Full project TypeScript check: **PASS**.
- Electron source build: **PASS**; sandbox preload verified, renderer boot graph **255 chunks / 7,836.9 KB minified**. Existing ineffective dynamic-import warnings remain.
- `node config/scripts/plugin-authoring/rpc-catalog/generate-rpc-params-catalog.mjs --check`: **PASS**.
- Pinned Orca provenance after both branches: **PASS**, 33,506 upstream source records, 310 Ash adaptations, 8,267 documented removals and unchanged original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- `git diff --cached --check` on combined merge: **PASS**; no merge conflicts remained.
- Both independent feature branches passed their exact-tip hosted GitHub Actions foundation run before integration. Hosted CI of the combined integration and final main are separate gates.

## Native desktop source smoke

A separate, private profile was created at `/tmp/ash-m8-combined-wayland-DgwzrZ/`, isolating HOME, XDG paths, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, GitHub CLI and global Git config. The actual source-built Electron app was launched with `--ozone-platform=wayland`, sandbox flags suitable for the isolated QA environment, and a temporary localhost CDP port. No real provider login, user project or browser profile was loaded. The Electron renderer's real `window.api` reported:

```
{
  "title": "Ash IDE",
  "readyState": "complete",
  "hasPreload": true,
  "automationsPublished": false,
  "speechPublished": false,
  "ptyPresent": true,
  "nativeChatPresent": true,
  "bodyText": "Search\nOnboarding checklist\nHide\nTasks\nProjects\n0\nASH IDE..."
}
```

**PASS:** the actual desktop preload exclusion and retained native-chat/PTY presence after integrating both features. The QA Electron process was terminated and the three test-owned helper processes identified by that private profile were stopped. This is a renderer/source-desktop smoke, not a full GUI interaction tour, live authenticated agent test, or packaged AppImage validation.

## Known limitations and unaccepted gates

- The broad repo `pnpm run lint` failed **22/41 steps** in the standalone backend feature worktree due to missing legacy source folders/generated-guide inputs and other upstream findings. Targeted formatter/linter checks passed; do not call full lint green. The separate bundled CLI flags test has the same three failing `serve` examples on the clean `main` baseline.
- `src/cli/bundled-skill-guides.ts` is an inherited generated snapshot whose canonical guide source directory is not present in this checkout. Its obsolete scheduling instructions were replaced with a compatibility notice, but full canonical guide-source regeneration/verification remains blocked until source packaging is reconciled.
- Legacy WSL/SSH migration and undo helpers still refer to removed `automation.show/update` RPC methods. Their source and reachability need a separate fail-closed/removal review before full M8 acceptance. The user's saved metadata must not be destructively cleaned up.
- Other exclusions (general IDE plugins, mobile/remote development, remaining vendor integration, telemetry), full independent-window/runtime/PTY/provider workflows, package/installers and full visual parity remain **OPEN**.
