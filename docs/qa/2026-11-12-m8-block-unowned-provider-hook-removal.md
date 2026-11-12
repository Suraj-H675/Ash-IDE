# M8 — Block unowned provider-global hook removals

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean `main` at `f5035d1ed083cd86569b28a7e1b972b5bbabf258`; [GitHub Actions run 43253360144](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43253360144) completed successfully. The work uses isolated feature branch `fix/m8-guard-unowned-provider-hook-removal`.

## Defect and scope

Ash's provider-global install and settings-application entrypoints already refuse mutations because its per-provider ownership ledger is incomplete. However, direct `removeManagedAgentHooks` and asynchronous `removeManagedAgentHooksAsync` still dispatched to the inherited Orca removers, including the Grok configuration/owner-pruning pipeline. A dormant legacy Orca Windows uninstall preflight could call the synchronous remover and falsely report success. The inherited removers match shared provider configuration entries and scripts, not proven Ash-owned entries. Calling them risks breaking another installed application's agent integration.

Both general removal entrypoints now consult the **same fail-closed ownership gate** as installation. Until Ash can prove per-entry ownership, they return `skipped` results with `ash_ownership_unavailable`, honor the requested agent filter, and do **not** invoke a remover, inspect a hook file, probe an agent, or prune an ownership file. The older uninstall helper treats an unperformed `skipped` removal as **non-success**, rather than returning exit code zero. The Ash installer already excludes Orca's NSIS script and main entrypoint, so this is a defense-in-depth change to a retained legacy path, not a new uninstall feature.

Non-mutating provider-hook status inspection remains available through `getManagedAgentHookStatuses`. Retained terminal-first agents, local PTY runtime and native agent interfaces are unchanged. This commit **does not enable global hook installation**, transfer existing Orca ownership entries, remove provider-native hooks, or silently edit any provider account.

## Verified feature-worktree evidence

- **Red-first:** three negative tests failed against the old implementations: general synchronous removal invoked mocks; filtered removal reported old unguarded behavior; asynchronous Grok removal invoked its remover. The revised negative test suite passed **10/10** including the legacy uninstall flag reporting blocked cleanup and not creating provider files in disposable directories.
- `pnpm run typecheck`: **PASS** including the workspace package build.
- Expanded security, source and packaging regressions: **17 suites / 112 tests PASS**, including hook ownership transaction/removal tests, Windows installer isolation, prior Ash credential/shortcut isolation, and desktop/server bundle hygiene.
- Oxfmt/Oxlint of changed source and tests: **PASS** without warnings.
- `pnpm run build:desktop:assets`: **PASS**, including sandbox preload and CLI closure verification (1,224 files, three commands).
- `pnpm run build:orcad`: **PASS**, **12.78 MB / 8,141 modules**, zero forbidden Electron and `node:sqlite` imports; Node 24.22.1 pinned, native PTY glibc-floor check passed. An existing archive reused from canonical `main` was independently verified by SHA-512 against the watcher lockfile; the ordinary Node build and integrity checks were not bypassed.
- Real standalone plain-Node host: **PASS**, four authenticated local runtime instances with a real original-folder PTY surviving stop/restart; synthetic Orca credential and terminal-policy fixtures remained unchanged.
- Real Linux Wayland **source Electron**: **PASS** in disposable HOME/XDG/DBus/KWin with isolated Ash profile. GUI reached DOM complete; retained GitHub/GitLab, browser, PTY, runtime and native chat preload. Real renderer keyboard-shortcut bridge created an Ash-only shortcuts file and preserved a synthetic foreign file. Authenticated CLI created a live terminal; explicit daemon/runtime shutdown succeeded with **zero** test-owned processes remaining.
- The inherited uninstall test initially attempted to write into a disposable provider configuration directory and received a local EDQUOT (`-122`) write error. The corrected test avoids provider configuration writes entirely and verifies the safe removal decision and empty fixture directories. This was not counted as a successful provider-hook integration test.
- Pinned Orca source/provenance and license ledger: **PASS** after writing adapted-source hashes. 33,506 upstream file records, 456 adapted Ash source files, 8,508 documented exclusions, unchanged MIT notice SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Outstanding gates

Raw legacy hook installer/remover implementations and their Orca-named script/owner roots still exist in source. They must not be enabled through the general controls without an audited Ash-owned, content-verified, reversible ownership transaction and provider-specific validation. This milestone does not establish real-provider hook integration, Windows/macOS native behavior, AppImage acceptance, or full M8 security/release completion. Post-integration testing and the new GitHub CI must be reported separately.
