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
- Targeted formatter and linter passed with no errors. Post-integration packaging and handler-group tests passed **31/31**, and the full repository `pnpm run typecheck` passed. Source provenance verified **33,506 upstream records, 501 Ash adaptations, 8,508 exclusions**, with the pinned MIT notice.
- Canonical implementation HEAD `7491f84b63b8c68eb60efe8de712176321cc34e8` passed `pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64`. The fresh `dist/ash-ide-linux.AppImage` is **224,465,226 bytes**; SHA-256 **`f20eb19f84af04ac0ad8999e8015c5ba572495fff4be9704fbceb4a723ed46c6`**. Packaging checked glibc compatibility, native binaries, daemon-entry, bundled Node PTY, bundled plugin resources, and ASAR hygiene.
- Independent inventory of the resulting `dist/linux-unpacked/resources/app.asar` and `app.asar.unpacked`: **5,205 ASAR entries**, all **16 excluded artifacts absent**, all six explicitly retained CLI/reference/worktree helpers present. Compared with the prior AppImage's 5,221 entries, this is exactly 16 fewer. Bundled `ash-ide --help` succeeded and `ash-ide linear --help` exited with `Unknown command: linear`.
- Real Wayland packaged lifecycle fixture passed using disposable home/profile data and an isolated compositor: application PID `3163507`, runtime ID `35aa45e9-f47c-421f-8ab7-f178118a866c`, terminal handle `term_35bfb4a6-fef2-48ca-81b7-7d8578f09cb9`, terminal PID `3164135` survived closing/reopening the last GUI window. Test-owned daemon/runtime stopped; evidence at `/var/tmp/ashwl.cE3gRU`. This does not prove signed-in agent workflows or all screens.
- Hosted CI for the final pushed HEAD is a separate acceptance step; no successful result was claimed when this note was updated.

## Deliberate limits

The independent source-exclusion effort still needs to handle main-process tracker services, renderer/dashboard assets, RPC/preload remnants, shared model references, historical saved user preferences and vendor telemetry. This package-only slice does not prove EX-07/EX-10 acceptance, and does not modify user integrations, provider credentials, or repository contents outside Ash IDE.
