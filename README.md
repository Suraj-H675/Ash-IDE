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
