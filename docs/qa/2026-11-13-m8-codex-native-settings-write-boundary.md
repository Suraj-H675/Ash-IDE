# M8 SEC-04: Refuse Codex provider settings write-back

**Date:** 2026-11-13 (Asia/Kolkata)

**Base:** clean `fix/m8-codex-native-settings-boundary` at `4901648009a673b972f4a81e685770bbb3128f8e`.

## Finding and change

Ordinary Codex launch sync calls `syncSystemConfigIntoManagedCodexHome()`, which calls the exported `promoteCodexRuntimeSettingsToSystem()` before mirroring provider settings into Ash's runtime home. That writer could create `~/.codex/config.toml` or modify an existing file through a symlink. Direct callers of the exported writer had the same path.

The shared ownership policy now denies provider-global Codex settings writes by default. Promotion computes a read-only candidate, checks `canAshWriteProviderGlobalSettings()` before creating directories or writing files, and returns `writeBackState: 'refused'` when a candidate would change native settings. Launch sync does not mirror over pending runtime edits and retains their settings baseline. It does apply explicit native project trust revocations to the Ash runtime config, without overwriting pending ordinary settings. A launch with no pending write-back still mirrors native settings into Ash's separate runtime home. The Accounts pane reports refused write-back as degraded sync; a later successful mirror clears that warning.

The historical positive promotion tests explicitly mock the ownership gate only in disposable homes. Their file mode, symlink, baseline, feature, and registration assertions remain active.

## Verification

- **Red-first:** four new regression tests failed before the ownership gate. They observed direct scalar write-back, launch scalar overwrite, native config creation, and writes through a symlink target. Independent review then reproduced a stale degraded-sync warning after an edit was undone and a native project trust revocation not reaching a runtime with a pending local model edit. Both were corrected.
- Settings and runtime-home regression sweep after those corrections: **63 passed across 13 test files**. This includes plugin and MCP registration retention, no native config/directory creation, symlink preservation, read-only native-to-Ash mirroring, warning recovery, and native project distrust taking precedence over pending local edits.
- Expanded hooks, trust, settings and runtime-home sweep after the correction: **303 passed, 15 platform-specific skips across 62 files**. Additional WSL/home-routing fixtures: **18 passed across six files**. No WSL runtime binary was used on Linux.
- Node TypeScript check: **PASS** with `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json --composite false`.
- Web TypeScript check: **PASS** with `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.web.json --composite false`.
- Oxlint and Oxfmt checks: **PASS** for the 12 changed TypeScript files. `git diff --check` also passed.
- i18next extraction wrote to the task temp directory. The new English key matches its fallback, and all 11 locale catalogs include the same placeholder. The full localization verification failed on this branch, but an independent comparison reproduced the same two missing keys (`menu.exploreAsh`, `tray.openAsh`), eight fallback drifts, and 539 unreferenced keys on unmodified canonical `main`. The new key is not among the errors.
- All provider and Ash homes used by the regression tests were disposable. No credentials or native user homes were read or changed.
- Pinned Orca source provenance and MIT license checked against `docs/provenance/ash-modifications.json`, `docs/provenance/orca-1.4.214.jsonl` and `docs/provenance/ash-exclusions.json`. The independent verifier checks upstream hashes and exclusions; new Ash-only code remains separately attributed.

## Limits

Real Electron GUI and PTY launch tests were not run in the isolated feature worktree. These checks exercise the settings services and status types, not desktop startup or provider binaries. The localization verifier wrapper could not spawn its child Node process inside Codex (`EPERM`); outside its sandbox the wrapper ran and exposed the pre-existing drift described above. A frozen offline pnpm install could not acquire its store operation lock in the Codex environment, so the tests and compilers used a temporary worktree-local symlink to the dependency tree from the same base commit. No files in the main checkout were changed during the feature-worktree implementation.

Only explicit native project `untrusted` revocations are specially synchronized during blocked write-back. If native source or the managed runtime config cannot be read/written, the attempted revocation is logged, not claimed applied; a subsequent live-launch safety review is still required. This does not establish complete provider trust synchronization or real-provider consent.

This change blocks the implicit settings write-back path. It does not authorize any other provider-global config mutation path or establish general native-home ownership.
