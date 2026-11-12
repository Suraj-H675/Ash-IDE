# M8 — Ash-only shared managed-hook scripts and Grok owner registry

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean canonical `main` `921c7692bc90d38b537bf6dc604ac8ff0b32adbd`; GitHub Actions [run 43263896735](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43263896735) concluded **success**. Independent worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-isolate-managed-hook-artifacts`, branch `fix/m8-isolate-managed-hook-artifacts`.

## Risk and implemented boundary

Retained provider hook helpers still selected a shared managed-script path under **`~/.orca/agent-hooks`**. A direct refresh/install call could therefore read or modify Orca-owned hook scripts even though Ash's high-level provider-global installation is disabled. Grok's Windows owner registry also lived at `~/.orca/agent-hooks/grok-owners`, and its liveness helper could automatically remove invalid or stale owner records. Direct Grok install/remove and asynchronous cleanup methods were callable separately from Ash's higher-level mutation gate.

Managed provider hook script resolution now uses **`<host HOME>/.ash-ide/agent-hooks`**. All consumers of `getSharedManagedScriptPath` (Claude, Codex, Grok and other retained agents) use the Ash-owned machine-wide root. The shared artifact resolver rejects nested/traversal filenames; symlinked or unsafe directories; foreign file symlinks/hardlinks, owners, and write permissions. Path resolution does not create a directory or migrate any Orca script.

Grok's owner files now live under **`<host HOME>/.ash-ide/agent-hooks/grok-owners`**. Registration creates the Ash-only directory, validates it again, and accepts an existing owner-token file only if its contents belong to this process. Unregistration checks the record before deletion. Liveness inspection reads bounded, regular, single-linked owner files without following symlinks, and **never prunes any other owner record**. An invalid, dead or unverifiable peer blocks a potentially destructive cleanup rather than being silently deleted.

Direct Grok `install`, `installRemote`, `remove`, `removeAsync` and managed-script refresh respect the **existing disabled provider-global ownership gate**. Hook mutation returns `skipped` / `ash_ownership_unavailable` and cannot read or edit provider configuration in this state. Grok status inspection remains available, but a command referencing Orca's previous script root is no longer interpreted as an Ash-managed installed hook. Source logic for Grok status/config paths was extracted without changing its read-only status contract.

No actual user's provider home, credential, Orca profile or hook was read or modified. Existing Orca commands and scripts are left unchanged; there is **no automatic import or migration**. Terminal-first agents and native CLI operation remain separate from optional provider-global status hooks.

## Feature-worktree evidence

- **Red-first:** five focused failures against the old script/owner roots, traversal acceptance, peer pruning and direct Grok bypass; a later separate red-first owner-token collision test proved the former silent `EEXIST` acceptance. Corrected focused hook and bypass tests **22/22 passed across three suites**; the new artifact suite itself has **10/10**.
- Full workspace `pnpm run typecheck`: **PASS**, rerun after the final owner-token and file-path hardening.
- Expanded Ash security/runtime/distribution tests: **170/170 tests across 22 suites PASS** on final feature source. Five representative inherited Codex hook/trust/reconciliation suites also passed **42 tests, 1 skipped**.
- Oxfmt and Oxlint on modified sources/tests and the runtime smoke script: **PASS**, zero warnings and errors.
- Desktop asset build: **PASS**, including sandbox preload and 1,224-file / three-command CLI closure verification.
- Standalone Node build: **PASS**, Node 24.22.1, **12.78 MB / 8,143 modules**, zero forbidden Electron or `node:sqlite` imports, native PTY glibc-floor compatibility verified. The watcher archive reused from the verified canonical cache was independently checked against `pnpm-lock.yaml` SHA-512; no build integrity gates were bypassed.
- Real four-host plain-Node local runtime: **PASS**, original-folder PTY PID and handle survived runtime stop/restart, and synthetic foreign Orca credentials, terminal policies, managed hook script and Grok owner records were unchanged.
- Real native Linux Wayland source Electron: **PASS** using a private KWin/DBus and disposable HOME/XDG/agent profiles. Ash window DOM complete with GitHub/GitLab/PTY/runtime/native chat/browser surfaces, Jira/Linear preload absent, native shortcut IPC in Ash's userData, real authenticated CLI terminal, explicit runtime/daemon shutdown, and **zero test-owned processes remaining**. Synthetic foreign Orca hook script and owner-record bytes remained unchanged.
- Source provenance and pinned MIT attribution: **PASS**, 33,506 upstream file records, 459 adapted Ash source hashes, 8,508 documented removals and unchanged MIT SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Remaining risks and acceptance boundary

Other inherited provider-specific global hook removers still use broad script-name matching and must **not** be exposed directly or enabled without Ash per-entry provenance and a reversible, explicitly approved transaction. The documented uncooperative provider-writer race also prevents enabling Ash provider-global mutations now. The Grok provider config's legacy file naming and source-level inert helpers remain for later dependency-grounded cleanup. There is no installed AppImage verification, real-provider hook consent/install/uninstall smoke, Windows/macOS native acceptance, or full M8 release acceptance in this milestone. Post-integration tests and matching GitHub CI must be observed separately.
