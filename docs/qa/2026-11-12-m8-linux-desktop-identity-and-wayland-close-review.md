# M8 — Linux desktop identity verified and native Wayland close/reopen review

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** `main` at `0bb6c67731985303c6c19325ef8457871c9ae1a5` (clean and equal to `origin/main` before this work). **Previous Foundation CI:** [run 43159751205](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43159751205), completed **success** before this milestone.

**Source provenance:** pinned Orca commit `55697aec91390357540103f49991458f756b41cc`, separate read-only reference, independent Ash history and unchanged MIT license attribution.

## Desktop identity defect and correction

Every previous Linux AppImage build warned that Electron lacked a `desktopName`, which can prevent Wayland/X11 window-to-launcher association. The existing Ash application identity is **`com.ashide.desktop`**, and the product specification forbids inheriting Orca's application identity or modifying users' unrelated profiles.

The package root now declares `desktopName: "com.ashide.desktop.desktop"`: electron-builder removes the final `.desktop` suffix to obtain the approved app ID `com.ashide.desktop`. The v26 Linux builder configuration explicitly enables `syncDesktopName: true` and uses `StartupWMClass: appId`. This avoids changing the established macOS/Windows bundle ID, CLI executable (`ash-ide`), user-data path, or published Git identity. The apparent duplicated `.desktop` in the installed filename is intentional: the application ID itself ends with the word `desktop`, and the second suffix is the file extension.

Added a regression in `electron-builder-config.test.mjs` asserting that package `desktopName`, builder `appId`, `syncDesktopName`, `StartupWMClass` and `executableName` agree. Exact packaging configuration and ASAR-hygiene tests: **2 suites / 24 of 24 passed** (nine configuration tests and fifteen ASAR/privacy tests). Changed-code quality reported **zero new findings**.

## Actual x64 AppImage and desktop file inspection

Rebuilt the actual Linux AppImage using the existing native-integrity pipeline, without bypassing any check:

```sh
pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64
```

**Build exit 0.** Existing quality checks all passed: `app.asar` contains **5,221** entries in reviewed runtime roots; **15 native binaries** meet the Ubuntu 20.04 glibc/libstdc++ floor; packaged plain-Node daemon boot; bundled Node serves a real PTY; and **two** packaged plugin resource inventories verify. The previously reported missing-`desktopName`/WM_CLASS builder warning did **not** recur. Existing module-type and dependency-tree warnings remain separately.

**Local ignored artifact:** `dist/ash-ide-linux.AppImage`, **224,555,772 bytes**, SHA-256:

```text
faa75d016e86a3284cec40fef5a7d5337b743edaf78eaf47d3651015aa2675ad
```

Extracted the actual AppImage under a *new, disk-backed, Git-ignored test directory*, without installing it. Inspected the embedded desktop entry and verified:

```ini
# com.ashide.desktop.desktop
Name=Ash IDE
Exec=AppRun %U
Type=Application
Icon=ash-ide
StartupWMClass=com.ashide.desktop
Categories=Utility;
```

The extraction completed successfully, and the **621 MB** unpacked fixture was removed afterward; no existing user profile, application installation, repository, global CLI or provider credentials were modified.

## Native Wayland window lifecycle: one positive observation, repeatability open

Separately performed a **private KWin 6.8.2 Wayland virtual-compositor** session (new HOME/XDG/DBus, no display access to the user's live session), launched the actual AppImage, created a test-owned PTY in a disposable non-Git folder, and issued a KWin script to request a graceful window close. Independent CLI JSON showed:

| Checkpoint | Runtime PID | Runtime ID | Window | Terminal |
| --- | --- | --- | --- | --- |
| Initial | `1110251` | `26b33778-c835-4e44-b6cc-81314765524c` | `available`; graph `ready` | `term_af138d36-5380-4378-a927-986c8eceeb1d` |
| After KWin close request | **unchanged** | **unchanged** | `openable`; `graph_not_ready`/`workspace-window-closed` | **same handle, one session** |
| After CLI reopen | **unchanged** | **unchanged** | `available`; graph `ready` | **same handle, one session** |

Electron's client-side protocol trace contained `get_xdg_surface` and `get_toplevel` requests, confirming native Wayland rather than Xwayland. The original first-pass assertion incorrectly required `runtime.state=ready` even with no GUI; it was repaired to accept the observed, accurate `graph_not_ready`/`workspace-window-closed` state while requiring authenticated CLI connectivity and unchanged PTY identity. The saved results then passed independent JSON/protocol assertions; only that test-owned daemon was explicitly stopped after the first failed assertion. The observed graceful-close/reopen sequence was successful and is valid **one-run evidence**.

An attempted durable automation of this KWin test **failed repeatability checks**: multiple subsequent isolated runs did not cause KWin to close the window, although CLI identity remained stable and the script cleaned up its disposable profile. A start-readiness race was repaired, but the KWin scripting/window-selection behavior remained unreliable. The **untracked test script was discarded and not committed** rather than weakening close/reopen assertions or falsely claiming a repeatable passing test. Thus repeatable native Wayland close/reopen **remains an open acceptance item**. Earlier tested native Wayland launch, runtime and PTY creation (separately recorded in `2026-11-12-m8-exclude-vendor-sdks-and-native-wayland-appimage.md`) are unaffected.

## Remaining release acceptance

Real installed Wayland desktop association and icon grouping, repeated independent-window behavior, clipboard/portal integration, visual parity, provider-native signed-in agent workflows, real account sign-in, full runtime network exclusion audit, updater/rollback and cross-platform package certification remain unverified. This is a **local QA artifact, not a public release**. Successor GitHub CI outcome must be reported only when actually observed.
