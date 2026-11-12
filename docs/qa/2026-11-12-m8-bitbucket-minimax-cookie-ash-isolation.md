# M8 — Bitbucket and MiniMax cookie credential isolation

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** verified clean main at 1dc6e95d979c39d8cd5496a677138c9683c914cd. GitHub Actions run 43240771167 concluded success. Feature branch fix/m8-ash-owned-bitbucket-minimax-cookie, isolated worktree.

## Inherited defect

The retained Bitbucket Git provider's encrypted secret and plaintext display metadata, plus the MiniMax session-cookie credential, still used the application's inherited Orca home, ~/.orca. Status, read, save and clear operations could inspect, harden or delete Orca-owned credentials. Bitbucket and MiniMax caches could also cross Ash profile selections.

## Implemented boundary

- The Bitbucket encrypted credential and its companion metadata file now reside under the active Ash userData / provider-credentials directory. Both destinations are resolved and checked together before a save or delete, preventing an unsafe metadata link from triggering a partial secret deletion. The application environment is installed before use; no fallback to the foreign Orca home is provided.
- The shared Ash provider-credential resolver supports strictly validated encrypted credential filenames and Bitbucket metadata filenames; all existing real/symlink root and hard-link/symlink file rejection checks remain active. Invalid paths are rejected before read, file hardening, save or unlink.
- The Bitbucket in-memory metadata/secret/error cache is scoped to the selected Ash credential paths. Switching to a different Ash profile invalidates previously cached data.
- The MiniMax cookie retains its existing serialized envelope and legacy read compatibility, but now resolves through the Ash-owned provider credential root, and its cached value is scoped by active profile path.
- The old Orca credential paths remain untouched. No automatic imports, deletions, migrations, re-keying or real account operations were performed. Users may need to re-enter provider credentials in Ash. Future imports require explicit user authorization and separate acceptance.

## Observed feature-worktree verification

- Red-first: all four new credential isolation tests failed against the old implementation.
- Targeted security suite: 4/4 passed after the source change; combined focused sources 8/8 passed before the workspace package build, followed by expanded regressions.
- Full pnpm run typecheck: PASS, including build of workspace package @orca/process-host.
- Expanded Vitest suites: 12 suites / **81/81 passed**, covering Bitbucket and MiniMax credential isolation, retained provider credentials, legacy secret-store isolation, runtime controls, and package hygiene.
- Oxfmt and oxlint on changed source and tests: PASS.
- pnpm run build:desktop:assets: PASS (native main/preload/renderer/CLI and sandbox preload; 1,224 CLI closure files / three commands).
- pnpm run build:orcad: PASS, 12.78 MB / 8,141 modules, Node 24.22.1; zero forbidden Electron and node:sqlite imports.
- Real standalone Node lifecycle smoke: PASS with four authenticated Ash runtime incarnations, original-folder PTY process/handle continuity across runtime stop/restart, no replacement key for an existing legacy profile, and all foreign Orca sentinels (Bitbucket secret/metadata, MiniMax cookie, Linear legacy, host terminal policy) unchanged.
- Real native Linux Wayland source Electron: PASS with private KWin/DBus, disposable HOME/XDG/provider profiles, DOM complete, absent Jira/Linear preload, present GitHub/GitLab/PTy/runtime/native-chat/browser interfaces. Authenticated CLI terminal created, daemon/runtime explicit shutdown succeeded, and no test-owned processes remained.
- Smoke harness diagnostic: the first enlarged foreign-sentinel test expected unsorted filenames against a sorted directory listing and failed without observed data mutation. The sorted-expected-list correction was applied; the full rerun passed. The earlier failed fixture was identity-audited, confirmed unused by live processes, and retired.
- Source provenance: record pinned Orca file hash and verified ledger after final edits.

## Limits

Not a real-provider authentication/Bitbucket pull request smoke, an installed AppImage, macOS/Windows native credential test, or full M8 release acceptance. The additional inherited Orca home paths for keybindings and some agent hooks require separate dependency-grounded remediation. Post-integration main tests and the new CI result are separate verification gates.
