# M8 / native Wayland focused running-work close guard — verified hold, confirmation input open

**Date:** 2026-11-15 (Asia/Kolkata). **Starting main:** `21047a3abde17b301cded7a0f74a8fc28d7d1b9a` with GitHub Actions run `43666519750` observed successful. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `test/m8-wayland-focused-close-guard`. **Upstream:** independently pinned read-only Orca `55697aec91390357540103f49991458f756b41cc` and retained MIT license/source ledger.

## What was proved

The existing AppImage native-Wayland tests established normal GUI close/reopen with a live but **unfocused** PTY, and authenticated windowless notifications with the GUI absent. X11 separately proved a native close request and real XTest confirmation of the focused running-work dialog. The remaining Wayland acceptance question was whether the renderer **blocks a native compositor close** when a live PTY is actually attached to the focused workbench.

New opt-in `ASH_TEST_WAYLAND_GUARD_HOLD=1` extends the existing private-KWin desktop harness without changing the production app. It:

1. Uses a disposable owner-only `/var/tmp/ashwl.XXXXXX` profile, original-folder workspace, isolated session D-Bus, private `XDG_RUNTIME_DIR` and `kwin_wayland --virtual --socket ash-private` (true Wayland, **not XWayland**); provider homes and accounts are isolated.
2. Starts a real `sleep 120` PTY with packaged `ash-ide terminal create --focus`, then **waits for renderer startup** and explicitly invokes packaged `terminal switch --terminal <owned handle> --json`. Requires `focus.navigated=true`, the same terminal handle, and a live terminal OS PID. This is important: the terminal handle alone is **not** proof that the renderer has registered its tab.
3. KWin targets the single `com.ashide.desktop` normal top-level, activates that exact window and invokes its native `closeWindow()` method. This is a native Wayland compositor request, not renderer IPC or a forced window destruction.
4. Reads **the actual `WAYLAND_DEBUG=client` protocol log** and matches `xdg_surface.get_toplevel(new id xdg_toplevel#N)` and `xdg_toplevel#N.close()` for the **same** native window; requires Ash's app ID `com.ashide.desktop` and rejects a destroyed top-level.
5. After a two-second guard window, checks the authenticated CLI still reports `runtime.state=ready`, `desktopWindowStatus=available`, unchanged app PID and runtime ID, and the exact original live PTY. The test **does not** bypass or dismiss the guard to manufacture close/reopen success. It explicitly stops only its own daemon/runtime and KWin test processes afterward.

**PASS** final branch evidence in `/var/tmp/ashwl.hDkOcL`: `{"status":"PASS","nativeWaylandCloseEvent":true,"nativeWaylandCloseHeld":true,"windowStatus":"available","appPid":609469,"runtimeId":"0ef3cd64-a57e-455a-a7de-c97a233bf801","terminalHandle":"term_b340fcd8-00c6-4e47-8df6-069a467dc613","terminalPid":609985}`. All ownership-verified runtime and daemon cleanup checks passed. This proves **native close delivery plus preservation of the focused live session**.

**Native desktop regression results:** default Wayland close/reopen, same live PTY/runtime **PASS** `/var/tmp/ashwl.8YFf76`: app PID `611991`, runtime `e66f0fad-4577-4bb8-bac7-6ef747ce7a20`, PTY PID `612497`; focused X11 guarded-close confirmation, authenticated completion notification and close/reopen **PASS** `/var/tmp/ashx11.FCa7ZM`: app PID `613085`, runtime `d4399249-d017-4ddd-835e-8b92dcf5f992`, PTY PID `613598`. Both explicitly stopped all test-owned processes.

## Debugging and honest limitations

- First focused run `/var/tmp/ashwl.5vfM8f` closed immediately even though the packaged CLI had returned a live `surface=visible` PTY. The renderer's close assessment checks `tabsByWorktree`, not all PTYs. A newly created CLI terminal can precede tab projection; an immediate close in that gap is not a test of the focused running-work dialog. Explicit selection after startup is required in this fixture. This is a potential timing/attachment concern worth separate product review; it is **not** silently treated as accepted behavior.
- After explicit navigation, KWin-native close requests held the GUI, but an attempted KDE fake-input **evdev Enter** (`/var/tmp/ashwl.BsmnYA`) and newer **keysym Return** (`/var/tmp/ashwl.fkUUDJ`) did not dismiss the UI dialog. Both test clients reported protocol transport success; **that is not proof of delivered user input**. A separate **temporary local experiment** used an upstream `kwin-type` emulated-input test utility (GPL-2.0, pinned `0bc344b0d4a490d91d3a7e5e0cbe6481a4e88ab4` under `/var/tmp/ash-qa-kwin-type-0bc344`) without installation or inclusion in Ash; it also did not complete the dialog (`/var/tmp/ashwl.NHSshr`). No external GPL source/binary, KDE fake-input helper, or input-injection dependency is committed or shipped.
- Accordingly **native Wayland focused running-work close prevention is PASS**, while **native Wayland dialog focus, keyboard confirmation, subsequent GUI closure/reopen and user-visible screenshot parity are still OPEN**. The existing native Wayland **unfocused** normal close/reopen test, the X11 **focused** close confirmation and the native Wayland **unfocused** notification tests remain independent accepted evidence; do not conflate them.
- The app is the previously verified production build **224,358,813 bytes** SHA-256 **`074d0632b3caf05be5ad398039fca534778de2297320b3bb654382cf16dd2662`** plus matching unpacked Node/CLI. The change only adds an opt-in QA mode; no source-derived product changes, provider credentials, existing repositories, system notification service, GUI profile or release binary were altered.

## Reproduce

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp ASH_TEST_WAYLAND_GUARD_HOLD=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

Requires the same standard native virtual-KWin, session D-Bus and packaged node/CLI prerequisites as the existing Wayland lifecycle. Default lifecycle mode remains unchanged. Preserve the private `/var/tmp` fixture path and process identity as inspection evidence; do not commit or expose raw profile state and hook tokens. Verify the final commit's GitHub CI independently, not by inference from the baseline run.
