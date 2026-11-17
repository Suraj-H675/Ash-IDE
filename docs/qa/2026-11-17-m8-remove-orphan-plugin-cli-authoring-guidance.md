# M8 QA — retire orphan app-plugin CLI authoring and development-watch tooling

**Status:** implementation verified and integrated into `main` at commit `115e678d289484ca4c3092b22fb0e3a9c868c8df`; this slice does not complete M8.

## Repository and scope

- Base commit: `63e059d01b1c6ec1bb393de6300b72703067823d`
- Feature branch: `fix/m8-remove-orphan-plugin-cli-authoring`
- Integrated branch: `main`
- Integration was a fast-forward from the stated base; no force-push or history rewrite was used.
- This slice removes the unregistered Ash app-plugin authoring/development-watch CLI implementation and its bundled authoring guidance. It does not remove the general app-plugin main backend, IPC/RPC/preload contracts, renderer contribution stores, plugin frame guest, or provider-native hooks/skills/MCP. Those remain separate M8 work.

## Changes

- Deleted 76 pinned Orca-derived source files under `src/cli/plugin-authoring/`, `src/cli/plugin-dev-watch/`, plugin-only CLI specs/handlers, `config/scripts/plugin-authoring/`, and the plugin-authoring skill-reference generator. The removed files are individually recorded in `docs/provenance/ash-exclusions.json` with their pinned source hashes.
- Removed the orphan CLI plugin command exit-code, remote-selection, prompt-recovery, command help, and JSON-lines error-formatting branches. Ordinary terminal creation, generic CLI error handling, remote-selection behavior, and durable prompt retry remain.
- Removed `orca-plugin-authoring` from the bundled CLI guide, installable bundled skill sources, current skill manifest, and future bundled-skill discovery. Removed the plugin-specific `orca-cli` reference and section.
- Preserved the historical `orca-plugin-authoring` entry in `resources/skills/released-digests.json` so previously installed user skill bytes remain recognizable. Provider-native skill/MCP integrations remain untouched.
- Removed obsolete authoring/schema/validation/RPC-catalog package scripts and their preflight/source-routing references. Updated the retained generated RPC parameter catalog header so it no longer advertises the removed generator; kept the built-in RPC contract catalog and declarative runtime generator.
- Retained the Codex CLI native `plugin` subcommand classification; it is provider-native CLI behavior, not an Ash app-plugin command.
- Added regression coverage to the foundation workflow for command registration, removed source paths, bundled guidance, and released-digest compatibility.

## Verification evidence

- Focused Vitest: **5 files, 21 tests passed**. This includes the CLI exclusion assertions, handler registry, runtime client recovery, bundled skill-source compatibility, and generator exclusion rules.
- Full project type-check: `node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs` — **passed before and after integration**.
- Post-integration focused Vitest and provenance checks were rerun on `main` at `115e678d` and passed.
- Provenance: `node config/scripts/provenance/verify-source-ledger.mjs` — **passed**; 33,506 upstream records, 660 Ash modifications, 8,842 documented removals, pinned MIT license hash verified.
- Oxfmt: changed files — **passed**.
- Oxlint with `--deny-warnings`: changed source/test files — **0 warnings, 0 errors**.
- `git diff --check` — **passed**.
- Desktop assets: `pnpm --config.manage-package-manager-versions=false run build:desktop:assets` — **passed**. CLI build, Electron/Vite build, and `verify-skills-cli-runtime` completed; the runtime verifier accepted **1,075 closure files and 3 commands**.
- Built-output search found no `orca-plugin-authoring`, `plugin create`, or `plugin dev watch` strings in the generated CLI/skill output and no compiled plugin-authoring/dev-watch CLI directories.
- A direct run of the exact five-file Vitest command outside the restricted Codex sandbox passed 21/21. The sandboxed run of socket-based runtime client tests timed out at its 30-second RPC fixtures; the same tests pass outside that sandbox.

## Known baseline limitations (not changed by this slice)

- `src/cli/format-recovery.test.ts` has two stale-terminal-handle assertions expecting Orca-server wording while Ash returns the Ash-runtime wording. The same two failures were reproduced on the unmodified base commit `63e059d`; this slice does not alter those assertions or runtime behavior.
- `config/scripts/ci/unit-selection/check-test-file-runners.mjs` is not green on the base Ash checkout: it expects absent `tests/`, `cloud/`, `mobile/`, `.github/workflows/pr.yml`, and `.github/workflows/unit-tests.yml` trees/files. The source-routing change here only removes the retired plugin CLI test-runner entry; the generic checker was not weakened to hide the broader baseline drift.
- The generic bundled-guide/skill-manifest verifiers cannot regenerate or verify the missing root source trees `skill-guides/` and `skills/` (they fail with `ENOENT` on the base checkout). This slice updates the generated outputs and adds an explicit generator exclusion; it does not invent missing source Markdown. The dedicated plugin-authoring reference verifier is retired with its generator.
- The desktop-assets build emitted CSS pseudo-element, large-chunk, and ineffective-dynamic-import warnings, but completed successfully. No AppImage or GUI lifecycle run was needed for this CLI/bundled-guidance-only slice.

## Remaining M8 work

M8 is **not complete**. Main-process app-plugin hosts, preload/RPC surfaces, renderer plugin syntax/theme/language/icon contributions, plugin frame guest code, and remaining app-plugin backend/bundle sources still require separate audited removal while preserving built-in editor, theme, language, terminal, browser-extension, and provider-native functionality.

No user repositories, provider accounts, credentials, or installed user skill files were modified.
