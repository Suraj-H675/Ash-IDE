# M8 — remove excluded Jira/Linear Electron main-process IPC handlers

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean `main` `b32d30753fb8c8b0d4e10fa9c6b4240603896470`, verified successful by [GitHub CI run 43197474081](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43197474081). Feature branch `feat/m8-remove-task-tracker-electron-ipc` has its own isolated worktree.

## Boundary and implementation

Jira/Linear app connectors are **excluded** from Ash per the approved capability matrix. Previous M8 slices removed their desktop preload, runtime facade, RPC method manifest and CLI registrations. Twelve original, unmodified Orca source files nevertheless remained under `src/main/ipc/jira/` and `src/main/ipc/linear/`, including `ipcMain.handle('jira:*')` and `ipcMain.handle('linear:*')` registrar functions. They were not invoked from Ash startup; keeping them was obsolete code and created risk of accidental resurrection during future changes.

Before deletion, a TypeScript syntax-tree dependency audit scanned **23,522 source files** in `src` for static `import`, re-export, dynamic `import()` and literal CommonJS `require()` relative edges into these two directories. **No incoming edges from outside the excluded directories** were found. A separate source search also found no `registerJiraHandlers` or `registerLinearHandlers` call anywhere outside the excluded files. The desktop's `register-core-handlers.ts` still registers the retained browser, runtime and session IPC handlers.

Removed **exactly 12** orphaned `.ts` files in the two directories, after verifying each file's bytes against the frozen Orca SHA-256 ledger. Their path, pinned-source hashes and exclusion rationale are recorded in `docs/provenance/ash-exclusions.json`; no migration or retained data files were removed. Preserved `src/main/orcad/orcad-plaintext-credential-migration.ts` and its imports of `linear-credential-paths` and Jira `site-credential-store`, so legacy credential sealing remains available. Also preserved historical Jira saved filters and issue-reference metadata, browser/PTY/runtime IPC, ordinary Git provider APIs, and other retained services. No user profile, account, repository or credential was modified.

Added a red-first test in `src/main/ipc/ash-excluded-task-tracker-ipc.test.ts` that enforces both directories' absence and verifies the continued presence of actual browser/runtime/session registrations and credential-migration dependencies. Before deletion, the directory-absence case failed (1 failed, 2 passed); after deletion, **3/3 passed**.

## Verification — feature worktree

- Full `pnpm run typecheck`, including dependency package builds: **PASS**.
- Applicable regression suite, including prior runtime-surface denial, persisted Jira filters, attachment utility, mobile RPC exclusions and packaging hygiene: **12 suites, 80/80 PASS**.
- `pnpm exec oxfmt --check` and `pnpm exec oxlint` for added test: **PASS**, no warnings/errors.
- Pinned upstream provenance: **PASS**, 33,506 baseline source entries, 432 current adapted hashes, **8,507 documented removals**, MIT license SHA-256 unchanged.
- `pnpm run build:desktop:assets`, including sandbox preload, desktop renderer and CLI closure: **PASS**; 1,223 verified CLI closure files and three commands.
- `pnpm run build:orcad`: **PASS**, 12.78 MB / 8,146 modules, zero Electron or `node:sqlite` imports, Node 24.22.1. The compiled bundle count is unchanged from the prior milestone, consistent with removing already unreachable source.
- The generated `out/main/index.js` and `out/preload/index.js` contain **none** of the excluded `jira:connect`, `jira:disconnect`, `jira:status`, `jira:createIssue`, `linear:connect`, `linear:disconnect`, `linear:status` or `linear:createIssue` channel strings; the preload retains `runtime:subscribe`, `pty:spawn` and `git:status`.
- `node config/scripts/runtime-verification/daemon-lifecycle/verify-ash-orcad-local-runtime-stop.mjs`: **PASS** using a fresh private profile, authenticated local CLI, real PTY, graceful runtime stop/restart, unchanged PTY handle/PID and final test-owned process/credential cleanup.
- Real source Electron under private KWin Wayland/DBus, disposable HOME/XDG/Codex/Claude/GitHub CLI profiles and Ash dev userData: **PASS**. The real Ash window reached DOM `complete` and exposed no Jira/Linear preload properties, while GitHub, GitLab, PTY, runtime, native chat and browser interfaces were present. The local runtime reached `ready`; an original-folder terminal `sleep 120` was created/listed via CLI and remained alive until explicit shutdown. Authenticated daemon and runtime stop receipts were successful; `/proc` showed zero remaining test-owned processes. The first native attempt encountered a transient `graph_not_ready` status immediately after the UI became ready; the separate, bounded ready-state check and repeat run passed. This is **source Electron**, not an installed AppImage or cross-platform proof.

## Scope not covered

This is a dead **Electron IPC** source-removal slice, not the deletion of all remaining `src/main/jira`, `src/main/linear`, renderer issue views, legacy references or credential material. The latter still need dependency-grounded review. A source-level IPC audit is not by itself proof of native AppImage behavior, so the runtime and distribution checks remain separate gates. Do not claim M8 complete based on this slice.

**Security follow-up identified during the audit:** `src/main/orcad/orcad-secret-store-startup.ts` still calls the legacy secret-store preparation and migration path using `orcadCredentialRoot()` in `src/main/orcad/orcad-plaintext-credential-migration.ts`, which currently points into `~/.orca`. That startup path can harden/re-seal other-application credential files and must be separately corrected with an explicit, data-preserving Ash-only key migration design. No real `~/.orca` profile was used or touched during these disposable-HOME acceptance tests; this work deliberately does not attempt an unreviewed credential rewrite. **Do not claim complete Ash/Orca data independence while this remains.**
