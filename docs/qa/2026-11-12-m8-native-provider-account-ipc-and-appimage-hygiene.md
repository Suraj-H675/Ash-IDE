# M8 — Restore provider-native account IPC and prevent private checkout data entering AppImage

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** `main` at `de00c437fd0eabaf805867bdadd9de1ae47896d7`, clean and synchronized with `origin/main` before changes.

**Previous GitHub CI:** [Foundation run 43153340997](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43153340997), **success** for that base commit.

**Source:** pinned Orca `55697aec91390357540103f49991458f756b41cc`; independent Ash Git and MIT attribution retained.

## Provider account regression and repair

During the first real packaged X11 reopen, Electron logged `No handler registered for 'codexAccounts:listRecordedPaneLanes'`. The producer was the retained Codex restart flow. Audit of `src/main/ipc/codex-accounts.ts`, `claude-accounts.ts`, the preload bridges, and `main-process-ready-runtime.ts` confirmed **all 10 Codex and 7 Claude native account handlers were unregistered** in the Ash startup sequence, although the Settings UI still uses them. The retained `CodexAccountService` and `ClaudeAccountService` themselves were initialized.

- Restored production registration of both retained provider-native account handler sets immediately after provider services initialize, including saved-pane attribution and pending sign-in URL updates.
- Added `ash-native-account-ipc.ts` with a trusted-main-renderer sender guard, strict Zod parameter schemas, bounded pane IDs, valid account IDs, and **host-local-only** account selection and sign-in targets. Missing runtime selectors are explicitly resolved to `host`, rather than inheriting the upstream WSL-account inference route. Retired WSL/remote-development account selection is refused. No vendor Ash Cloud account, relay, or marketplace handler was restored.
- Routed Codex pending-login URL broadcasts through `sendToTrustedUIRenderer`, not `BrowserWindow.getAllWindows()`: provider OAuth URLs can contain private state and must not be sent to arbitrary browser/plugin/popout windows.
- Added five focused tests with **stubbed service methods only**: exact 17 channel registrations, valid host selection and native actions, bounded pane attribution, trusted broadcast, rejection of untrusted sender identities, invalid account inputs, and excluded remote/Cloud fields. Added the suite and ready-startup assertion to Foundation's retained IPC group.

**No real provider account was added, reauthenticated, selected, removed, signed in, or mutated by these tests.** This is a verified registration/validation boundary, not real OAuth/credential acceptance. The current trusted renderer selection still needs independent multi-window audit.

## Package-content privacy incident and fail-closed fix

The first AppImage rebuilt after the IPC change passed daemon, PTY, native, and basic runtime checks and launched under X11, but its `app.asar` grew to **676,883,253 bytes**, and the AppImage grew to **451,986,871 bytes**. Direct `@electron/asar` inspection found **5,704 `.cache` entries, 3 `.audit` entries, and 5 `.tmp` entries** among its packaged roots. Git ignored these directories, but electron-builder's file matcher did **not**. The bundle could contain private test/development state; the old candidate was treated as unsafe. **It was not published, attached, installed, or distributed.** The local artifact was replaced by the corrected build.

Fixes:

- `config/electron-builder.config.cjs` now excludes entire root `.cache`, `.audit`, `.tmp`, `dist`, and `release` directories. The prior narrow `.cache/vite` exclusion was inadequate.
- Added `verify-ash-packaged-asar-hygiene.cjs`, invoked **unconditionally in `afterPack`**, before release artifacts are assembled. It inspects the *actual* `app.asar`, refuses any top-level root outside the reviewed runtime allowlist, and confirms the compiled runtime and package metadata roots exist. Failure shows root names only, not nested private filenames or contents.
- Added a real electron-builder `FileMatcher` regression with synthetic ignored private-profile/QA/cache/distribution files, plus **nine real ASAR archive tests** covering allowlisted roots, each disallowed source root, and missing runtime. The Foundation packaging step now runs both tests.

The corrected builder reported **`[ash-package-hygiene] OK — 5221 archive entries in reviewed roots`**, with inspected roots exactly `LICENSE`, `out`, `package.json`, `resources`, `scripts`. Direct inspection confirmed no `.cache`, `.audit`, `.tmp`, `.env`, `dist`, or `release` paths in the archive. The clean ASAR was about **9.7 MB**.

