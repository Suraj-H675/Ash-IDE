# M8 — Exclude app-level vendor SDKs from packages; real native Wayland AppImage smoke

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** `main` at `b0e8c2966e1457a4f7e88293ba46213561434406`, clean and matching `origin/main` before this change.

**Prior GitHub CI:** [Foundation run 43157541495](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43157541495), **success**, exact base SHA.

**Source reuse:** pinned Orca `55697aec91390357540103f49991458f756b41cc`; preserve MIT notices and independent Ash repository identity. This change affects package selection/verification, not upstream source checkout.

## Dependency reachability audit

The preceding real packaged Linux build had four prohibited app-level dependencies under `dist/linux-unpacked/resources/node_modules`: `@linear/sdk`, `posthog-node`, and the latter's `@posthog/core` and `@posthog/types` dependencies. Inspection showed that `config/packaged-runtime-node-modules.cjs` unconditionally included `@linear/sdk` and `posthog-node` as **packaging dependency roots**. It traversed their dependency closure, copying their transitive packages even though Ash's connector functionality was excluded.

- The existing main-process `registerLinearHandlers` and `registerJiraHandlers` functions have **no production registrations** in the startup or core IPC handler entry points. Ash's actual `ASH_COMMAND_SPECS` allowlists `open`, `status`, `agent-context`, `terminal`, `terminal-daemon`, and `runtime`; `ash-ide linear` returned `Unknown command` in the audited CLI. The source `COMMAND_SPECS` still includes legacy Linear/Jira specs for upstream compatibility, not enabled as Ash commands.
- The compiled `out/main/index.js` contains an inherited **lazy** `@linear/sdk` loading expression in the retained (orphan) Linear source graph. Source `src/main/telemetry/client.ts` still has PostHog scaffolding but `const TELEMETRY_ENABLED = false`; packaged main/CLI runtime paths showed no direct compiled `posthog-node` load. **Neither code absence nor a complete runtime network audit is claimed by this milestone.** Separately verify every leftover source callsite before deleting or relying on it.

Change: removed **only** the two excluded package roots `@linear/sdk` and `posthog-node` from the platform-shared packaging closure. Existing permitted packages (including `node-pty`, `@orca/process-host`, and `@anthropic-ai/claude-agent-sdk`) remain. The Linux closure decreased from **74 to 69** copied packages. Inspected Linux and macOS closure definitions independently; a Windows cross-target closure build was unavailable on the Linux host because `@vscode/windows-process-tree` was not installed. Windows/macOS native packaged execution remains untested.

Added a **fail-closed post-pack exclusion gate** to `verify-ash-packaged-asar-hygiene.cjs`, rejecting any of those four vendor packages if found inside `app.asar`, `app.asar.unpacked/node_modules`, or packaged `resources/node_modules`. Added negative tests for each package in `resources/node_modules`, a real archive containing PostHog, and package dependency closure tests retaining essential runtime modules. This gate runs during `electron-builder`'s existing `afterPack` verification, not just as a source-level assertion.

## Actual packaged Linux artifact

Executed the existing, supported build with no glibc/ASAR/sandbox/native-binary bypass:

```sh
pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64
```

**Result:** build exit **0**; `dist/ash-ide-linux.AppImage`, **224,555,824 bytes** (about 214 MiB), static-pie x86-64 ELF; SHA-256:

```text
03389ce81290e7fec9bd0a8d205d0c7c2dd9aacc7bbed46890f83ea6c64641de
```

`[ash-package-hygiene] OK — 5221 archive entries in reviewed roots`; **15** native binaries met the Ubuntu 20.04 glibc-floor contract; the plain-Node packaged daemon boot passed, bundled Node served a PTY, and **two** bundled plugin inventories verified. Direct post-build inspection found all four SDKs **absent** from the packaged `resources/node_modules`; the `app.asar` private-root guard also passed. Existing Linux desktop `desktopName` / WM_CLASS packaging warning remains.

## Actual native Wayland AppImage with fully isolated compositor

