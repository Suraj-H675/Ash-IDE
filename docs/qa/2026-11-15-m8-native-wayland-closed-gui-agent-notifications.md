# M8 / RT-12 — native Wayland, closed-GUI agent notification and preference gates

**Date:** 2026-11-15 (Asia/Kolkata). **Starting Git:** synchronized canonical `main` `f47fb33e3f019f490fa34b286ecc26bf9ca02c81`, successful GitHub Actions run `43664738914`. **Isolated development:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `test/m8-native-wayland-closed-gui-notification`. **Pinned independent Orca reference:** `55697aec91390357540103f49991458f756b41cc` with intact MIT license and documented adaptation ledger.

## Test scope and unchanged production runtime

This is a **QA-only** extension to the existing packaged AppImage lifecycle harness. It reuses `ASH_TEST_WINDOWLESS_NOTIFICATION=1`, `ASH_TEST_NOTIFICATIONS_DISABLED=1` and `ASH_TEST_AGENT_COMPLETION_DISABLED=1` under a real private **native Wayland** virtual KWin session. The X11 browser, native X11 clipboard and running-work-dialog XTest journeys remain separate, X11-only cases. The AppImage was **not rebuilt or edited** for this milestone: `dist/ash-ide-linux.AppImage`, 224,358,813 bytes, SHA-256 **`074d0632b3caf05be5ad398039fca534778de2297320b3bb654382cf16dd2662`**; the matching unpacked Node/CLI tree was used.

The harness uses a separate mode-0700 `/var/tmp/ashwl.XXXXXX` root, private `HOME`/provider homes and `XDG_RUNTIME_DIR`, a new `dbus-run-session` bus, and `kwin_wayland --virtual --socket ash-private`. `WAYLAND_DEBUG=client` and the app ID `com.ashide.desktop` prove native xdg-shell participation, **not XWayland**. The KWin script matches exactly one Ash top-level by the real native app class and requests normal close; it never targets a real desktop compositor. The disposable compiler-built GIO receiver now accepts the owned `ashwl.*` fixture root but continues to refuse the real desktop session bus. The authenticated Claude-format hook generator and the read-only SQLite settings verifier similarly accept only fixture-owned `ashwl.*` or `ashx11.*` roots, retaining strict marker/UID/mode checks.

For native Wayland, the real packaged CLI creates a live, **unfocused** PTY in a disposable original folder, so Ash remains on its workbench Landing view and KWin's normal close succeeds without requiring unsupported synthetic Wayland keyboard input. The test still asserts the persistent runtime and same live PTY across GUI closure and reopening. After proving the GUI is closed (`graph_not_ready` / `openable`), the test starts its private D-Bus notification server and submits a correctly authenticated `Stop` to Ash's **real** packaged hook endpoint. A forged-token request before that must return **403**; authenticated `UserPromptSubmit` and `Stop` return **204**. The test independently verifies a durable `claude/done` row for the exact terminal pane **while the GUI is still closed**, with bounded retries because persistence is asynchronous. It checks the real `Notify` call and exact Ash app title/body where enabled. All owned runtime/daemon and compositor processes are explicitly stopped after the journey.

## Actual native-Wayland evidence

