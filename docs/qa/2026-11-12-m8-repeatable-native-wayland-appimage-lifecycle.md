# M8 — Repeatable native Wayland AppImage close/reopen with a live PTY

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** `main` at `ed896da2edb370befb440f86c06b1b925a6e5127`. The matching [foundation CI run 43163791573](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43163791573) completed successfully. This record's **new harness was not part of that CI run**.

**Orca provenance:** pinned read-only upstream `55697aec91390357540103f49991458f756b41cc`; new Ash-owned regression script, not a copied Orca file. No changes to the upstream reference, source licenses, product runtime or installed application.

## Previous evidence and repeatability defect

The prior [Linux desktop identity / Wayland review](2026-11-12-m8-linux-desktop-identity-and-wayland-close-review.md) recorded one successful manual native Wayland close/reopen, but could not make its transient KWin script reliably close the window. The old script matched `ash-ide`/`ashide` resource classes. The corrected AppImage actually emits `xdg_toplevel.set_app_id("com.ashide.desktop")`. Matching that exact application ID in the KWin window list resolved the observed selection failure in new isolated runs.

Added `config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh`: a repeatable, **opt-in** packaged AppImage test with fail-closed assertions and bounded waits. It deliberately does not run on the user's active Wayland desktop or use any existing provider account, project, installed Ash/Orca profile, launcher or CLI.

## Actual procedure

The test requires Linux, `kwin_wayland`, `busctl`, `dbus-run-session`, and a prebuilt `dist/ash-ide-linux.AppImage` plus its matching `dist/linux-unpacked` packaged Node and CLI. The primary target is the **actual AppImage binary**; CLI commands are executed via the **packaged Node/CLI resources from `linux-unpacked`**, not an installed global `ash-ide` launcher. A separately installed CLI remains untested by this test.

```sh
config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh \
  /home/suraj/projects/Ash-IDE/dist/ash-ide-linux.AppImage
```

The script creates a private short `/var/tmp/ashwl.XXXXXX` directory on the disk-backed filesystem, with separate HOME, XDG config/data/cache/state/runtime directories, Codex and Claude roots, and DBus. Its internal `--inner` entry point rejects arbitrary paths unless they match an owned `0700` fixture with a test marker. Both the KWin compositor socket and Ash's authenticated local RPC socket must fit Linux's Unix-socket pathname limit. An early attempt under the long feature worktree failed with `EINVAL` on the socket path, and an intermediate `/tmp` (tmpfs) attempt reported daemon write/persistence errors. Those attempts did **not** pass the acceptance assertions. Keeping the final fixture under `/var/tmp` avoided both environmental problems without weakening the assertions.

Inside isolated virtual KWin, the test launches the unchanged AppImage with native `--ozone-platform=wayland` and `WAYLAND_DEBUG=client`, registers only a disposable non-Git folder through authenticated local `repo.add` RPC, creates an actual `sleep` PTY using the packaged CLI and records its process ID and terminal handle. A KWin script selects the one normal window with resource class `com.ashide.desktop` and issues `closeWindow()` through the compositor API. The test checks that Ash remains connected with `graph_not_ready`/`workspace-window-closed`, then invokes the CLI `open` and requires `ready` with `available` window again.

Assertions require all CLI/RPC responses to succeed, unchanged AppImage PID and runtime ID across all three states, exactly one original terminal handle at each checkpoint, a still-live original terminal process, `get_toplevel` and the correct `set_app_id` in Electron's Wayland protocol trace. Test-owned `terminal-daemon stop` and `runtime stop` must report success, with `killedCount=1` for the single disposable PTY. Abnormal early shutdown uses an explicit, incarnation-checked, fixture-PID-record-based daemon fallback; it never signals processes by name or touches an unrelated profile. The extracted AppImage cache in a successful fixture is deleted while keeping the JSON/protocol logs.

## Successful reruns after fixing the harness

**Environment:** Arch Linux x86-64, kernel `7.2.11-arch1-1`, KWin `6.8.2` virtual Wayland compositor; genuine built AppImage `dist/ash-ide-linux.AppImage`, SHA-256 `faa75d016e86a3284cec40fef5a7d5337b743edaf78eaf47d3651015aa2675ad` (224,555,772 bytes). No `--no-sandbox` flag, no XWayland substitution, no external provider login, and no user workspace.

| Repeat | Result | App PID | Runtime ID | Original PTY PID | Original terminal handle |
| --- | --- | --- | --- | --- | --- |
| A | **PASS**, exit 0 | `1240957` | `0b6bd3b3-1b57-4304-a491-ce2e2ad62268` | `1241564` | `term_8af92a61-2ee8-4969-ab5b-3d6e1355a1b9` |
| B | **PASS**, exit 0 | `1242040` | `018db154-2f47-422d-a995-756651041def` | `1242577` | `term_21a56290-3a82-4ede-bda3-e8d50c50afd7` |
| C (guarded harness) | **PASS**, exit 0 | `1248036` | `2b927bb7-bfdf-4051-aa13-b60111d2cb07` | `1248625` | `term_d82289cd-faa4-41df-8619-5c7c4fa673c1` |

All three runs independently observed `ready/available → graph_not_ready/openable → ready/available`, the unchanged runtime and terminal identity within each run, a native `xdg_toplevel.set_app_id("com.ashide.desktop")`, and successful stop responses. The test-owned profile processes were absent after each completed run. Private evidence remains under `/var/tmp/ashwl.aeo41M`, `/var/tmp/ashwl.jjfuot`, and `/var/tmp/ashwl.lYufyY` (not committed or released); successful extraction caches were removed. The negative preflight checks also refused a nonexistent AppImage (exit 2) and an `--inner` request pointed at the user's real Ash checkout (exit 2), without launching an app. These successful reruns are **not** evidence that earlier failed test attempts passed.

## Disposition and remaining gates

**Verified in isolated native Wayland AppImage:** runtime/PTY persistence through a compositor-initiated last-window close, one-window reopen to ready, native surface/app ID, truthful windowless graph state, authenticated local packaged CLI access, and test-owned shutdown. This resolves the earlier repeatability gap for this specific lifecycle test; it does not certify the entire Linux release or multi-window M3/M8 behavior.

**Not verified by this test:** installed launcher/dock icon association, clipboard and portals, real Codex/Claude live agent turns, two independent windows, full Orca visual parity, browser/headless continuity, notification delivery, network/telemetry exclusions, updater/rollback, native X11 parity in this new harness, or Windows/macOS packages. The release acceptance matrix and previous independently recorded tests still apply. Any CI run for the new script must be checked after integration; a successful base run is not proof of successor CI.