This test did **not** use the user's active Wayland desktop or real Ash profile. A separate process session started `kwin_wayland --virtual --no-lockscreen --no-global-shortcuts --no-kactivities` on socket `ash-virt` with an isolated, private **KWin compositor**, XDG runtime directory, home/config/cache/data roots, DBus session, and disposable non-Git workspace under the Git-ignored, disk-backed `.cache/wl.*` directory. The test harness removed inherited `DISPLAY` and `WAYLAND_DISPLAY`; the Electron client was explicitly launched with `WAYLAND_DISPLAY=ash-virt`, `QT_QPA_PLATFORM=wayland`, `XDG_SESSION_TYPE=wayland`, and `--ozone-platform=wayland`. No `--no-sandbox` or other security relaxation was used.

- `wayland-info` connected successfully to the isolated compositor and reported `wl_compositor` (v6), `wl_shm` (v2), and `xdg_wm_base` (v6).
- Real AppImage PID: **1084061**. Electron's **client-side Wayland protocol trace** contained an actual `get_xdg_surface` and `get_toplevel` request (one and two line matches respectively), providing direct native Wayland window/surface creation evidence. It was not an X11/Xwayland client.
- The AppImage published authenticated `ash-runtime.json` with **0600** mode. The bundled Node/CLI from the packaged `linux-unpacked` resources reported `runtime.state=ready`, `reachable=true`, and window `available` for runtime `ed875e99-757a-47a5-945b-1d245a53b0cf`.
- `terminal-daemon status --json` reported **live**. The authenticated local RPC registered only a disposable folder. The packaged CLI created a real PTY process **1084713**, terminal handle `term_2dad9f70-45fe-4ed4-ad96-38c825afc2fd`; `terminal list --json` returned the **same handle** and one session.
- `terminal-daemon stop --yes --json` succeeded with `status=stopped` and `killedCount=1`; `runtime stop --yes --json` reported `status=stopping`. The isolated KWin and AppImage processes were stopped and no test-profile process remained.

The inline Python summary embedded in the shell harness contained a **shell-quoting syntax error after successful CLI operations**. This did not interrupt commands, but its exit code alone cannot validate their responses. The saved original CLI JSON results were parsed independently with a corrected script; all seven responses were `ok=true`, handle identity matched, and the protocol trace and `xdg_wm_base` assertions passed. Virtual KWin emitted expected desktop-portal/DBus warnings because it was not a full user login session. There was **no screenshot/visual-parity, clipboard portal, real Wayland close/reopen, second window, or provider-agent turn test**.

## Local gates and outstanding acceptance

- Packaging config/matcher and archive/SDK exclusion: **2 Vitest suites / 23 of 23 passing** (8 configuration + 15 archive/closure tests).
- Changed-code quality: **passed**, zero new findings.
- `pnpm run typecheck`: **passed** (retained workspace package build and TypeScript projects).
- Source provenance verifier: **passed**, 33,506 upstream records, **405** Ash adaptations and 8,477 documented exclusions; original MIT license SHA-256 unchanged (`ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`).
- AppImage `electron-builder` build and all packaged glibc/daemon/PTY/plugin checks: **passed**.
- Native virtual Wayland process, authenticated local runtime/CLI, live PTY and explicit stop: **passed**, independently parsed from emitted JSON and Wayland protocol trace.
- The previous commit has verified CI; successor CI must be observed separately before any claim of GitHub CI success for this change.

**Remaining:** Retire the orphan Linear/Jira app source, PostHog transport and old bundled CLI specs vertically, preserving legitimate Git-provider integration and provider-native tools. This milestone **does not** prove the resulting build has no network telemetry or that no dormant source references excluded SDKs. Native Wayland window lifecycle, visual parity, clipboard, real provider sign-in/agent turns, package installation, independent windows, updater/rollback and cross-platform releases remain acceptance gates. The binary is a **local QA artifact, not a published release**. No existing provider account, user repo, or saved application profile was touched.
