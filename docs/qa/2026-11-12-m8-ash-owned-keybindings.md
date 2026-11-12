# M8 — Ash-owned keyboard shortcut file

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean `main` `f52825cf168cb3acc46db277977479a61435592d`; GitHub Actions [43244828714](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43244828714) concluded **success**. Feature branch `fix/m8-ash-owned-keybindings` uses an isolated Git worktree.

## Security boundary and implementation

The retained keyboard shortcut service previously constructed `~/.orca/keybindings.json` from the desktop's host home. Opening the shortcuts pane could read that other application's file; editing or the legacy Ash settings migration could create or replace it. This violates the independent application-data policy.

The real Electron startup now passes `app.getPath('userData')` to `KeybindingService`, while retaining the home path only to detect and refuse Orca-owned locations. The shortcut file is `<Ash userData>/keybindings.json`. The path is revalidated before every cached read, reload, file creation, and shortcut edit, checking physical path containment, symlink aliases, hard links, and unsafe files. Writes use an exclusive, unpredictable, mode-0600 temporary filename before atomic rename, so a planted predictable `keybindings.json.tmp` symlink cannot redirect content into another app's file. The settings pane's initial placeholder no longer advertises Orca's directory; once loaded, it still displays the actual file path from the service.

The existing legacy **Ash settings** shortcut overrides and the tab-switch shortcut cohort remain supported without change to their semantics. No automatic import from or deletion of Orca's `keybindings.json` is attempted; Orca customizations are not automatically transferred. The code does not alter user profiles, provider accounts or real legacy application data.

## Feature-worktree evidence

- **Red-first:** four focused tests failed against the original Orca-based path and predictable staging-file behavior. After implementation **4/4 pass**: Ash settings override retained under Ash userData, foreign Orca profile symlink refusal, cached-snapshot linked-file refusal on read/write, and planted staging symlink non-mutation.
- Full workspace `pnpm run typecheck`: **PASS**, including workspace package build.
- Relevant Vitest regression suite: **11 suites / 73 tests passed**, including prior Ash/Orca provider credential isolation, runtime RPC controls and desktop/server distribution hygiene.
- Oxfmt and Oxlint of changed active source and new test: **PASS** (no warnings/errors).
- `pnpm run build:desktop:assets`: **PASS**, including sandbox preload and verified CLI closure (1,224 files / three commands).
- `pnpm run build:orcad`: **PASS**, 12.78 MB / 8,141 modules, zero forbidden Electron or `node:sqlite` imports. First attempt was interrupted by a network timeout retrieving the lockfile-pinned `@parcel/watcher` archive; second attempt reused the existing **SHA-512-verified** cache archive from canonical `main` and ran the **unchanged full build**, including artifact integrity guards. No code/build-security check was bypassed.
- Real plain-Node local runtime lifecycle: **PASS**. Four isolated authenticated hosts, original-folder PTY survived runtime stop/restart, and historical synthetic foreign credential and terminal-policy files stayed untouched.
- **Real native Wayland source Electron:** **PASS** in isolated KWin/DBus, `HOME`/XDG and provider profiles. Ash window DOM complete, Jira/Linear preload absent, retained GitHub/GitLab/PTY/runtime/native chat/browser APIs. A synthetic `~/.orca/keybindings.json` was created inside that **disposable** HOME; calling the real renderer's `window.api.keybindings.ensureFile()` over Chrome DevTools returned `<isolated Ash profile>/keybindings.json`, verified that the new Ash file contained the expected document version, and verified that the Orca sentinel remained byte-for-byte unchanged. Authenticated CLI created a real PTY; runtime and daemon stop receipts succeeded, with **zero** test-owned processes left.
- Source provenance: **PASS** after updating adapted file hashes; 33,506 upstream Orca source records, 454 Ash-adapted file hashes, 8,508 documented exclusions, pinned MIT notice SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.

## Boundaries

Source Electron is not packaged AppImage verification. This milestone does not prove Windows/macOS native desktop shortcut storage, cross-version user-data migration, a real provider session, or full M8 release acceptance. The separately observed inherited Orca agent-hook ownership paths still need a dependency-grounded, source-preserving audit. Post-integration `main` verification and GitHub CI results must be distinguished from this feature evidence.
