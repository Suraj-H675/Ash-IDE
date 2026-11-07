# Initial desktop implementation

## Product boundary

Ash is a local-first desktop app for one laptop. Projects open as ordinary folders, including non-Git folders. A terminal-first agent uses the user's existing provider CLI and auth. The default permission choice is full access, implemented by each provider's native CLI option; Ash does not add an operating-system sandbox.

Ash uses a private profile under `ash-ide` and a separate development profile under `ash-ide-dev`. The local host publishes `ash-runtime.json` and uses the existing authenticated local transport. Imported `ORCA_*` variables remain internal compatibility names; Ash ignores inherited Orca data-path overrides and sets its own profile path before startup.

Automatic provider-hook installation and reconciliation, telemetry, plugin catalog networking, and scheduled or manual automation runs are disabled. The first Codex launch path preserves provider configuration and hook files. Provider-native Codex CLI auth remains available to the terminal.

The imported renderer includes wider upstream surfaces that are not adapted or verified as Ash product features. This slice does not claim broad desktop parity.

## Runtime shape

The terminal daemon owns PTYs, session identities, durable transcript state, authenticated local IPC, and process lifetime. Electron and `ash-ide` are clients. Electron exposes runtime operations through the existing preload boundary; the CLI uses the existing RPC client. One authenticated daemon incarnation owns session mutation.

Daemon clientless policy is explicit: the upstream default remains `retire`, and Ash selects `persist`. An empty host stays available after the last UI client disconnects. Endpoint ownership loss and an unclaimed startup timeout still retire it. Explicit stop requires a confirmed CLI request and the current endpoint identity (`pid`, start time, and launch nonce); it is refused while live sessions exist.

## Decisions

- Reuse the licensed PTY host, renderer terminal, and authenticated RPC rather than maintaining a second terminal implementation.
- Keep terminal-host lifetime independent from the GUI process so CLI control and later reconnection can reach the same sessions.
- Use a local IPC endpoint instead of a public control listener.
- Keep all Ash profile and runtime files below Ash-only user-data paths.
- Defer general app plugins, marketplace, scheduled runs, telemetry, vendor cloud and relay services, remote hosts, and other excluded product areas.

## Verification status

The curated source compiles, the Electron bundle builds with a development-only zero revision placeholder, the Ash CLI builds, and the focused project tests pass. A direct `node-pty` smoke test created a real shell PTY. These checks do not establish M1 desktop behavior.

The managed sandbox prevents the remaining native checks. Chromium exits with `sandbox_host_linux.cc` `EPERM` under Xvfb, including a `--no-sandbox` harness launch. A direct Node Unix-domain socket bind also returns `EPERM`. Therefore the following remain unverified: RT-01 GUI close with the same PTY/PID, RT-09 idle-host persistence, RT-10 CLI/relaunch avoiding a second host, SEC-01 runtime listener behavior, and a live authenticated Codex launch with reconnection.
