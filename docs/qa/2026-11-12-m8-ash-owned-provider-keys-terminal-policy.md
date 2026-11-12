# M8 — Ash-owned provider credentials and terminal policy

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** 2e841fcff695999defa1bb572db9c49c5f1c86ce, with GitHub Actions run 43233485340 successful. **Worktree:** fix/m8-ash-owned-provider-keys-terminal-policy.

## Risk and solution

Three live retained provider-key stores (GLM/ZCode, MiniMax, OpenCode Go) still selected the Orca home under ~/.orca for read/status/permission-hardening/save/delete. A detached terminal daemon also read and wrote its host-wide terminal policy under ~/.orca/host-settings. These were live Ash/Orca application-data isolation defects after headless key isolation.

The provider stores now resolve their paths under the active AppEnvironment's Ash userData, in its provider-credentials subdirectory. The shared resolver rejects invalid filenames, foreign profile aliases, out-of-profile credential directories, symlinked key files and multiply linked key files before read, hardening, save or clear. In-memory GLM/ZCode and generic provider key caches are bound to their file paths to prevent profile-switch leakage. Existing on-disk encrypted/plaintext envelope formats and provider RPC methods are preserved.

The machine-wide terminal policy now uses an Ash-only location under the host home, .ash-ide/host-settings/<machine hash>/terminals.json, rather than Orca's host-settings directory. It still shares limits between local Ash daemon processes. Redirected Ash policy roots pointing into Orca are rejected.

**No automatic import:** prior Orca provider credentials and terminal-limit configuration are not read, copied, migrated, removed or rewritten. Existing Ash profiles needing credentials may require user re-entry and Ash terminal limits may need reconfiguration. Import or recovery would require a separately approved and verified procedure.

## Evidence: feature worktree

- Red-first: 10 tests failed before the implementation, on outdated destinations and live foreign application data.
- Focused tests: 3 suites / **27 passed**, including negative foreign-path, hardlink/symlink, cache-switch and terminal-limit policy tests.
- Expanded regression: 12 suites / **79 passed**, including previous headless-secret isolation, runtime controls, daemon admission and package hygiene.
- Full TypeScript check: PASS. Formatting and lint of modified source and tests: PASS.
- Desktop asset build: PASS, including sandbox preload and verified CLI closure, 1,224 files / three commands.
- Plain-Node server build: PASS, 12.78 MB / 8,141 modules, Node 24.22.1, zero forbidden Electron and node:sqlite imports.
- Real packaged-Node runtime smoke: PASS. Four authenticated local runtimes, live PTY preserved across runtime stop/restart, and synthetic foreign Orca credential **and terminal policy** files retained unchanged.
- Real native Linux Wayland source desktop: PASS with isolated HOME/XDG/DBus/KWin, real authenticated terminal creation and successful test-owned runtime/daemon shutdown; zero fixture-owned processes left.
- Frozen Orca MIT source provenance: verified after updating the Ash source modification ledger.

## Limitations

This is not proof of real-provider account connectivity, a credential re-entry UX, an installed AppImage, Windows/macOS native behavior, or full M8/release acceptance. Foreign Orca keys and machine policy remain where they were; no real user credentials were accessed. Integrated-main testing and new GitHub CI must be observed separately.
