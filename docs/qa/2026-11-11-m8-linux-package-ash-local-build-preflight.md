# M8 — Linux AppImage input isolation, Ash CLI preflight and isolated X11 source smoke

**Date:** 2026-11-11

**Base:** `main` at `ba739250956d9e6995e6baf1d4b9b2e212b1dd1e`

**Previous CI:** [Foundation run 43056064078](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43056064078) completed **success** before this work.

**Target host:** Arch Linux x86_64, kernel `7.2.11-arch1-1`, primary user session Wayland; isolated source-app probe used Xvfb/X11. Pinned Orca baseline remains `55697aec91390357540103f49991458f756b41cc` with independent Ash Git and unchanged MIT license attribution.

## Package and build-pipeline changes

The Linux packager's inherited Orca preflight rejected the Ash output because `out/mobile-web/manifest.json` did not exist. That mobile payload is explicitly excluded by the approved product. The packager also included remote SSH relay/host-deployment templates and native speech resources, which are not Ash product features.

- Removed the mobile-web preflight and `out/mobile-web/**` ASAR unpack rule. Explicitly exclude stale `out/mobile-web` from the app file set, even when present from an earlier build.
- Removed SSH relay and remote orcad-deployment-template resource mappings and their mandatory preflight/finalization. Retained `verifyPackagedDaemonEntryBoots`, bundled runtime dependency and local CLI tests, ripgrep, agent-browser catalog, sandbox preload and native Wayland clipboard requirement.
- Removed native speech model package mappings on Linux, macOS and Windows. This is a resource/packaging exclusion; the full general-plugin and speech source-removal audit is **not** claimed complete.
- Removed mobile-web, WSL remote-guest and remote served-web generation from the automatic desktop/release asset pipeline. Standalone legacy scripts still exist as separate source-cleanup candidates; they no longer run as desktop package prerequisites.
- Added `build:cli:assets`, a CLI compilation path that **does not** invoke `prepare:cli-output` or install/overwrite the user's developer CLI. Desktop and release scripts use it. `build:linux` now requires the native helper build before packaging.
- Corrected the static AppImage verifier to accept only `ash-ide-linux.AppImage` and `ash-ide-linux-arm64.AppImage`, with architecture checks and original ELF/static-runtime security checks retained. Upstream `orca-linux.AppImage` names are explicitly refused.
- Updated the existing packaged CLI verifier to check the actual Ash CLI (`--help`, `agent-context --json`, `status --json`) with a temporary `HOME`/XDG/profile per invocation. Its runtime import-closure verification remains enabled. Retired Orca `skills list/get/install/update` commands were not re-enabled to satisfy a packaging smoke test.
- Updated the package config regression tests and included the package tests plus the standalone Ash CLI verification after the CLI/Electron builds in the Foundation CI workflow.

## Local verification observed

- Package config/identity tests, including x64/arm64 artifact names and rejection of old Orca artifact names: **7/7 passed**.
- `pnpm run build:desktop`: **passed** end-to-end, including TypeScript, CLI asset compilation, Electron bundle, sandbox preload, and standalone CLI checks; **255** renderer chunks / **7,836.0 KB** minified. Existing large-chunk and ineffective-dynamic-import warnings remain.
- `pnpm run verify:built-skills-cli`: **passed**, scanning **1,244** CLI runtime dependency-closure files and executing **three** real Ash commands under disposable profile roots.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings.
- Formatting: **passed** for modified JS/CJS/JSON.
- Pinned source verifier: **passed**, **33,506** upstream records, **401** Ash adaptations, **8,477** documented upstream exclusions, unchanged MIT SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Explicit native packaging blocker

`pnpm run build:native` was attempted and **failed** when its required Docker-built Wayland clipboard helper could not connect to `unix:///var/run/docker.sock`: the Docker daemon socket was absent. `native/wayland-clipboard/.build/x64/orca-wayland-clipboard` remains missing. The source's Docker-based native build enforces the supported glibc floor; no unverified host-compiled binary, placeholder, or bypass of `ensureBundledWaylandClipboard` was substituted.

**No AppImage, .deb or .rpm was built, launched, or accepted.** The next release attempt requires a supported running Docker daemon or a separately verified equivalent native toolchain and then a real `electron-builder` AppImage pass, resource inventory, and packaged GUI/CLI/PTY smoke. The already discovered package configuration issues are resolved at source level, not proven in an actual artifact.

## Bounded X11 **source** GUI probe (not packaged)

The built Electron source application was launched twice under Xvfb (`1366x768x24`, X11 backend), using a brand-new temporary `HOME`, XDG configuration/cache/runtime directories and `ASH_USER_DATA_PATH`/`ASH_DEV_USER_DATA_PATH`. It never used an existing Ash/Orca/provider account profile. The launch emitted native skills discovery logs and the second run's X11 tree included window `0x400001` with title `electron` plus a Chromium clipboard window. Screenshots exist only in the **developer machine's temporary directory**, not a Git artifact:

- `/tmp/ash-m8-x11-source.oVxArd/profile-x11.png`
- `/tmp/ash-m8-x11-source.oVxArd/profile-reopen.png`

Both captures are `1366x768`; the screenshot inventory found 421 distinct colors. This is evidence of a source Electron launch/window and recorded pixels, **not** proof of correct rendered UI, visual parity, terminal interactivity or browser behavior. The real display compositor/Wayland session was not tested. The app was launched without `--no-sandbox`, but this does not verify packaged Chromium sandbox behavior.

After the first window closed, a **test-owned** daemon process remained attached to the disposable profile, consistent with the persistence design. However, `ash-ide terminal-daemon status --json` targeting that profile returned `runtime_unavailable` because `ash-runtime.json` was absent. Thus full runtime reconnect and session continuity are **not** accepted from this smoke. Only the two test-owned processes whose command lines contained this profile's exact path (its crash reporter and daemon) were explicitly stopped; unrelated running Ash processes were not touched.

## Remaining acceptance gates

Docker/native packaging prerequisite; complete verified AppImage inventory; Wayland and X11 **packaged** app execution; desktop GUI functional journeys; local runtime/CLI reconnect and real PTY/provider agent continuity; clipboard, notifications, Git/browser/editor workflows; full mobile/remote/plugin/speech/telemetry asset exclusion audit; and update/rollback safety. Git push and successor CI results must be independently observed before claiming integration.
