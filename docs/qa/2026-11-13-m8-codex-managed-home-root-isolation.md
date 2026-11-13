# M8 — Keep default Codex managed-home state in the Ash profile

**Date:** 2026-11-13 (Asia/Kolkata)

**Base:** clean canonical `main` at `2e5d68d3e4ea7eb148804c99e8c59f74bfc41349`; GitHub Actions [run 43280178296](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43280178296) completed successfully. Independent branch `fix/m8-isolate-codex-managed-home-root`, worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-isolate-codex-managed-home-root`.

## Security finding and change

Codex's inherited `getOrcaUserDataPath()` returned **`~/.config/orca`** on Linux (and the platform-equivalent Orca app data root elsewhere) when `ORCA_USER_DATA_PATH` was absent. Multiple Codex managed-home, session, history, hook trust and account paths depend on this helper; `getOrcaManagedCodexHomePath()` could then create a child directory under the installed application's independent profile. An explicitly supplied `ORCA_USER_DATA_PATH` was also accepted without boundary validation. The old materializing helper followed symlinked runtime-home child directories without a containment check.

The resolver now delegates to Ash's existing validated `resolveUserDataPath()` for the no-override case, honoring the Ash-only `ASH_USER_DATA_PATH` and platform defaults. The retained legacy-named `ORCA_USER_DATA_PATH` remains a compatibility **environment bridge** for Electron/standalone clients, but its selected value must pass `assertAshUserDataPathIsIndependent()`. It may not select an installed Orca profile or symlink alias. `resolveOrcaManagedCodexHomePath()` validates that the `codex-runtime-home/home` child stays inside the selected Ash profile before returning a path; the materializing helper creates it with private-mode request and rechecks the child after creation.

An explicit, safe Ash-owned profile is preserved; this is **not** a migration or import from existing Orca data. Provider-native `~/.codex` remains an intentional source for user-approved native provider capabilities; this change does not authorize hook installation or rewrite native provider credentials. The selected Ash data root stays aligned with the standard standalone local-host selector. Future cleanup may rename the inherited Orca-named exported methods, but their behavior is now Ash-isolated.

## Feature-worktree evidence

- **Red-first:** six negative tests reproduced the previous fallback, ignored Ash selection, direct Orca profile override, alias, symlinked child, and unsafe `XDG_CONFIG_HOME` behavior. The corrected suite passed **6/6**, with byte-verified Orca sentinels and no creation of Orca-managed Codex home files. Both Oxfmt and Oxlint passed.
- Full workspace TypeScript verification: **PASS**, including workspace package builds.
- Broader Codex managed-home/config, hook/trust and server-bundle isolation: **288 passed, 4 skipped across 58 suites**.
- Separate account/history sweep: **298 passed, 6 skipped, 18 failed across 74 suites**. Most failures cited missing `AppEnvironment` setup; comparing the seven failing files with unchanged canonical `main` reproduced the same categories of failures in their baseline fixtures. An additional account-key case timed out only in the wide parallel sweep, then passed when isolated. The known legacy account-suite failures are **not** counted green or as accepted product behavior.
- Desktop asset build: **PASS**, sandbox preload, renderer and 1,224-file/three-command CLI closure verified.
- Standalone Node host build: **PASS**, 12.78 MB / 8,146 modules, zero forbidden Electron and `node:sqlite` imports; Node 24.22.1 native binary compatibility verified. The cached native watcher archive was independently SHA-512 checked against the lockfile before ordinary build verification.
- Real four-host local plain-Node runtime: **PASS**; authenticated original-folder terminal preserved handle and PID through runtime stop/restart. Foreign Orca credential, hook and terminal-policy sentinels remained unchanged in the disposable profile.
- Native Linux Wayland **source Electron**: **PASS** using a private KWin/DBus and disposable HOME/XDG/Ash profile. GUI DOM complete, retained GitHub/GitLab, browser, PTY, runtime and native chat interfaces; authenticated CLI created a real terminal; explicit daemon/runtime shutdown succeeded and **zero** test-owned processes remained. Foreign Orca hook bytes were unchanged.
- Source provenance and license ledger: **PASS** after the adapted-source hash update, 33,506 pinned upstream Orca records, 462 Ash-adapted source hashes, 8,508 documented exclusions, unchanged MIT SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Remaining acceptance gates

Global Codex hook install/cleanup, direct removal and launch-home trust-mutation paths still need per-entry ownership, explicit consent and provider-native verification; this path correction alone does **not** make them safe. The path checks are not an atomic defense against a hostile concurrent filesystem writer. No real provider account was used or modified in the isolated tests. The inherited offline CLI test failures and the account-test initialization defects remain separate QA work. Native Windows/macOS, installed AppImage, update/rollback and complete M8 release acceptance remain unverified. Integration and the new matching GitHub CI must be reported separately.
