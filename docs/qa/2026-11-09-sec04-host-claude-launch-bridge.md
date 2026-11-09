# SEC-04 host Claude launch bridge assessment

- **Date:** 2026-11-09 (Asia/Kolkata)
- **Result:** safe main-process adapter and blocker regressions only; no live launch callsite was added.
- **Acceptance gates:** SEC-04 and AG-07 remain open.

## Launch and ownership trace

The host route is `RuntimeAgentLaunchPreparation.resolveAgentTerminalCreateOptions` through `resolveAgentTerminalCreateOptions` in `runtime-agent-terminal-startup.ts`, then `createTerminal` in `terminal-create.ts`. The latter plans the command and dispatches it through `spawnInAdmittedPane`. `TerminalCreateOptions` is shared with other boundaries, so it was not expanded with an overlay option.

The launch evidence does not support attaching the overlay safely yet:

1. A fresh Claude launch does not have a provider session UUID before its first process starts. The durable session receipt is created for an existing UUID, while the hook reports fresh session identity after startup.
2. Saved Claude resume metadata carries a provider `session_id`, but the overlay receipt contains only the UUID and content digest. The current account environment carries config paths, not a durable selected-account ID bound to the saved provider session or receipt.
3. `createTerminal` attempts stable-pane adoption before `spawnFresh`. An adopted live pane has no new argv to change, so a prepared `--settings` argument cannot be applied to it.

The existing overlay owner is Ash `userData`; it does not participate in tab or PTY cleanup. The adapter adds no cleanup behavior and does not touch provider settings, project settings, credentials, or arbitrary scripts.

## Adapter boundary

`ash-claude-session-overlay-launch.ts` is a main-only, currently unreferenced helper. No RPC, preload, renderer, shared create option, or production launch caller opts into it. Missing host intent returns `disabled` without reading the receipt or writing files.

For explicit intent it recovers and verifies the existing Ash receipt for each process command, then uses the shared POSIX argv builder. It requires a UUIDv4, the exact provider UUID for resume, a selected account ID and config path matching the effective Claude environment, no inherited or caller account/auth overrides, a local Linux/macOS POSIX host, a bare `claude` executable, one exact `--resume` or `--session-id` selector, and no pre-existing `--settings` or unsupported shell syntax. It refuses live reattach, Windows, remote execution, custom shell overrides, unknown account state, and unsupported command arguments.

The adapter remains dormant because the host has no trusted source for both a pre-launch provider UUID on fresh launch and a selected-account binding for the durable receipt. Wiring it now would turn uncertainty into a guess and could attach one account's overlay to another account's provider session.

## Regression evidence

The adapter tests cover disabled-by-default behavior, explicit fresh and resume argv, one verified `--settings` pair per prepared process, and fail-closed checks for provider UUID mismatch, duplicate settings flags, live reattach, remote/WSL/Windows/shell boundaries, account mismatch, environment overrides, unsafe command syntax, and custom executables. A separate host runtime test creates a durable overlay, dispatches a saved-style Claude resume through the fake PTY controller, and proves the current process command receives no unverified `--settings`. It also checks that closing the GUI tab does not kill the daemon-owned PTY and that tab close or PTY exit leaves the Ash overlay and foreign provider settings bytes intact.

In addition, an opt-in native Linux E2E used the installed Claude Code 2.1.286 binary against a **loopback-only synthetic Messages API**, a fake key, isolated Ash/provider homes, and a **synthetic** host-selected account label. Both fresh `--session-id` and explicit `--resume` launches were prepared through this adapter. Each produced one verified `--settings` pair; both real CLI turns executed Ash and foreign `SessionStart`/`Stop` hooks, with two loopback messages and byte-identical foreign settings. The test's output command also round-tripped through the shared POSIX tokenizer. This verifies native transport only; no authenticated account or live Ash runtime attachment was exercised.

## Checks

- `pnpm run build:packages` — passed; prepared the existing workspace package link required by the Vitest runner.
- `CI=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run --config config/vitest.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism` with host adapter, settings receipt, AG-07 fallback, live-pane adoption, account-env snapshot and replay suites — **53 tests passed** after rebasing onto `0b9f5e92`.
- `ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/home/suraj/.local/bin/claude CI=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run --config config/vitest.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism src/main/agent-hooks/session/ash-claude-native-stop-resume.e2e.test.ts src/main/agent-hooks/session/ash-claude-native-overlay.e2e.test.ts` — **6/6 native CLI tests passed**; explicit opt-in, Linux-only, with the managed-policy fixture guard and isolated loopback fake provider.
- `pnpm exec oxlint --config config/oxlint-code-quality-native-plugins.json src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.ts src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.test.ts --deny-warnings` — passed.
- `pnpm exec oxlint --type-aware --config config/oxlint-code-quality-type-aware.json src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.ts src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.test.ts --deny-warnings` — passed.
- `pnpm run sync:anti-slop-plugin && pnpm exec oxlint --config config/oxlint-anti-slop.json src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.ts src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.test.ts --deny-warnings` — passed; generated `.anti-slop-plugin` output was removed after the scoped check.
- `pnpm run typecheck:node` — passed.
- `node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs` — passed on the rebased branch.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs` — passed.
- `node config/scripts/desktop-build/execution/run-electron-vite-build.mjs` — passed; reported unrelated existing chunk-size, dynamic-import and CSS optimizer warnings.
- `node_modules/.bin/oxlint` and `node_modules/.bin/oxfmt --check` on the adapter, adapter tests and changed native E2E — passed.
- `pnpm run verify:provenance` — passed; verified 33,506 upstream records, 210 Ash edits, and 8,260 documented removals.
- `pnpm run lint` — did not pass. The repository gate reported an existing anti-slop finding in `src/main/agent-hooks/session/ash-claude-native-stop-resume.e2e.test.ts:72`, 211 code-quality findings while its changed-file scan included generated `.anti-slop-plugin` output, stale test-runner inventory entries, and a stale import-boundary baseline for `src/main/window/desktop-integration/app-icon.ts`. The generated output was removed afterward; the focused lint configs above pass for these new files.

**Open:** attach a production caller only after fresh provider session identity and selected-account identity can be durably associated, and only on newly spawned local POSIX processes. Full SEC-04/AG-07 acceptance and provider-side lifecycle evidence are still required.
