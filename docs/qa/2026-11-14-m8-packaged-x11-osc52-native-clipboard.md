# M8 / ED-06 — packaged native X11 terminal OSC 52 system clipboard proof

**Date:** 2026-11-14 (Asia/Kolkata). **Baseline:** clean, synchronized canonical `main` at `ceedc2bd42d4e50c57559cf910a85f6f369a87ea` with successful GitHub Actions run `43561375263`. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `test/m8-x11-packaged-osc52-clipboard`. **Pinned source:** independent Orca `55697aec91390357540103f49991458f756b41cc`, MIT license and adaptation ledger unchanged.

## Test added and isolation boundary

- The existing, opt-in native-X11 packaged AppImage lifecycle supports `ASH_TEST_OSC52_CLIPBOARD=1`. It continues to use a private Xvfb `1280×800×24` display, authenticated `XAUTHORITY`, new `HOME`, private XDG and Ash profile, and **only a test-owned workspace and terminal**. No user clipboard or X11 display is connected.
- The test creates a real visible native PTY through the **packaged Ash CLI** with an ordinary test shell command. After a short delay to let the renderer mount and subscribe, that command emits an OSC 52 `clipboard` escape sequence containing the base64 of the known static test-only sentence `Ash IDE X11 OSC52 clipboard test`, then stays alive with `sleep 120`.
- A separately compiled and connected Xlib client, `ash-x11-clipboard-probe.c`, confirms that Xvfb's **CLIPBOARD selection has an owner**, sends a real `XConvertSelection` request for `UTF8_STRING`, waits for `SelectionNotify` under bounded retries, reads the bytes from the X11 property, and requires a byte-for-byte match. It never reports clipboard bytes in logs; only `{"ok":true,"nativeClipboardRead":true,"exactTextMatched":true}`. The reader refuses any profile outside the expected private, owned Xvfb fixture path before opening a display.
- Because the created PTY is now represented in the workbench, normal X11 `WM_DELETE_WINDOW` correctly opens the app's **running-terminal close confirmation**. The test explicitly accepts that dialog through its previously verified private XTest Return-key helper, rather than weakening or bypassing the running-work guard.
- The original GUI remains re-openable in the same process; the runtime and same PTY persist across last-window close/reopen. The test explicitly stops the test-owned daemon and runtime at the end. The `ASH_TEST_OSC52_CLIPBOARD` option is X11-only and defaults to off, leaving native Wayland and prior browser test behavior unchanged.

## Real package evidence

- AppImage under test: previously built `dist/ash-ide-linux.AppImage`, **224,358,840 bytes**, SHA-256 **`a7b0e3b6854a53f9a66f85735ce4b60da9a8cf8c808bbb4c281f5c7edd5c50a1`**. This milestone adds only QA source; it does **not** claim a new package build or a changed native clipboard implementation.
- Native helper compiled with `cc -std=c11 -Wall -Wextra -Werror -O2 .../ash-x11-clipboard-probe.c -lX11`: **PASS**.
- First run `/var/tmp/ashx11.xC531c`: **native X11 clipboard owner and exact test value PASS**. Its subsequent close step initially failed because a focused running terminal correctly triggered a close guard; the harness was amended to confirm it, rather than dismissing the product behavior as a defect.
- Full corrected run **PASS**: `/var/tmp/ashx11.DRysOa`. Real native selection read gave `{"ok":true,"nativeClipboardRead":true,"exactTextMatched":true}`. Close confirmation returned `{"ok":true,"returnSent":true,"window":"0x200003"}`. App PID **`367040`**, runtime ID **`fa9b22bc-5b91-44a1-a7b5-d2231f93aab8`**, persistent terminal handle **`term_aab4dd83-6559-4c51-9583-9e3462d6da8f`**, and live PTY PID **`367615`** remained unchanged across GUI closure and reopening. Initial X11 top-level `0x200003`, reopened top-level `0x200019`, both class `com.ashide.desktop` and the same app PID. Real 1280×800 screenshot pixel census was 472 colors before closure and 246 colors after reopening. Both test-owned PIDs absent after shutdown.
- Existing behavior regression **PASS** for native X11 with OSC 52 opt-in absent: `/var/tmp/ashx11.zDVPEY`, app PID `374281`, runtime ID `07ca63ba-43e9-48df-80a7-b2143f4d2e54`, retained terminal `term_4288744a-b4e4-4a0a-9dbf-5133de1277c3`, PTY PID `374814`; test-owned runtime/daemon stopped. **Default native Wayland regression PASS**: `/var/tmp/ashwl.H51i7X`, app PID `375672`, runtime ID `4b2bed12-2a66-4232-83c7-669f328fcb8e`, retained terminal `term_530946ac-b2c2-4b70-84c7-474d74fea7a4`, PTY PID `376287`; test-owned runtime/daemon stopped.
- **45/45 relevant Vitest tests PASS** across 3 files for OSC 52 migration notice, clipboard text publishing, and native IPC clipboard handling; tests emit known React `act(...)` and expected rejection logging warnings, not failures. **Full `pnpm run typecheck`: PASS**. Pinned-source provenance validator: **PASS**, 33,506 recorded upstream files, 583 Ash adaptations and 8,567 removed-source entries with the expected MIT notice SHA. Shell syntax, strict native C compilation and `git diff --check`: **PASS**.
- Native Xlib helper rejects invocation without the disposable X11 profile/authority before touching any X11 clipboard (negative safety control returned `Refusing to inspect the user's real X11 clipboard`).
- **Native X11 browser regression PASS** with the separate `ASH_TEST_BROWSER_SMOKE=1` option after this change: `/var/tmp/ashx11.3AbNNe`, app PID `377961`, runtime ID `86c2b342-5d24-416a-8676-e5f8fbe6b30c`, original terminal handle `term_9d7a583a-7977-45f9-ae02-806d1c8d6604`, PTY PID `379187`. Real local page, click, navigation, guarded close and browser tab restoration remained functional; test-owned runtime/daemon stopped.

## Acceptance limits

- **ED-06 actual OSC 52-to-native-X11 clipboard write subset: PASS locally.** This is stronger than a mocked Electron clipboard call and supports real terminal OSC 52 data flowing through the renderer to a distinct native X11 selection reader.
- **Still open:** disabled-setting OSC 52 write blocking in a real GUI, OSC 52 query non-disclosure at the native boundary, PRIMARY selection behavior, clipboard images and rich formats, copy/paste keyboard mappings, the Wayland helper/clipboard manager journey, Windows/macOS, and native notifications while the GUI is closed. The scripted terminal's literal test string says nothing about sensitive clipboard behavior in existing user profiles.
- **PK-03 overall:** remains open pending representative additional desktop interactions. The Xvfb test has no ordinary window manager; screenshots establish rendered pixels, not full reference-based visual parity.
- No provider account, user Git repository, existing application profile, other desktop session or real clipboard was read or modified. The private test logs and images must not be committed.
- Only post-push observed GitHub Actions is CI evidence. The prior `ceedc2bd` success is the known baseline, not an assertion of CI success for this change.

## Reproduce

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  ASH_TEST_OSC52_CLIPBOARD=1 ASH_TEST_CAPTURE_X11_SCREENSHOT=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-x11-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

Requires the matching `dist/linux-unpacked` packaged helper tree, Xvfb, native Xlib development headers/compiler, GNU `base64`, and ImageMagick if screenshot census is enabled. Bounded polling is limited to the disposable fixture; both clipboard expected text and native selection contents are deliberately absent from the public test summary.
