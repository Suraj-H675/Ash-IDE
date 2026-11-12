# M8 — First real Ash IDE Linux AppImage and packaged X11 PTY lifecycle

**Date:** 2026-11-12 (Asia/Kolkata)

**Source:** `main` at `524a8d06845014848a1e6edcda0e8be71ab0c248` (clean and equal to `origin/main` before the local QA/ignore-file change)

**Previous Foundation CI:** [run 43066075234](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43066075234), **success** for the same commit.

**Upstream provenance:** pinned Orca `55697aec91390357540103f49991458f756b41cc`, independent Ash Git history, original MIT license preserved.

## Actual native build and package

The user enabled an existing Docker 29.9.2 service on Arch Linux x86-64. `docker info` confirmed its accessibility from DevSpace. The missing native Wayland clipboard helper was then built using the **unchanged** `pnpm run build:native` pipeline and its Ubuntu 20.04 Dockerfile. All **12 protocol** and **2 X11** helper tests passed. Its native ELF passed the supported **glibc 2.31 / GLIBCXX_3.4.28** compatibility gate. No unverified host-compiled replacement or native check bypass was used.

`pnpm run ensure:electron-runtime` passed. The actual, unmodified builder command then succeeded:

```sh
pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64
```

**Result:** `dist/ash-ide-linux.AppImage`, **228,050,149 bytes**, executable x86-64 static-pie ELF, artifact build exit **0**. SHA-256:

```text
81333ccd40b1f80e19c44fc1d7157a1924c4b2ae46335fa7da61b9406667cc4e
```

Builder `afterPack` evidence: **15** packaged native binaries passed the Ubuntu 20.04 glibc-floor verifier; the packaged daemon entry booted under plain Node; the bundled Node **served a PTY**; and **two** bundled plugin resource inventories passed. Electron-builder assembled the AppImage and its embedded block map. The final AppImage static-artifact validator did not reject it. No installer was run and **nothing was published as a GitHub release**.

## Live AppImage/X11 evidence — actual executable

Used `xvfb-run -a -s '-screen 0 1366x768x24'` with the **actual AppImage** (FUSE available, no `--no-sandbox`), a new isolated `HOME`, XDG runtime/config/cache/data directories and `ASH_USER_DATA_PATH`. Only a disposable **non-Git** folder inside that fixture was registered through authenticated local `repo.add` RPC. The CLI queries used the `node-runtime` binary and `app.asar.unpacked/out/cli/index.js` from electron-builder's **unpacked packaged output**, not the checkout's source CLI or an installed global CLI. They connected to the live AppImage process; **this is not yet proof that the command launcher inside the mounted AppImage was exercised directly**.

The initial X11 AppImage launch passed with ready/reachable local runtime, `ash-runtime.json` mode `0600`, live independent daemon, and successful terminal inventory. X11 screenshot capture at 1366×768 contained 916 distinct colors; it is not visual-parity acceptance.

In a second run, X11 window introspection found one mapped `ash-ide` window. The script registered the disposable folder, ran **`terminal create`** with an idle command (`printf` and `sleep`), confirmed a live terminal handle via `terminal list`, sent the window's **`WM_DELETE_WINDOW`** protocol event and then issued `ash-ide open --json` to reopen the UI through the AppImage executable override. No other application's X11 windows were targeted; the entire display was an isolated Xvfb server.

| Observable checkpoint | Runtime PID | Runtime ID | Terminal handle/count |
| --- | --- | --- | --- |
| Initial GUI | `1008907` | `61d9fa4e-d6eb-4220-b2fb-859e531f8138` | `term_463b5430-7e63-4c3d-a0ec-9bf22b3a3225` / 1 |
| After closing GUI | `1008907` | **unchanged**, CLI reachable with `graph_not_ready`; window `openable` | **Same handle / 1** |
| After CLI reopen | `1008907` | **unchanged**, CLI reachable; window `available` | **Same handle / 1** |

The original X11 window ID was `2097155`; the reopened visible window was `2097182`, both class `ash-ide`. The test then called `terminal-daemon stop --yes --json`, which reported **`status: stopped`, `killedCount: 1`**, followed by `runtime stop --yes --json`, which returned **`status: stopping`**. No test-owned GUI/daemon process remained after the run. This is strong **packaged X11 persistent-local-runtime, real PTY session and GUI-reopen evidence**. It is not yet a test of interactive terminal output reads, authenticated Codex/Claude turns, native Wayland, or visual parity.

The reopened window was immediately reported `available` but its graph was still `graph_not_ready` at the checkpoint. There was no later readiness check. Do **not** interpret that observation as either a confirmed permanent regression or a ready graph.

## Environment incident, data preservation, and cleanup

An intervening test tried to create the same private fixture under `/tmp` and failed with **Linux `EDQUOT` (errno 122)** on SQLite/profile writes. The `/tmp` filesystem was a limited tmpfs. The two test-only roots created in this turn were removed **after confirming their processes had stopped**, releasing approximately 824 MB of our own temporary output. No other temporary files were touched. The successful lifecycle retry used a new `0700` directory under the repository's gitignored, **disk-backed `.cache/`**, with a private `TMPDIR`, `HOME`, XDG directories and a minimal inherited environment. No existing Ash/Orca/provider profile, credentials, project source folder, Git working tree, or provider account was modified for the smoke.

Docker retains the reusable native build image and the repository retains the locally built native helper. `.gitignore` now excludes the helper's `.build/` directory so neither its 28 KB ELF nor its fingerprint can be accidentally committed. `dist/` was already ignored.

## Explicit unresolved findings (NOT release accepted)

1. **PK-02 native Wayland AppImage execution remains untested**, and PK-03 full desktop X11 environment coverage is still incomplete: this was real X11 under Xvfb, not a human-operated X11 login session. No package was installed, and clipboard, notifications, browsers, settings workflows, multiple windows, rollback, updater, and visual parity were not accepted.
2. During reopen, the renderer logged an IPC request for `codexAccounts:listRecordedPaneLanes` without a registered handler. Source inspection found `src/main/ipc/codex-accounts.ts` defines `registerCodexAccountHandlers`, but no active production caller registers it. This is a real provider-native account UX gap requiring a separate audited fix, not a reason to restore vendor cloud account infrastructure blindly.
3. The current `dist/linux-unpacked/resources/node_modules` contains `@linear/sdk` and `@posthog/core`/`@posthog/types` files (~3.2 MB and ~2.9 MB). Their **presence does not prove runtime telemetry**, but also means full removal of excluded app-level integration/telemetry assets is **not yet verified**. Trace actual runtime dependency closure before pruning. The package remains an **acceptance candidate, not a release candidate**.
4. Electron-builder warned that `desktopName`/`syncDesktopName` was not set for Linux window association. The observed X11 window had class `ash-ide` and reopened, but desktop-launcher association under a real session remains unverified.
5. The test shell's summary-print helper had a Python syntax error **after** the independent CLI commands and X11 actions completed. The actual saved JSON outputs were parsed separately afterward, and all preserved PID/runtime/terminal identities and stop responses above are taken from those JSON files. The shell's exit code alone is **not** the success criterion.

**Milestone disposition:** native-helper build and x64 AppImage creation **verified**; X11 packaged local-runtime/PTY lifecycle **verified in an isolated fixture**; full M8 Linux release acceptance **not yet achieved**. No GitHub release or user-facing binary deployment was performed.
