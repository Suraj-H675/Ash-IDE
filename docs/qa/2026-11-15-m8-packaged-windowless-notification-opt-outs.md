# M8 / RT-12 — real packaged closed-GUI notification preference negative tests

**Date:** 2026-11-15 (Asia/Kolkata). **Starting canonical `main`:** `40f5884c6315c16d21a3feffe5260bf4d2019a76`, remote synchronized and CI run `43630484771` observed successful. **Isolated feature worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, `test/m8-packaged-notification-preference-negative`. **Source:** approved independently pinned Orca `55697aec91390357540103f49991458f756b41cc`, original MIT attribution retained. This milestone changes **QA scripts only**, not product code or the shipped AppImage.

## Added positive/negative controls

The existing `ASH_TEST_WINDOWLESS_NOTIFICATION=1` native-X11 AppImage journey authenticates to the *real* packaged hook server in a marker-verified private fixture. It sends a forged-token request (must return HTTP 403), an authenticated Claude-format working event while the GUI is open, closes the actual Ash top-level after the focused-running-terminal guard confirmation, verifies the GUI is closed and the same PTY/runtime survives, then sends a real authenticated completion hook while the GUI is absent. The persisted hook cache must end in `claude/done`.

Two independent **opt-in** extensions now exercise actual persisted preference gating under the same package journey:

- `ASH_TEST_NOTIFICATIONS_DISABLED=1`: all desktop notifications disabled, while `agentTaskComplete` remains true, proving the global master switch works.
- `ASH_TEST_AGENT_COMPLETION_DISABLED=1`: global notifications remain enabled, but `agentTaskComplete` is false, proving per-agent-source control works separately.

The seeder `ash-private-notification-setting.cjs` refuses any path outside an owned, mode-0700 `/var/tmp/ashx11.XXXXXX` Ash lifecycle fixture and requires the profile marker and environment. Only when explicitly opted in, the harness compiles Ash's **real `getDefaultPersistedState`** from `src/shared/constants.ts` with installed esbuild and uses it to create a complete test-only legacy JSON profile with one notification preference changed. It refuses to replace any existing profile/database. The packaged app itself imports/migrates this state into its **real hash-protected SQLite profile authority**. A separate read-only `node:sqlite` inspection verifies the durable settings document SHA-256 and both preference fields **after startup and again after hook completion**. No running database is edited from outside Ash, and no user profile is opened.

The independently compiled GIO `org.freedesktop.Notifications` test sink, which refuses the user's real D-Bus session, records the mere attempt to call `Notify` in a private marker **before** inspecting title/body. Therefore a disabled test fails if **any** unexpected native notification reaches the private session, even with an unexpected title or malformed body. After the authenticated completion the harness observes for **4,000 ms**, exceeding Ash's **1,500-ms agent-completion quiet period**, and requires both the attempt marker and successful-delivery artifact to be absent. It preserves the usual GUI reopen and terminal/daemon cleanup checks. This is an observed 4-second suppression, not a claim about all possible future delayed events.

## Actual Arch Linux native-X11 / native-Wayland results

- **Global off PASS** `/var/tmp/ashx11.rZTuQi`: private seed, packaged startup SQLite read-back and post-hook read-back all confirmed `notifications.enabled=false`, `agentTaskComplete=true`. Hook server accepted the working/completion events, persisted `claude/done`, yet zero native D-Bus `Notify` calls were detected over 4 s. App PID **`518909`**, runtime **`819a1697-e2f6-445f-9e3b-622171581ff0`**, live PTY **`519437`**, original terminal **`term_cf5c6074-dde9-4e4d-b774-bfb43f7611d9`** survived GUI close/reopen; test-owned runtime and daemon stopped. Initial exploration (before the separate post-hook persistence assertion) also passed under `/var/tmp/ashx11.dUlDM8`.
- **Agent completion off PASS** `/var/tmp/ashx11.fskk44`: seed, startup SQLite and post-hook read-back confirmed `notifications.enabled=true`, `agentTaskComplete=false`, with zero native D-Bus `Notify` attempts over 4 s and a durable `claude/done` hook state. App PID **`520167`**, runtime **`469295cd-3efd-4d88-aa22-f9ff281292dc`**, PTY PID **`520686`**, terminal handle **`term_55912601-2572-4003-a490-dbb4eb549ba0`** survived GUI close/reopen; owned daemon/runtime stopped. Preliminary source-only case passed under `/var/tmp/ashx11.wnXoKn`.
- **Enabled positive control PASS** `/var/tmp/ashx11.VvOvmo`: with no preference seeding, the same native sink observed the expected `org.freedesktop.Notifications.Notify` completion call after GUI closure. App PID **`521983`**, runtime **`e7b6f6d1-a8f4-4a8d-867c-fea820fcbcc2`**, terminal handle **`term_a838c3c0-9550-4f56-96dd-25a4c64c2c08`**, PTY PID **`522496`**, preserved across close/reopen; owned runtime/daemon stopped. This positive control rules out a broken or unsubscribed D-Bus sink as the reason for disabled-case silence.
- **Unmodified default native Wayland regression PASS** `/var/tmp/ashwl.UevL4U`: app PID **`523087`**, runtime **`a01141b3-9af5-49bc-91b6-edb126809201`**, terminal handle **`term_4f75058d-406c-4770-998f-45f72f4eb46a`**, PTY PID **`523596`** survived window close/reopen and were explicitly stopped. Disabled-notification tests themselves are **native-X11-only**; no false Wayland notification claim.
- Exact existing **AppImage**: `dist/ash-ide-linux.AppImage`, 224,358,813 bytes, SHA-256 **`074d0632b3caf05be5ad398039fca534778de2297320b3bb654382cf16dd2662`**, with its matching `dist/linux-unpacked` bundled Node/CLI. No new product package was required for this QA-only addition.

## Acceptance limits

**RT-12 settings semantics (global and agent-completion opt-outs): verified** against the packaged Linux X11 runtime. The earlier positive closed-GUI hook-to-D-Bus test remains verified. The remaining **full real-provider execution** release gate is open: the hook events use accurate Claude protocol envelopes and private auth, but no actual Claude or Codex model process was launched or signed-in account accessed. Native Wayland closed-GUI notifications, macOS/Windows, other notification types, clicks/sounds and cross-platform system integration remain separate unverified gates. M8 exclusions, updater rollback and full packaging/release remain open.

Private profile state, hook token, D-Bus fixtures, screenshots (when requested), and raw CLI evidence remain in mode-0700 `/var/tmp` QA directories; none is checked into Git. The user desktop, original repositories, provider homes and credentials are untouched. No GitHub release was published. Check CI for the **actual new commit** after push; previous run `43630484771` is merely the proven baseline.

## Repeat

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  ASH_TEST_WINDOWLESS_NOTIFICATION=1 ASH_TEST_NOTIFICATIONS_DISABLED=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-x11-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"

TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  ASH_TEST_WINDOWLESS_NOTIFICATION=1 ASH_TEST_AGENT_COMPLETION_DISABLED=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-x11-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"

TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  ASH_TEST_WINDOWLESS_NOTIFICATION=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-x11-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

Requires source-matched packaged Node/CLI, pinned source and esbuild for the **test-only** default-profile snapshot, private Xvfb/Xlib/XTest tools, GIO headers/compiler and D-Bus. The notification test opt-outs are off by default and cannot target an existing profile path.
