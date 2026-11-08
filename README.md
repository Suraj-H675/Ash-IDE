# Ash IDE

Ash is a local desktop workspace for running coding agents in real project folders. Its first implementation reuses licensed Orca 1.4.214 Electron, terminal, and CLI source, with Ash-owned profile paths and a persistent local terminal host. This is a working foundation, not a claim of full desktop parity.

## Current slice

- `ash-ide` exposes local app status, terminal session control, and guarded terminal-host stop commands.
- The terminal host uses the existing authenticated local IPC and PTY implementation. Ash selects a persistent host lifetime so closing the GUI does not request idle shutdown.
- New Ash profiles default agent permissions to full access. Codex uses `--dangerously-bypass-approvals-and-sandbox`; this is Yolo behavior, not an operating-system sandbox.
- Ash stores its packaged profile under `ash-ide`, its development profile under `ash-ide-dev`, and runtime discovery in `ash-runtime.json`. Set `ASH_USER_DATA_PATH` or `ASH_DEV_USER_DATA_PATH` to use a disposable profile.
- Automatic provider hook reconciliation, the general plugin catalog, and scheduled automation dispatch do not start in this slice. Ash reads Codex account-home services without writing provider configuration. Terminal launches inherit the user's existing provider home and authentication; Ash does not install hooks during startup or launch preparation.
- An explicitly caller-pinned `CLAUDE_CONFIG_DIR` or `CODEX_HOME` takes precedence over desktop account selection at terminal creation, including when the host has no selected account. Each prepared launch receives its own environment snapshot; changing a selection must not change an already running process. Fixture tests cover this boundary, not an authenticated provider account switch.
- A failed Codex account-selection runtime-home sync restores the prior selected account and attempts to rebind its previous home, rather than leaving the new selection persisted while the old home is active. The original failure is surfaced and restoration errors are logged; this is a failure-injection regression, not a live authenticated account-switch test.
- Ordinary Claude and Codex terminal agents remain available. Upstream Claude Agent Teams **native-pane** mode is unavailable until Ash has its own launcher and tmux adapter: it cannot detect, invoke, or borrow Orca's CLI or write Orca's shim directory. An unsupported saved mode is rejected with a diagnostic; Claude's provider-native `in-process` teammates remain separate and supported.
- Disabling Ash status hooks or an Ash agent must not uninstall provider-global hook entries shared with Orca or another application. Existing entries remain untouched, while the disabled Ash monitoring reports `skipped` rather than falsely claiming active status. Explicit provider configuration management and fully Ash-owned hook registration are not yet release-accepted.
- Until Ash has a verified ownership ledger **integrated with guarded provider-file writes**, its startup, account profile setup, and settings changes **do not install or refresh provider-global hooks or Claude agent-view bindings**. Enabling hook monitoring reports `ash_ownership_unavailable` with observed physical hook presence. A private, fail-closed Claude/POSIX hook **ledger foundation** now supports staged claims, exact-entry removal plans and crash-recovery plans in disposable fixtures; it is intentionally not connected to real provider-file writes. Terminals remain available while hook-backed status is degraded.
- The experimental POSIX Claude provider-file transaction layer now pairs durable Ash-private receipts with no-overwrite settings publication and fail-closed interrupted-write recovery, tested solely on disposable settings.json files. It is **not connected** to startup, settings or provider homes; stale locks and ambiguous external writes still require explicit inspection, and the provider-global hook-write gate remains closed.
- A separate experimental **journaled removal** layer now removes only an unchanged Ash-owned Claude hook, with a durable removal receipt, ownership-hash verification, and recovery across interrupted provider writes and ledger updates. Disposable fixtures include foreign edits and a real `SIGKILL` of a scoped fixture writer. It remains disconnected from production provider configuration and does not establish lossless interoperation with an uncooperative simultaneous writer.
- The experimental **per-session Claude settings overlay** creates private, no-overwrite settings and a durable checksum receipt under Ash userData, leaving all global provider/workspace settings untouched. Native Claude Code 2.1.286 executed both existing provider hooks and Ash `SessionStart`/`Stop` hooks through isolated synthetic turns, including explicit `--settings` reattachment on resume; recovery rejects missing or changed receipts. This remains disconnected from production agent launch/hook monitoring; authenticated status, managed policy, real runtime recovery and safe retirement still require verification.
- A separate opt-in, **real Claude Code** native test now exercises `SessionStart` hooks through the isolated `--settings` overlay and another disposable profile's existing settings. Both callbacks execute and the foreign settings bytes remain unchanged; a no-overlay control fires only the foreign hook. This runs with a synthetic API key and loopback-only model endpoint, not a real account or completed model turn. The test is not required on GitHub CI runners that lack Claude; hook status, other events and production activation remain unverified.
- The Windows NSIS configuration now uses Ash-owned document-association IDs and removes only its own CLI PATH entry on uninstall; it does not run inherited Orca uninstall preflights, delete Orca daemon data, or remove provider hooks on normal quit. These are static packaging assertions; an actual Windows installer/uninstaller run beside Orca remains a release gate.

