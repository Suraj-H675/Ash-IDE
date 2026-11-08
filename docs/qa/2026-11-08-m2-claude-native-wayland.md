# M2: real Claude terminal and GUI-reopen evidence — Arch Wayland

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Ash source HEAD tested:** `454b1cb3ee3bf836212c61ae053e0e2887826a1c`
- **Environment:** Arch Linux kernel 7.2.11, Hyprland 0.57.0, native Wayland, Electron 43.8.6, Claude Code 2.1.286. Source Electron bundle, **not** an AppImage or installed release.
- **Acceptance:** RT-01/RT-10 lifecycle observations **PASS in this fixture**; RT-03 **PARTIAL**, not accepted end to end. AG-05 and real authenticated Claude turn/status remain untested.

## Safety and setup

- Launched Ash from the canonical development checkout with a fresh private test root under `/tmp/ash-claude-m2-e2e-20261108-<random>/`, a disposable **non-Git** workspace, isolated Ash `ASH_USER_DATA_PATH`, and separate XDG cache/config paths. The test root, Ash profile, Claude home and Claude config directories were mode `0700`; `ash-runtime.json` was mode `0600`.
- Registered **only** that test folder through Ash's authenticated local `repo.add({path, kind: 'folder'})` RPC. Ash's public local CLI intentionally does not expose the inherited `repo add` command.
- Launched the real Claude binary (`/home/<user>/.local/bin/claude`) through `ash-ide terminal create` with `HOME`, `CLAUDE_CONFIG_DIR`, and XDG paths explicitly bound to isolated directories. Disabled Claude auto-update and nonessential traffic in its test environment. `/proc/<claude-pid>/environ` confirmed the isolated home/config values, not the existing provider home.
- No credentials, provider configuration, sign-ins, browser profiles, hooks, repositories, or other application data were copied or intentionally modified. Selected existing Claude/Codex/Orca config paths had identical size/mtime metadata at the beginning and end of the run. The snapshot is a bounded check, not a global filesystem audit.

## Native process and session evidence

| Step | Direct observation | Result |
|---|---|---|
| Initial native GUI launch | One mapped `ash-ide` Hyprland window titled *Ash IDE*. Authenticated `status --json` reported a ready runtime. | PASS |
| Real Claude launch | Ash created one terminal. `pstree` showed login shell PID `2734478` with real Claude Code PID `2734532`. `terminal read --screen --json` showed **“Welcome to Claude Code v2.1.286”** and its genuine theme-selection UI, status `running`. | PASS — process/TUI, not an authenticated turn |
| Close the last GUI window | Hyprland Lua `hl.dsp.window.close({window=<exact Ash window>})` gracefully closed the only Ash window, after checking its class and PID. No Ash GUI windows remained. | PASS |
| No-window survival | Same Electron/runtime PID `2730954`, runtime identity `588ee5af-6474-4ab5-9793-38e326f79422`, terminal daemon PID `2731104`, Claude PID `2734532` and terminal handle `term_e23f1302-ddeb-4c32-9cc6-eefd2a51e2c6`. The CLI still listed the session and read the live screen. Runtime reported `graph_not_ready` without a GUI, but remained reachable. | PASS |
| Reopen using **generated Ash-owned CLI launcher** | `<isolated-profile>/cli/bin/ash-ide-dev open --json` returned success and reopened one window. Runtime returned to `ready`, retaining **all the same identities** and the same running terminal. | PASS |
| Live input after reopen | `terminal send --text <CSI ArrowDown>` was accepted and caused the rendered Claude theme-selection screen to change, without launching a second Claude process. | PASS |
| Scoped graceful shutdown | `terminal-daemon stop` previewed exactly **one** session with the expected shell PID. `terminal-daemon stop --yes --json` reported `status=stopped`, `killedCount=1`, `mode=graceful`. The test Claude, shell and daemon exited. `runtime stop --yes` then stopped the test app; the CLI later reported `not_running`. | PASS |

The test recorded JSON status, terminal-create/list/read, daemon status, reopen and stop responses in the private fixture root. Its contents were **not committed**; the table gives the sanitized, reproducible observations. The two older disposable-test daemons already present on the host (outside this new profile) were not modified or stopped.

## Test-harness distinction

The raw development invocation `node out/cli/index.js open --json` initially returned `runtime_open_failed` after GUI closure because it **does not supply `ASH_APP_EXECUTABLE`**. Ash's generated `ash-ide-dev` launcher supplies the executable and app-root information; the same reopen succeeded through that supported launcher. This is **not** evidence of a failure of the actual installed CLI reopen path.

## Findings and remaining acceptance work

1. **RT-03 remains PARTIAL.** The isolated Claude profile was unauthenticated and showed first-run onboarding. No model request, provider conversation turn, live usage/status API, authenticated account switch, or subsequent account-identity stability was exercised. Do not convert this process-survival proof into a full Claude-agent acceptance claim.
2. On first desktop startup, the renderer attempted IPC calls for `skills:bundledPlan`, `mobile:listDevices` and `wslMove:listPendingRendererRewrites`; Electron logged **“No handler registered”**. The GUI and runtime nevertheless started. These dormant renderer consumers need vertical removal under the excluded-feature cleanup milestone; this test did **not** repair them.
3. Native Wayland source-app behavior was tested; actual AppImage/X11, packaged CLI installation, multi-window independent presentations, real Claude account binding and provider history/recovery require separate evidence.

**Next safe M2 gate:** run a bounded, explicitly authorized authenticated Claude turn and account-binding test using an approved provider-native account without copying credentials or altering the user's existing provider configuration. Check exact process/session identity and account stability through the same GUI lifecycle. Until that is observed, keep M2 overall unaccepted.