- **Enabled, closed GUI: PASS** on `/var/tmp/ashwl.XDUMkR`. The authenticated post-close completion reached the GIO notification server: `{"ok":true,"nativeDBusReceived":true,"appNameMatched":true,"exactContentMatched":true}`. The hook cache reached the exact `claude/done` pane state. App PID `553501`, runtime ID `59dfe8b1-02d5-4fee-833b-7cc2eba1c7fd`, terminal handle `term_f3a1f1ff-55ae-46ca-a519-7a453afb7978`, and PTY PID `553998` persisted across GUI closure and reopening; test-owned daemons and processes stopped.
- An initial Wayland attempt (`/var/tmp/ashwl.7CPH3A`) proved the OS notification and normal close/reopen, but its immediate persisted-hook-cache assertion raced the asynchronous disk write. The same fixture later showed `claude/done`. The harness was corrected to require the actual durable state using **bounded wait-before-reopen**, not to remove or weaken that assertion. The rerun above passed all assertions.
- **All notifications disabled, closed GUI: PASS** on `/var/tmp/ashwl.dEWdKD`: authentic completion still persisted as `claude/done`; startup and post-completion SQLite hash-verified settings reads remained `notifications.enabled=false`, `agentTaskComplete=true`; **no D-Bus `Notify` attempt** occurred during 4 seconds after the event (above the 1.5-second quiet period). App PID `555405`, runtime `26734c48-83dd-4cbe-9399-c94c35e6195a`, terminal handle `term_56c154b6-d6c9-43d3-8ddf-8f32e4370d42`, live PTY PID `555943` persisted through closure/reopen and stopped at test shutdown.
- **Agent-completion source disabled, closed GUI: PASS** on `/var/tmp/ashwl.k7ybXP`: authenticated completion persisted as `claude/done`; SQLite settings remained `notifications.enabled=true`, `agentTaskComplete=false`; **no native D-Bus `Notify` attempt** occurred during 4 seconds. App PID `556638`, runtime `3e9d1bcf-8eb8-4e2d-9791-fe02ab97d46e`, terminal handle `term_756315bd-bbec-488b-9b98-03907a180785`, live PTY PID `557164` persisted and stopped at shutdown.
- In all three fixture variants, wrong-token rejection succeeded and separate private daemon/runtime cleanup was observed; no user session, profile, OS notification center, real provider, or repository was modified. Native notifications were directed **only** at the private session bus. The negative cases detect any attempted `Notify`, not only messages with expected content.
- **Native X11 guarded-close positive-notification regression PASS** `/var/tmp/ashx11.n5AGB4`, app PID `558654`, runtime `5adbbe15-4667-4c8f-9979-e8b991c87e11`, PTY PID `559205`; **native X11 agent-source opt-out regression PASS** `/var/tmp/ashx11.Kc1434`, app PID `563049`, runtime `0c8d359d-3ddd-4b2c-b20e-71539b6a9b87`, PTY PID `563634`. Both retained their live PTYs and stopped owned daemons and runtimes.
- **Default native Wayland lifecycle regression PASS** `/var/tmp/ashwl.0bq0oj`, app PID `560020`, runtime `e3f8c344-b914-42bf-9b0f-663059f78342`, PTY PID `560833`, after close/reopen and owned-process shutdown. **Combined X11 local browser + OSC 52 clipboard regression PASS** `/var/tmp/ashx11.AMeLnA`, app PID `564315`, runtime `7914c5c3-25f2-4bbd-a721-651054e092e0`, PTY PID `564959`; the browser navigation and live native clipboard behaviors remain unchanged.
- Full `pnpm run typecheck`: **PASS**. QA JavaScript formatting and lint with `--deny-warnings`, `node --check` on both fixtures, `bash -n` on both desktop harnesses, strict GIO C compilation with `-Wall -Wextra -Werror -O2`, Git whitespace check and pinned-source provenance verification all **PASS**. The provenance verifier still reports 33,506 pinned upstream records, 585 Ash edits, 8,567 excluded records and the original MIT notice hash.

## Acceptance boundary

**RT-12 native Wayland controlled-hook positive and negative gates: PASS locally.** In conjunction with prior X11 evidence, this covers packaged Linux native X11 and native Wayland host-side post-GUI-close notification delivery and preference suppression, but it is **not** full RT-12 release acceptance for a real coding-agent process: these are correctly formatted, authenticated test-owned Claude hooks rather than execution of a real provider CLI against a real account. Native Wayland **focused running-work confirmation**, end-user notification-center display/click behavior, native Wayland compositor screenshot parity, macOS/Windows, RPM, and update/rollback remain separate, unaccepted gates. The absence of attempted `Notify` is observed only during the specified bounded negative window; no unbounded suppression claim is made.

The changes are limited to QA scripts and this report; no new production service, IPC, model provider integration, or packaged binary is added. Post-push CI must be independently observed for the final integrated commit.

## Reproduction

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp ASH_TEST_WINDOWLESS_NOTIFICATION=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"

TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp ASH_TEST_WINDOWLESS_NOTIFICATION=1 \
  ASH_TEST_NOTIFICATIONS_DISABLED=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"

TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp ASH_TEST_WINDOWLESS_NOTIFICATION=1 \
  ASH_TEST_AGENT_COMPLETION_DISABLED=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

Requires private KWin Wayland, `dbus-run-session`, host GIO dev headers/cc, matching bundled Node/CLI, and test-only pnpm/esbuild for the disabled-preference profile seeding. All traces stay in the owned `/var/tmp/ashwl.*` fixture, not in Git.
