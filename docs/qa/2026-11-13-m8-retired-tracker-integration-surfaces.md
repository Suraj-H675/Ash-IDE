# M8 / EX-07 — Retired Jira/Linear integration and workspace creation entry points

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `44ec788e8b9dafc914437d922e17beb3ba3da3bd` (GitHub Actions `43476167151`: success).
**Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-25d08210`, branch `fix/m8-remove-jira-linear-integration-surfaces`.

## Implemented

- Removed the no-longer-mounted Jira/Linear integration cards, credential-capture dialogs, Task Sources setup and Linear agent-skill onboarding/installation surfaces. Integration search no longer advertises their credentials.
- Removed the Jira default-project setting from repository Settings and the Jira issue-key casing control from Git Settings, including searchable entries.
- Removed the retired Linear skill prompt from both sidebar workspace-card templates, without deleting historical issue links or workspace metadata.
- Removed Jira/Linear-specific source modes and URL-paste interception from the new-workspace name composer. Legacy source contexts are explicitly nulled in its foundation so it cannot start connector status or issue queries for these excluded providers. GitHub, GitLab, branch and text modes remain.
- Removed obsolete Linear-specific readiness and feature-setup selection wiring. Kept old user data, provider state stores, credential storage and historical links intact; no destructive migration or external provider API calls were performed.
- Added a mounted React regression test verifying that previously selected Jira/Linear composer modes fall back to Smart while GitHub/GitLab/branch/text remain available.
- Recorded 28 newly removed upstream files with pinned-source hashes in the exclusion manifest. No upstream attribution was discarded.

## Executed verification

- **52 targeted Vitest tests passed in 18 files**: composer mode fallback, retired-provider read fences, task page code-host selection and presentation, integration Settings, onboarding, privacy and runtime IPC facade boundaries.
- Full `pnpm run typecheck` passed. Oxfmt/Oxlint on changed code passed with zero warnings/errors; `git diff --check` passed.
- Pinned provenance verified **33,506 upstream records, 556 current Ash adaptations and 8,558 documented exclusions**, retaining the pinned Orca MIT notice.
- `pnpm run build:desktop:assets` passed: renderer 257 chunks, 7,801.9 KB minified boot graph; sandbox preload verified; compiled CLI closure 1,224 files and three commands.
- `pnpm run build:orcad` passed: 12.79 MB, 8,148 modules, zero Electron/`node:sqlite` imports; Node 24.22.1 reference.
- `pnpm run build:native` passed native tests and the glibc 2.31 check; `pnpm run ensure:electron-runtime` passed.
- First direct electron-builder attempt stopped at the missing generated `out/package.json` CLI boundary. Ran the existing `node config/scripts/cli-build/verify-cli-bin.mjs --fix-executable --fix-package-json` prepack command, then **repeated the electron-builder packaging successfully**. No source change was made to hide this preparation failure.
- Fresh Linux x64 AppImage: `dist/ash-ide-linux.AppImage`, **224,374,862 bytes**, SHA-256 **`edddfab09b7a53f38a59a1eee282c5793a3be7258a9f31d9a53d062d1ba83a7e`**. Packaging checked 5,199 archive entries, 15 native binaries against the Ubuntu 20.04 glibc floor, daemon entry, bundled Node PTY and two plugin-resource bundles.
- **Packaged native Wayland GUI/PTY close-reopen PASS** from private virtual KWin/DBus fixtures: app PID `3763613`, runtime ID `61ab8517-8cb7-4cae-aa00-0fdd8f3d0651`, terminal handle `term_ada8620e-b958-4c47-9b97-110cef60d700`, terminal PID `3764198`. The last GUI closed and reopened without changing the live runtime/PTY identity. Test-owned daemon/runtime stopped; private logs `/var/tmp/ashwl.wXDjZd`.

## Limits / remaining gates

- This is **an EX-07 UI/entry-point removal milestone**, not proof that the entire excluded Jira/Linear backend is absent. Historical data models, store compatibility, runtime RPC methods and inherited provider modules still require separate retirement or a deliberate read-only compatibility boundary.
- No real signed-in Codex/Claude or other provider account was exercised, and no existing user profile, provider tokens or repository data was modified.
- X11, macOS, Windows, signed releases, updater rollback, visual-parity review and whole-product EX-01–EX-10 scans remain separate acceptance work.
- This document describes local verification; the successor integrated GitHub Actions run must be checked separately. No CI result for the successor commit is presumed.