Ash's authenticated runtime RPC and CLI omit mobile, remote SSH management, cloud, scheduled automation, general app plugin and skill marketplace, speech, Jira, Linear, and telemetry methods. Main runtime startup disables WebSocket exposure. It does not start the mobile relay, scheduled automation service, general plugin service, or telemetry IPC service.

The Electron main process now registers only empty, read-only environment-catalog queries required by retained local views. Remote pairing, SSH-host and WSL-host IPC registration is disabled. Legacy remote preload surfaces and their renderer consumers, telemetry consent UI and dormant upstream modules remain in the source tree and require vertical removal before release.

Updater code is also retained, but Ash does not start an updater service in this slice. Release-feed configuration points at the Ash GitHub repository. The inherited changelog and nudge helpers still use `onorca.dev`, so do not enable updater content until those endpoints are removed or replaced.

## Development

Use Node 24 and pnpm 12. Install and build packages with:

```sh
pnpm install --frozen-lockfile
node config/scripts/workspace-package-build/build-workspace-packages.mjs
```

Build the CLI and Electron bundles with:

```sh
ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs
node config/scripts/desktop-build/execution/run-electron-vite-build.mjs
```

Before the first Git commit only, `ASH_ALLOW_UNCOMMITTED_BUILD=1` permits a bootstrap smoke build with a zero revision placeholder. Normal builds require a real Git HEAD. A successful bundle build alone does not prove a release-ready desktop package.

## Verification status

The first public foundation commit has passed GitHub Actions source-provenance, workspace-package, TypeScript, runtime-test, CLI-build and Electron-build checks. Subsequent provider-boundary work is independently tested before integration. Packaged AppImage/Windows/macOS release validation, complete excluded-feature removal, real Claude close/reopen testing, and independent multi-window behavior are not yet accepted.

Independent native runs on Arch Linux/Wayland verified an Ash Electron window, authenticated CLI access, a real PTY, and a live Main-route Codex CLI session in a disposable non-Git fixture. They observed the same host, daemon, PTY, and Codex process IDs after closing every GUI window and reopening Ash, and observed the idle host persist. The runs also checked loopback-only listeners and unchanged global Codex configuration. This is milestone evidence, not packaged release validation.

A separate native stop check first previewed two live disposable terminal sessions without changing them, then used `terminal-daemon stop --yes` and observed both terminal process trees exit while the local Electron runtime remained alive. Code-level CLI and RPC tests also cover this path. Runtime stop and terminal-daemon stop are distinct commands; the latter requires `--yes` and rechecks daemon incarnation and live-session identity before shutdown.

## Source license and provenance

Ash includes source from [stablyai/orca](https://github.com/stablyai/orca), commit `55697aec91390357540103f49991458f756b41cc`, version 1.4.214. The source is licensed under the MIT License, Copyright 2026 Lovecast Inc. See [LICENSE](LICENSE) and the per-file source hash ledger at [docs/provenance/orca-1.4.214.jsonl](docs/provenance/orca-1.4.214.jsonl).