## Corrected AppImage build and real Linux X11 smoke

`pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64` succeeded with all existing native verifiers still enabled: **15 bundled native binaries met the Ubuntu 20.04 glibc floor**, packaged daemon entry booted under Node, bundled Node served a PTY, and two plugin resource inventories verified. The final executable:

- Path: `dist/ash-ide-linux.AppImage` (local, ignored build artifact; **not** a published release)
- Bytes: **225,618,010** (about 215 MiB)
- SHA-256: `7b6b13b9c03229f2e25404e5a0c4299209d1ef8f7d03658fcf622cadff1c0ee1`
- Type: ELF64, x86-64 static PIE AppImage

The successful live probe ran this corrected AppImage inside a separate Xvfb/X11 server with disposable, **disk-backed** `.cache/pty.*` HOME, XDG, runtime socket, and Ash profile directories. No user-owned repo was registered. The test created only a disposable non-Git folder and an idle local PTY; its CLI calls used the packaged `linux-unpacked` Node runtime/CLI artifacts connected to the live AppImage. This does not prove the mounted AppImage CLI launcher works through a globally installed command.

| Stage | Runtime PID / ID | Terminal handle |
| --- | --- | --- |
| Initial open | `1060373` / `f98e1d9a-4efc-499b-85fa-daf8a684b7dd` | `term_441b383c-a0bc-4ae8-925f-30724fe16c06` |
| GUI closed through X11 `WM_DELETE_WINDOW` | **same PID and runtime ID**, reachable, window `openable` | **same**, one session |
| Reopened with packaged CLI `open --json` | **same PID and runtime ID**, window `available` | **same**, one session |

`terminal-daemon stop --yes --json` and `runtime stop --yes --json` both returned exit code zero; no test-owned processes remained. No Codex/Claude account-handler registration errors appeared in the packaged app log. The X11 fixture produced a 1366×768 screenshot. On immediate reopen the runtime graph still showed `graph_not_ready` while the window was `available` and runtime RPC remained reachable; graph readiness later was not checked, so do not infer completed UI hydration.

The first post-fix probe **failed** before runtime startup because the disposable `TMPDIR` name was too long for Chromium's `SingletonSocket`; the shorter disk-backed fixture passed the entire subsequent test. This was a test-harness path-limit failure, not proof of a product IPC regression. No sandbox or glibc check was bypassed.

## Locally observed test/build evidence

- Focused existing startup/provider/bundled-skill tests: **4 suites / 20 passed**.
- Exact Foundation retained-IPC step (includes new provider test): **27 suites / 88 passed**.
- Exact Foundation vendor-feature exclusion step: **27 suites / 89 passed**.
- Real package-input matcher plus real-ASAR hygiene tests: **2 suites / 17 passed** (8 config + 9 archive tests).
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings after correcting test-harness style issues.
- `pnpm run verify:rpc-params-catalog`: **passed** (no RPC catalog changes).
- CLI build (`ORCA_CLI_BUILD_COMPILER=tsrs`): **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload. Existing large-chunk and ineffective dynamic-import warnings remain.
- Source provenance verifier: **passed**, **33,506** upstream records, **404** Ash adaptations, **8,477** source exclusions, unchanged original MIT license hash `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Remaining acceptance gates

This checkpoint does **not** test actual provider login, account switching, remote-provider identity, new token writes, or signed-in Codex/Claude turns. A real **native Wayland AppImage** launch, independent multi-window UI interactions, full visual parity, browser/clipboard, installed CLI launcher, and updater/release rollback are also outstanding. Legacy `@linear/sdk` and `@posthog` dependencies still require an independent **reachability/source provenance** audit before removing anything: inclusion alone does not establish active telemetry. Linux AppImage's `desktopName`/`WM_CLASS` warning is not yet fixed. No public GitHub release, user-profile migration, installer execution, or global CLI replacement occurred.

**Disposition:** provider account local IPC and OAuth broadcast security boundary verified with mocks and packaged startup; packaging private-data exclusion **verified against the actual binary**; X11 packaged PTY lifecycle verified; full M8 release acceptance remains **open**. Git integration and successor CI status must be reported separately after observing them.
