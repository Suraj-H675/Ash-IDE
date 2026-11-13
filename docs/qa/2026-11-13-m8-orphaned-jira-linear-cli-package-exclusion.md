# M8 — Exclude unregistered Jira/Linear command artifacts from desktop packages

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `94284791e73bd0c4c0d13d7bb9624af2961d7ee7`; GitHub Actions run `43403554422` completed successfully.
**Isolated branch:** `fix/m8-exclude-orphaned-tracker-cli-artifacts`.

## Finding and ownership boundary

Ash's published `ash-ide` CLI is allowlisted to local desktop, terminal and runtime commands. The shared CLI command specs and handler manifest have no Jira or Linear command root; the packaged CLI rejects `linear` as unknown. However, the TypeScript build still emits their historical command-spec, formatter and handler modules, and `electron-builder` previously included them in `app.asar` / `app.asar.unpacked` even though they are unregistered.

The same source tree has issue-reference and worktree utilities which must remain while retained Git provider, Git and workspace workflows depend on them. This is **not** approval to delete tracker-related source files or arbitrary `out/shared/jira`/`out/shared/linear` directories.

## Correction

- Added one explicit, reviewed list of **16** unregistered compiled command files in `config/excluded-task-tracker-cli-artifacts.cjs`.
- Desktop packaging excludes exactly those artifacts, not shared issue-reference or worktree helper modules. The exclusions apply to platform-independent `electron-builder` file selection.
- `verifyAshPackagedAsarHygiene()` also rejects the listed paths in the actual archive or in `app.asar.unpacked`, preventing future build-script drift from silently reintroducing them.

## Verification

- **Red-first:** the synthetic electron-builder `FileMatcher` regression failed on the old build because `out/cli/handlers/jira.js` was included. After the packaging change the test confirms all 16 paths are absent, while terminal, worktree-reference, Jira URL parser, CLI entry and runtime files remain selected.
- The packaging guard has synthetic archive rejection tests for a Jira handler and a Linear spec, plus an out-of-archive `app.asar.unpacked` rejection test. The two modified packaging suites passed **28/28 tests** on the isolated branch.
- Formatter, linter, provenance, integrated tests, actual AppImage contents, bundled CLI help, runtime PTY and display-server lifecycle results are recorded when observed. An unexecuted check is not treated as passing.

## Deliberate limits

The independent source-exclusion effort still needs to handle main-process tracker services, renderer/dashboard assets, RPC/preload remnants, shared model references, historical saved user preferences and vendor telemetry. This package-only slice does not prove EX-07/EX-10 acceptance, and does not modify user integrations, provider credentials, or repository contents outside Ash IDE.
