# M8 — Fail closed on inherited Codex native-home hook/trust writes

**Date:** 2026-11-13 (Asia/Kolkata)

**Base:** clean canonical `main` at `4cb65f6df7b7ab51812cfbfa2ef74b65dfa7e470`; [GitHub Actions 43364085695](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43364085695) concluded **success**. Worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-codex-launch-native-write-boundary`, branch `fix/m8-codex-launch-native-write-boundary`.

## Risk and mitigation

The existing central Ash hook controller and direct `CodexHookService.remove()` guard do not cover _all_ native-home writes. A normal `CodexHookService.install()` or disabled-hooks refresh could invoke inherited `cleanupLegacyManagedHookRepresentations()` and delete legacy Orca hook entries or profile blocks under the provider's `~/.codex`. That same launch flow could call `promoteCodexRuntimeHookApprovalsToSystem()` and write approvals/disabled states from Ash's runtime home into the provider-global `~/.codex/config.toml`. Native-pane startup `reconcileRealHomeCodexHookEntries()` was also reachable outside the guarded public service, and could insert status hooks into `~/.codex/hooks.json` with associated trust entries.

All three provider-global entrypoints now honor the existing **fail-closed** `canAshWriteProviderGlobalHooks()` policy. `cleanupLegacySystemManagedHooks()` is independently gated as an exported API, as is its encompassing legacy profile cleanup entrypoint. `promoteCodexRuntimeHookApprovalsToSystem()` returns without inspecting/writing the provider home when ownership is unavailable. `reconcileRealHomeCodexHookEntries()` similarly does not install hooks or trust into native `~/.codex`. This preserves the **separate Ash-managed `CODEX_HOME`** install/refresh and native terminal launches. There is no new environment toggle, credential import, provider-home migration or authorization to write global hooks.

The inherited positive native-home transaction suites remain intact, but must **explicitly mock the provider-global ownership gate inside disposable fixtures**; this tests historical mechanics, not approved Ash production mutations. The default negative tests keep the real gate disabled.

## Evidence and limitation

- **Red-first:** native-home tests observed the legacy Orca profile block being changed by both installation and disabled-hooks refresh; runtime approval promotion created native Codex trust; and direct native-pane reconciliation rewrote `hooks.json`. The corrected deny-mode suite is **5/5 PASS**, including direct exported cleanup calls, unchanged native hook bytes, and no automatic native trust-file creation.
- Full TypeScript/lint: **PASS**. Deep Codex hooks, trust, settings and home regression suites: **252 passed, 15 skipped across 55 suites**. Expanded Codex/security/server packaging suite: **327 passed, 15 skipped across 66 suites**. Fixture-only historical reconciler, trust-promotion, symlink, cleanup and status tests retained their substantive checks.
- Desktop asset build: **PASS**, sandbox preload, 255 renderer chunks and 1,224-file/three-command CLI closure verified.
- Standalone Node build: **PASS**, 12.78 MB / 8,146 modules, no forbidden Electron or `node:sqlite` imports, Node 24.22.1 native compatibility. Cached watcher package independently SHA-512 checked against `pnpm-lock.yaml`; normal build integrity gates were retained.
- Real four-host local runtime/PTY: **PASS**, original-folder terminal retained handle and PID after runtime stop/restart; disposable foreign Orca credentials, policies and hooks unchanged.
- Native Linux Wayland **source Electron**: **PASS**, private KWin/DBus and disposable HOME/XDG/Ash profile, Ash window ready with GitHub/GitLab/PTY/runtime/native chat/browser surfaces; authenticated CLI terminal created, runtime/daemon stop receipts passed, **zero** test-owned processes. Synthetic Orca hook unchanged.
- Security tradeoff: a user approval made **only inside an Ash runtime home** can be lost on subsequent system-config mirroring, because Ash must not silently promote it into native `~/.codex/config.toml`. This is documented degraded hook integration. A future Ash-local approval persistence/reconciliation design must prove safety against provider-side revocations and changed commands before being enabled. This change does not claim to solve that problem.
- Other provider-native configuration paths, including general Codex settings promotion, WSL hook/trust paths and direct lower-level native-home helpers, require independent ownership review. Do **not** interpret this milestone as complete native-provider nonmutation or full M8 acceptance.
- Pinned source ledger and MIT provenance: **PASS**, 33,506 pinned upstream Orca records, 477 Ash-adapted source hashes, 8,508 documented exclusions; MIT license SHA-256 unchanged at `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Boundaries still open

Global hook status registration remains disabled in production. User-supplied and guest runtime-home validation, direct Codex install/refresh writing into untrusted custom home paths, native config settings promotion, provider-version compatibility, installed AppImage, native Windows/macOS and real-provider consent are not accepted by this change. No real user provider directory was modified in these tests. The inherited offline CLI and account-suite initialization failures remain separate baseline defects.
