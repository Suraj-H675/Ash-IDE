# M8 / PK-03 — native X11 packaged AppImage GUI and persistent PTY lifecycle

**Date:** 2026-11-14 (Asia/Kolkata). **Base:** clean `main` at `bc4054c41774c37f85d96814e5b5bee33215f850`, GitHub Actions run `43556788096` completed successfully. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `test/m8-packaged-native-x11-lifecycle`. **Pinned Orca:** `55697aec91390357540103f49991458f756b41cc` (original MIT license retained).

## Runtime and test boundary

- Extended the existing **real AppImage** desktop lifecycle fixture with a native-X11-only mode invoked through `verify-linux-appimage-x11-lifecycle.sh`. The default Wayland entry point and existing network-audit route remain intact. This changes only QA scripts and test helpers, **not** Ash application source, provider settings, IPC, persistence, or release package configuration.
- On the actual Arch Linux QA host (`xorg-server-xvfb 21.1.25-2`, `libx11 1.8.14-1`), started a randomly assigned **native Xvfb** display (`1280x800x24`) with a separate MIT-MAGIC-COOKIE/XAUTHORITY under a mode-0700 disposable fixture. The X11 server disables TCP listening. `DISPLAY` is assigned only to the test; inherited `WAYLAND_DISPLAY`, `DISPLAY`, `XAUTHORITY`, `HOME`, XDG paths, provider homes, and remote pairing environment are excluded. This is **not XWayland inside the user's Wayland compositor**.
- A new locally compiled Xlib helper, `ash-x11-window-control.c`, verifies exactly one **mapped** Ash top-level window with `WM_CLASS=com.ashide.desktop`, `_NET_WM_PID` matching the live app PID, and geometry at least 500×300. It checks `WM_DELETE_WINDOW` support and sends the normal X11 client close event, **not** a force kill. It refuses a deliberately wrong-PID close request. The reopened top-level must again match the same PID and Ash class.
- The existing private packaged `ash-ide` CLI then checks real authenticated runtime and Settings reads, registers a new **test-owned folder**, starts one `sleep 120` command through the actual native terminal/PTY, closes the last GUI window, verifies the same runtime and single live PTY remain, reopens the GUI, verifies reattachment, and explicitly stops the test-owned daemon/runtime. It does not launch an account-authenticated agent or touch a real user repository.
- Optional `ASH_TEST_CAPTURE_X11_SCREENSHOT=1` captures the **private Xvfb root screen** (never the user's desktop) before close and after reopen. It asserts 1280×800 pixels and more than 40 distinct colors; screenshots remain private. Image pixels alone do not constitute a visual parity verdict.

## Reproducible observed evidence

- **Artifact under test:** existing matched build `dist/ash-ide-linux.AppImage`, **224,358,840 bytes**, SHA-256 `a7b0e3b6854a53f9a66f85735ce4b60da9a8cf8c808bbb4c281f5c7edd5c50a1`. Its code was packaged at earlier M8 SHA `02377026`; succeeding commits before this change altered QA harnesses only, so this is **not** a claim of a newly rebuilt installer for the present SHA.
- `cc -std=c11 -Wall -Wextra -Werror -O2 .../ash-x11-window-control.c -lX11`: **PASS**, compiled against the host's native Xlib. Bash syntax checks for both display modes: **PASS**.
- **Native X11 lifecycle PASS**, including the wrong-PID rejection, in `/var/tmp/ashx11.5RUIFE`; app PID `284027`, runtime ID `d5c33bac-4348-43ce-a18d-69f666908361`, retained terminal handle `term_9f843e7a-19d6-497e-9169-f0d0c949609c`, terminal PID `284752`. No duplicate process was spawned on GUI reopen; owned daemon/runtime stopped.
- **Final native X11 lifecycle and screenshots PASS** in `/var/tmp/ashx11.6BV2Za`: same app PID **`291816`** and runtime ID **`394e2491-e9a8-4840-9437-4cdf1a9b1d5b`** across initial GUI, last-window closure and reopen; terminal handle **`term_2981660c-8517-478e-9233-7c85d67026b3`**, live PTY PID **`292365`**, no duplicates. Mapped X11 top-level `0x200003` (1279×799) before closing; a **new** mapped top-level `0x200019` with the same Ash WM_CLASS and PID after reopening. The `WM_DELETE_WINDOW` request targeted only the original inspected window. The wrong-PID control found zero matching windows and refused the close. Final private root screenshot census: **939 distinct colors** initially and **991** after reopen at 1280×800. Test-owned runtime and daemon stopped; processes absent afterward.
- **Wayland regression PASS** after introducing the shared desktop mode in `/var/tmp/ashwl.c9NA9A`: private KWin native Wayland, app PID `289778`, runtime ID `239d2e08-0478-43b9-9f46-d06e8cba3670`, live terminal handle `term_bbf1bd2e-985b-40e9-a9dd-77d1249e8c7d`, PTY PID `290528`. Test-owned daemon/runtime stopped.
- **Network capture regression PASS** against the same packaged AppImage, explicitly pinning its mode to native Wayland. Private capture `/var/tmp/ashnet.*` and app fixture `/var/tmp/ashwl.1kxrR3`: **33,563** syscall trace lines, **8,934** Chromium netlog events; Chromium hostnames limited to `github.com`, `redirector.gvt1.com`, `rr5---sn-gwpa-cage7.gvt1.com`, no known PostHog host. As before, the correct audit status is **`CAPTURED_REQUIRES_ENDPOINT_REVIEW`**, not a claim of zero external traffic or full EX-09 acceptance. Test-owned runtime/daemon stopped.
- Pinned source-provenance verifier remains mandatory: no additional upstream-derived source was imported and no upstream code was removed in this QA-only addition. The C helper was written for Ash's own test workflow.

## Limits / acceptance status

- This independently verifies **the X11 packaged GUI/runtime/PTY lifetime subset** of PK-03. It does **not** fully accept PK-03, which additionally requires native X11 browser, clipboard, notifications, shell/agent provider, platform-specific display interactions and other representative workflows. The native X11 VM is intentionally window-manager-less; testing a normal window-managed desktop remains an additional integration scenario.
- A rendered screenshot and stable window identity do **not** establish full reference-based Orca visual parity or accessibility. Signed macOS/Windows releases, update/rollback, installer/user-data preservation, full EX-01–EX-10 package audit and outstanding network destination review are separately open.
- The existing user compositor and application sessions were not closed or altered. All X11/Wayland fixtures use isolated profiles and private test-owned process trees; no credential material or account data was copied into logs.
- The exact integrated GitHub CI run must be checked **after push**; local smoke/compilation is not remote CI evidence.

## Reproduce on an Arch Linux X11-capable QA host

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp ASH_TEST_CAPTURE_X11_SCREENSHOT=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-x11-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

Requires matching `dist/linux-unpacked` package helpers, native `Xvfb`, `xauth`, `xprop`, `mcookie`, a C compiler and Xlib headers. ImageMagick `import` and `magick` are required only when screenshot capture is enabled. Private fixture paths are printed by the test; no source-controlled secrets or images are generated.
