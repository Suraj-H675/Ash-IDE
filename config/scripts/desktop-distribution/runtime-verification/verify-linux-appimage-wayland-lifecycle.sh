#!/usr/bin/env bash
# Exercise a real AppImage under a private Wayland compositor (or native Xvfb
# via the X11 wrapper), without using the user's desktop, provider homes,
# installed application or workspace.
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 2; }
}

assert_cli_state() {
  local file="$1" state="$2" window="$3"
  [[ -f "$file" ]] || { echo "Missing CLI status evidence: $file" >&2; return 1; }
  "$packaged_node" - "$file" "$state" "$window" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
assert.equal(status.ok, true)
assert.equal(status.result?.runtime?.state, process.argv[3])
assert.equal(status.result?.app?.desktopWindowStatus, process.argv[4])
NODE
}

run_wayland_window_observer() {
  local stage="$1" script_result script_id i
  case "$stage" in
    before-close|closed-before-browser|closed-after-browser|reopened) ;;
    *) echo "Unsupported private KWin observation stage: $stage" >&2; return 2 ;;
  esac
  cat >"$test_root/kwin-window-observer-$stage.js" <<'JS'
var stage = '__STAGE__';
var windows = workspace.windowList().filter(function (window) {
  return String(window.resourceClass || '').toLowerCase() === 'com.ashide.desktop';
});
var appIds = windows.map(function (window) {
  return String(window.resourceClass || '');
}).join(',');
callDBus(
  'org.ashide.PrivateLifecycleObserver',
  '/org/ashide/PrivateLifecycleObserver',
  'org.ashide.PrivateLifecycleObserver',
  'RecordWindowCount',
  stage,
  windows.length,
  appIds,
  function () {
    if (stage !== 'before-close') return;
    if (windows.length !== 1 || !windows[0].closeable) return;
    workspace.activeWindow = windows[0];
    windows[0].closeWindow();
  }
);
JS
  sed -i "s/__STAGE__/$stage/" "$test_root/kwin-window-observer-$stage.js"
  script_result="$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript s "$test_root/kwin-window-observer-$stage.js")"
  script_id="$(awk '$1 == "i" { print $2 }' <<<"$script_result")"
  [[ "$script_id" =~ ^[0-9]+$ ]] || { echo 'KWin rejected window observer script' >&2; return 1; }
  busctl --user call org.kde.KWin "/Scripting/Script$script_id" org.kde.kwin.Script run >"$test_root/kwin-observer-$stage.log" 2>&1
  local evidence_file="wayland-window-$stage.json"
  [[ "$stage" == 'closed-after-browser' ]] && evidence_file='wayland-window-closed-after-browser.json'
  [[ "$stage" == 'reopened' ]] && evidence_file='wayland-window-reopened.json'
  for ((i=0; i<60; i++)); do
    [[ -s "$test_root/$evidence_file" ]] && break
    kill -0 "$wayland_observer_pid" 2>/dev/null || break
    sleep .1
  done
  [[ -s "$test_root/$evidence_file" ]] || {
    echo "Native Wayland observer did not record $stage" >&2
    return 1
  }
  "$packaged_node" - "$test_root/$evidence_file" "$stage" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const evidence = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const expected = process.argv[3] === 'before-close' || process.argv[3] === 'reopened' ? 1 : 0
assert.equal(evidence.ok, true)
assert.equal(evidence.nativeWayland, true)
assert.equal(evidence.stage, process.argv[3])
assert.equal(evidence.nativeAshWindows, expected)
assert.equal(evidence.appIds, expected === 1 ? 'com.ashide.desktop' : '')
NODE
}

assert_lifecycle() {
  "$packaged_node" - "$test_root" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const read = name => JSON.parse(fs.readFileSync(path.join(root, `${name}.json`), 'utf8'))

for (const name of [
  'settings-read', 'repo-add', 'terminal-create', 'terminal-before', 'terminal-closed',
  'terminal-reopened', 'status-before', 'status-closed', 'open', 'status-reopened'
]) {
  assert.equal(read(name).ok, true, `${name} must succeed`)
}
assert.equal(read('settings-read').settingsRead, true, 'local Settings RPC must be readable')
if (process.env.ASH_TEST_OSC52_CLIPBOARD === '1') {
  const clipboard = read('x11-osc52-clipboard')
  assert.equal(clipboard.ok, true)
  assert.equal(clipboard.nativeClipboardRead, true)
  assert.equal(clipboard.exactTextMatched, true)
}
if (process.env.ASH_TEST_WINDOWLESS_NOTIFICATION === '1') {
  const forged = read('hook-forged')
  assert.equal(forged.ok, true)
  assert.equal(forged.authenticatedHookSubmitted, false)
  assert.equal(forged.wrongTokenRejected, true)
  const started = read('hook-working')
  const finished = read('hook-finished')
  const globalDisabled = process.env.ASH_TEST_NOTIFICATIONS_DISABLED === '1'
  const sourceDisabled = process.env.ASH_TEST_AGENT_COMPLETION_DISABLED === '1'
  const disabled = globalDisabled || sourceDisabled
  const native = read(disabled ? 'no-native-notification' : 'native-notification')
  assert.equal(started.ok, true)
  assert.equal(started.phase, 'working')
  assert.equal(started.authenticatedHookSubmitted, true)
  assert.equal(finished.ok, true)
  assert.equal(finished.phase, 'finished')
  assert.equal(finished.authenticatedHookSubmitted, true)
  assert.equal(native.ok, true)
  if (disabled) {
    const seeded = read('private-profile-seed')
    const loaded = read('private-settings-loaded')
    const retained = read('private-settings-after')
    assert.equal(seeded.seededPrivateProfile, true)
    assert.equal(seeded.preference, globalDisabled ? 'global' : 'agent-complete')
    assert.equal(seeded.notificationsEnabled, !globalDisabled)
    assert.equal(seeded.agentTaskComplete, !sourceDisabled)
    assert.equal(loaded.loadedDisabledPreference, true)
    assert.equal(loaded.preference, seeded.preference)
    assert.equal(loaded.notificationsEnabled, !globalDisabled)
    assert.equal(loaded.agentTaskComplete, !sourceDisabled)
    assert.equal(retained.loadedDisabledPreference, true)
    assert.equal(retained.notificationsEnabled, !globalDisabled)
    assert.equal(retained.agentTaskComplete, !sourceDisabled)
    assert.equal(native.nativeNotificationSuppressed, true)
    assert.equal(native.observationWindowMs, 4000)
    assert.equal(fs.existsSync(path.join(root, 'native-notification-attempted')), false)
  } else {
    assert.equal(native.nativeDBusReceived, true)
    assert.equal(native.appNameMatched, true)
    assert.equal(native.exactContentMatched, true)
  }
  if (process.env.ASH_TEST_DISPLAY_SERVER === 'x11') {
    const guard = read('status-running-work-guard')
    const confirmed = read('x11-close-confirm-return')
    assert.equal(guard.result.runtime.state, 'ready')
    assert.equal(confirmed.ok, true)
    assert.equal(confirmed.returnSent, true)
  }
}
if (process.env.ASH_TEST_BROWSER_SMOKE === '1') {
  const visited = read('local-browser-before')
  const duringClose = read('local-browser-closed')
  const restored = read('local-browser-after')
  const browserIdentity = read('local-browser-identity')
  const closedStatus = read('status-closed-after-browser').result
  assert.equal(visited.ok, true)
  assert.equal(visited.firstPage, true)
  assert.equal(visited.click, true)
  assert.equal(visited.evaluation, true)
  assert.equal(visited.secondPage, true)
  assert.equal(visited.storageRetained, true)
  assert.equal(duringClose.ok, true)
  assert.equal(duringClose.closedStage, true)
  assert.equal(duringClose.storageRetained, true)
  assert.equal(duringClose.browserPageId, browserIdentity.browserPageId)
  assert.equal(duringClose.profileId, browserIdentity.profileId)
  assert.equal(duringClose.profileIdentity, browserIdentity.profileIdentity)
  assert.equal(duringClose.click, true)
  assert.match(duringClose.evaluation, /Activated local browser control/)
  assert.match(duringClose.navigation, /^http:\/\/127\.0\.0\.1:\d+\/closed$/)
  assert.equal(closedStatus.runtime.state, 'graph_not_ready')
  assert.equal(closedStatus.app.desktopWindowStatus, 'openable')
  assert.equal(closedStatus.runtime.reachable, true)
  assert.equal(restored.ok, true)
  assert.equal(restored.sameBrowserPageId, true)
  assert.equal(restored.sameProfileId, true)
  assert.equal(restored.profileIdentity, browserIdentity.profileIdentity)
  assert.equal(restored.retainedUrl, true)
  assert.equal(restored.loadedAfterReopen, true)
  assert.equal(restored.extraOffscreenPageClosed, true)
  assert.equal(restored.storageRetained, true)
  if (process.env.ASH_TEST_DISPLAY_SERVER === 'x11') {
    const guarded = read('status-running-work-guard')
    const confirmed = read('x11-close-confirm-return')
    assert.equal(guarded.result.runtime.state, 'ready', 'running work must prompt before closing')
    assert.equal(confirmed.ok, true)
    assert.equal(confirmed.returnSent, true)
  } else {
    const initialWindows = read('wayland-window-before-close')
    const beforeBrowser = read('wayland-window-closed-before-browser')
    assert.equal(beforeBrowser.ok, true)
    assert.equal(beforeBrowser.nativeAshWindows, 0)
    const closedWindows = read('wayland-window-closed-after-browser')
    const reopenedWindows = read('wayland-window-reopened')
    assert.equal(initialWindows.ok, true)
    assert.equal(initialWindows.nativeAshWindows, 1)
    assert.equal(initialWindows.appIds, 'com.ashide.desktop')
    assert.equal(closedWindows.ok, true)
    assert.equal(closedWindows.nativeAshWindows, 0)
    assert.equal(reopenedWindows.ok, true)
    assert.equal(reopenedWindows.nativeAshWindows, 1)
    assert.equal(reopenedWindows.appIds, 'com.ashide.desktop')
    const protocol = fs.readFileSync(path.join(root, 'app.log'), 'utf8')
    const toplevel = protocol.match(/get_toplevel\(new id xdg_toplevel#(\d+)\)/)
    assert.ok(toplevel, 'native Wayland Ash top-level must be observed')
    assert.match(protocol, /set_app_id\("com\.ashide\.desktop"\)/)
    assert.match(protocol, new RegExp(`xdg_toplevel#${toplevel[1]}\\.close\\(\\)`))
    assert.match(protocol, new RegExp(`-> xdg_toplevel#${toplevel[1]}\\.destroy\\(\\)`))
  }
}
const nativeX11 = process.env.ASH_TEST_DISPLAY_SERVER === 'x11'
if (nativeX11) {
  const window = read('x11-window')
  const close = read('x11-close')
  const closedWindow = read('x11-closed-window')
  const closedWindowAfterBrowser = process.env.ASH_TEST_BROWSER_SMOKE === '1'
    ? read('x11-closed-window-after-browser')
    : closedWindow
  const reopenedWindow = read('x11-reopened-window')
  assert.equal(window.ok, true)
  assert.equal(window.nativeX11, true)
  assert.equal(window.class, 'com.ashide.desktop')
  assert.ok(window.width >= 500 && window.height >= 300, 'visible native X11 top-level')
  assert.equal(close.ok, true)
  assert.equal(close.closeRequestSent, true, 'native WM_DELETE_WINDOW must be delivered')
  assert.equal(close.window, window.window, 'close only the inspected Ash window')
  assert.equal(closedWindow.ok, true)
  assert.equal(closedWindow.nativeAshWindows, 0)
  assert.equal(closedWindowAfterBrowser.ok, true)
  assert.equal(closedWindowAfterBrowser.nativeAshWindows, 0)
  assert.equal(reopenedWindow.ok, true)
  assert.equal(reopenedWindow.nativeX11, true)
  assert.equal(reopenedWindow.class, 'com.ashide.desktop')
  assert.equal(reopenedWindow.pid, window.pid, 'reopen must reuse the native app process')
  if (process.env.ASH_TEST_CAPTURE_X11_SCREENSHOT === '1') {
    for (const stage of ['initial', 'reopened']) {
      const pixels = read(`x11-${stage}-pixels`)
      assert.equal(pixels.ok, true)
      assert.equal(pixels.width, 1280)
      assert.equal(pixels.height, 800)
      assert.ok(pixels.uniqueColors > 40, 'real X11 viewport must contain rendered pixels')
    }
  }
}

const before = read('status-before').result
const closed = read('status-closed').result
const opened = read('open').result
const reopened = read('status-reopened').result
const terminal = read('terminal-create').result.terminal
if (process.env.ASH_TEST_WINDOWLESS_NOTIFICATION === '1') {
  const persisted = read('profile/agent-hooks/last-status')
  const hookRow = persisted.entries?.[terminal.paneKey]
  assert.equal(hookRow?.payload?.agentType, 'claude', 'real hook server persisted Claude-formatted agent')
  assert.equal(hookRow?.payload?.state, 'done', 'only the post-close completion may end the turn')
}
assert.ok(Number.isInteger(before.app.pid) && before.app.pid > 0)
assert.ok(Number.isInteger(terminal.processId) && terminal.processId > 0)
assert.match(terminal.handle, /^term_/)
assert.equal(before.runtime.state, 'ready')
assert.equal(before.runtime.reachable, true)
assert.equal(before.app.desktopWindowStatus, 'available')
assert.equal(closed.runtime.state, 'graph_not_ready')
assert.equal(closed.runtime.connectionState, 'workspace-window-closed')
assert.equal(closed.runtime.reachable, true)
assert.equal(closed.app.desktopWindowStatus, 'openable')
assert.equal(reopened.runtime.state, 'ready')
assert.equal(reopened.runtime.reachable, true)
assert.equal(reopened.app.desktopWindowStatus, 'available')
for (const state of [closed, opened, reopened]) {
  assert.equal(state.app.pid, before.app.pid, 'AppImage PID cannot change')
  assert.equal(state.runtime.runtimeId, before.runtime.runtimeId, 'runtime cannot be replaced')
}
for (const name of ['terminal-before', 'terminal-closed', 'terminal-reopened']) {
  assert.deepEqual(
    read(name).result.terminals.map(t => t.handle),
    [terminal.handle],
    `${name} must contain precisely the original PTY`
  )
}
if (process.env.ASH_TEST_BROWSER_SMOKE === '1') {
  const ptyIdentity = t => Object.fromEntries(
    ['handle', 'ptyId', 'incarnationId', 'executionHostId'].map(key => [key, t[key]])
  )
  const original = read('terminal-before').result.terminals.map(ptyIdentity)
  for (const value of Object.values(original[0])) assert.equal(typeof value, 'string')
  for (const stage of ['terminal-closed', 'terminal-closed-after-browser', 'terminal-reopened']) {
    assert.deepEqual(read(stage).result.terminals.map(ptyIdentity), original,
      `${stage}: browser lifecycle must preserve the exact original PTY incarnation`)
  }
  assert.equal(
    read('status-closed-after-browser').result.runtime.runtimeId,
    before.runtime.runtimeId,
    'browser commands during GUI closure must not replace the runtime'
  )
}
process.kill(terminal.processId, 0) // Live OS process, not only a durable terminal record.
const protocol = fs.readFileSync(path.join(root, 'app.log'), 'utf8')
if (!nativeX11) {
  assert.match(protocol, /get_toplevel\(/, 'native xdg-shell top-level created')
  assert.match(protocol, /set_app_id\("com\.ashide\.desktop"\)/, 'Wayland app ID is Ash')
}
console.log(JSON.stringify({
  status: 'PASS', displayServer: nativeX11 ? 'native-x11-xvfb' : 'native-wayland',
  appPid: before.app.pid, runtimeId: before.runtime.runtimeId,
  terminalHandle: terminal.handle, terminalPid: terminal.processId
}))
NODE
}

private_session() {
  test_root="$1"
  appimage="$2"
  packaged_node="$3"
  packaged_cli="$4"
  kwin_pid=''
  xvfb_pid=''
  browser_server_pid=''
  wayland_observer_pid=''
  notification_sink_pid=''
  app_pid=''

  cleanup() {
    local result=0
    if [[ -f "$test_root/profile/ash-runtime.json" ]]; then
      timeout --kill-after=3s 12s "$packaged_node" "$packaged_cli" terminal-daemon stop --yes --json >"$test_root/stop-daemon.json" 2>"$test_root/stop-daemon.err" || result=1
      timeout --kill-after=3s 12s "$packaged_node" "$packaged_cli" runtime stop --yes --json >"$test_root/stop-runtime.json" 2>"$test_root/stop-runtime.err" || result=1
    fi
    if [[ -s "$test_root/profile/daemon/daemon-v55.pid" ]]; then
      # A failure before RPC metadata is written (or a failed stop RPC) can
      # orphan the packaged daemon. Signal it only after verifying both PID
      # incarnation and *this fixture's* --pid-record path.
      "$packaged_node" - "$test_root/profile/daemon/daemon-v55.pid" <<'NODE' || result=1
const fs = require('node:fs')
const recordFile = process.argv[2]
const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
const pid = record.pid
try {
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).trim().split(' ')
  if (!command.some(arg => arg.endsWith('/daemon-entry.js')) ||
      command[command.indexOf('--pid-record') + 1] !== recordFile ||
      stat[19] !== record.linuxStartTicks) {
    throw new Error('Refusing to signal daemon: test-owned process identity mismatch')
  }
  process.kill(pid, 'SIGTERM')
} catch (error) {
  if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error
}
NODE
    fi
    # A stopping RPC is not proof of process exit. Keep the display and D-Bus
    # alive while the owned Electron/browser processes finish graceful shutdown.
    if [[ -s "$test_root/stop-runtime.json" ]] &&
      python3 "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-private-shutdown-census.py" "$test_root" >"$test_root/graceful-shutdown-census.json" 2>"$test_root/graceful-shutdown-census.err"; then
      :
    else
      result=1
      [[ -z "${app_pid:-}" ]] || kill "$app_pid" 2>/dev/null || true
    fi
    [[ -z "${browser_server_pid:-}" ]] || kill "$browser_server_pid" 2>/dev/null || true
    [[ -z "${wayland_observer_pid:-}" ]] || kill "$wayland_observer_pid" 2>/dev/null || true
    [[ -z "${notification_sink_pid:-}" ]] || kill "$notification_sink_pid" 2>/dev/null || true
    [[ -z "${kwin_pid:-}" ]] || kill "$kwin_pid" 2>/dev/null || true
    [[ -z "${xvfb_pid:-}" ]] || kill "$xvfb_pid" 2>/dev/null || true
    [[ -z "${app_pid:-}" ]] || wait "$app_pid" 2>/dev/null || true
    [[ -z "${browser_server_pid:-}" ]] || wait "$browser_server_pid" 2>/dev/null || true
    [[ -z "${wayland_observer_pid:-}" ]] || wait "$wayland_observer_pid" 2>/dev/null || true
    [[ -z "${notification_sink_pid:-}" ]] || wait "$notification_sink_pid" 2>/dev/null || true
    [[ -z "${kwin_pid:-}" ]] || wait "$kwin_pid" 2>/dev/null || true
    [[ -z "${xvfb_pid:-}" ]] || wait "$xvfb_pid" 2>/dev/null || true
    if (( result != 0 )); then echo 'Warning: test-owned shutdown was not fully confirmed' >&2; fi
  }
  trap cleanup EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT

  capture_x11_pixels() {
    local stage="$1" geometry width height unique_colors
    import -window root "$test_root/x11-$stage.png"
    geometry="$(magick identify -format '%w %h %k' "$test_root/x11-$stage.png")"
    read -r width height unique_colors <<<"$geometry"
    [[ "$width" == 1280 && "$height" == 800 && "$unique_colors" =~ ^[0-9]+$ && "$unique_colors" -gt 40 ]] || {
      echo "Expected a rendered 1280x800 native X11 viewport at $stage, got $geometry" >&2
      return 1
    }
    printf '{"ok":true,"width":%s,"height":%s,"uniqueColors":%s}\n' \
      "$width" "$height" "$unique_colors" >"$test_root/x11-$stage-pixels.json"
  }

  unset DISPLAY WAYLAND_DISPLAY XAUTHORITY
  local i
  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
    export XAUTHORITY="$test_root/Xauthority" XDG_SESSION_TYPE=x11 QT_QPA_PLATFORM=xcb
    local display_num='' ready=0
    for ((i=0; i<12; i++)); do
      display_num=$((200 + RANDOM % 700))
      [[ ! -e "/tmp/.X11-unix/X$display_num" && ! -e "/tmp/.X$display_num-lock" ]] || continue
      export DISPLAY=":$display_num"
      xauth -f "$XAUTHORITY" add "$DISPLAY" . "$(mcookie)" >"$test_root/xauth.log" 2>&1
      chmod 600 "$XAUTHORITY"
      Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -noreset -auth "$XAUTHORITY" >"$test_root/xvfb.log" 2>&1 &
      xvfb_pid=$!
      local attempt
      for ((attempt=0; attempt<45; attempt++)); do
        if xprop -root -notype WM_NAME >"$test_root/x11-root.log" 2>&1; then
          ready=1
          break
        fi
        kill -0 "$xvfb_pid" 2>/dev/null || break
        sleep .2
      done
      ((ready == 1)) && break
      kill "$xvfb_pid" 2>/dev/null || true
      wait "$xvfb_pid" 2>/dev/null || true
      xvfb_pid=''
    done
    ((ready == 1)) || { echo 'Private authenticated native Xvfb X11 server unavailable' >&2; return 1; }
    cc -std=c11 -Wall -Wextra -Werror -O2 \
      "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-x11-window-control.c" \
      -lX11 -lXtst -o "$test_root/ash-x11-window-control"
    if [[ "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ]]; then
      cc -std=c11 -Wall -Wextra -Werror -O2 \
        "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-x11-clipboard-probe.c" \
        -lX11 -o "$test_root/ash-x11-clipboard-probe"
    fi
  else
    kwin_wayland --virtual --socket ash-private --no-lockscreen --no-global-shortcuts --no-kactivities >"$test_root/kwin.log" 2>&1 &
    kwin_pid=$!
    for ((i=0; i<60; i++)); do
      [[ -S "$XDG_RUNTIME_DIR/ash-private" ]] && break
      sleep .25
    done
    [[ -S "$XDG_RUNTIME_DIR/ash-private" ]] || { echo 'Private KWin socket unavailable' >&2; return 1; }
    export WAYLAND_DISPLAY=ash-private XDG_SESSION_TYPE=wayland QT_QPA_PLATFORM=wayland
  fi
  if [[ "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" == '1' ]]; then
    cc -std=c11 -Wall -Wextra -Werror -O2 \
      "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-private-desktop-notification-sink.c" \
      $(pkg-config --cflags --libs gio-2.0) -o "$test_root/ash-private-notification-sink"
  fi
  export ASH_USER_DATA_PATH="$test_root/profile" ORCA_USER_DATA_PATH="$test_root/profile"
  export ASH_APP_EXECUTABLE="$appimage"
  if [[ "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' || "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then
    local preference='global'
    if [[ "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then preference='agent-complete'; fi
    "$packaged_node" "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-private-notification-setting.cjs" \
      seed "$test_root" "$test_root/private-settings-defaults.cjs" "$preference" >"$test_root/private-profile-seed.json" 2>"$test_root/private-profile-seed.err"
  fi
  local -a app_args=(--ozone-platform="${ASH_TEST_DISPLAY_SERVER:-wayland}")
  if [[ "${ASH_TEST_CHROMIUM_NETLOG:-}" == '1' ]]; then
    # Chromium's default net-log mode omits raw cookies and sensitive request headers.
    # Keep the log private in this disposable fixture: URLs may still be sensitive.
    app_args+=("--log-net-log=$test_root/chromium-netlog.json")
  fi
  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
    "$appimage" "${app_args[@]}" >"$test_root/app.log" 2>&1 &
  else
    WAYLAND_DEBUG=client "$appimage" "${app_args[@]}" >"$test_root/app.log" 2>&1 &
  fi
  app_pid=$!
  for ((i=0; i<90; i++)); do
    if [[ -f "$test_root/profile/ash-runtime.json" ]]; then
      "$packaged_node" "$packaged_cli" status --json >"$test_root/status-before.json" 2>"$test_root/status-before.err" || true
      if assert_cli_state "$test_root/status-before.json" ready available 2>/dev/null; then break; fi
    fi
    sleep .4
  done
  if ! assert_cli_state "$test_root/status-before.json" ready available; then
    grep -E 'Failed to start local RPC transport|listen EINVAL|FATAL' "$test_root/app.log" | tail -6 >&2 || true
    return 1
  fi
  if [[ "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' || "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then
    "$packaged_node" "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-private-notification-setting.cjs" \
      verify "$test_root" "$test_root/private-settings-defaults.cjs" "$preference" >"$test_root/private-settings-loaded.json" 2>"$test_root/private-settings-loaded.err"
  fi

  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
    local ash_pid
    ash_pid="$("$packaged_node" -p "JSON.parse(require('fs').readFileSync('$test_root/status-before.json','utf8')).result.app.pid")"
    "$test_root/ash-x11-window-control" probe "$ash_pid" >"$test_root/x11-window.json" 2>"$test_root/x11-window.err"
    # Wrong-PID safety control: even on the owned Xvfb server, the helper
    # must refuse to close a window that does not match the Ash process ID.
    if "$test_root/ash-x11-window-control" close 1 >"$test_root/x11-refused.json" 2>"$test_root/x11-refused.err"; then
      echo 'X11 window helper wrongly accepted another process identity' >&2
      return 1
    fi
    if [[ "${ASH_TEST_CAPTURE_X11_SCREENSHOT:-}" == '1' ]]; then
      capture_x11_pixels initial
    fi
  fi

  # Exercise a real authenticated Settings read without logging private settings.
  # Network auditing can now cover a user Settings request as well as first run,
  # terminal interaction, GUI close/reopen and explicit daemon/runtime shutdown.
  cat >"$test_root/read-settings.cjs" <<'NODE'
const { RuntimeClient } = require(process.argv[2])
const client = new RuntimeClient(process.env.ASH_USER_DATA_PATH)
client.call('settings.get')
  .then(response => {
    if (!response.ok || !response.result?.settings ||
        typeof response.result.settings !== 'object') {
      throw new Error('Authenticated local settings read returned no settings')
    }
    console.log(JSON.stringify({ ok: true, settingsRead: true }))
  })
  .catch(error => { console.error(error); process.exitCode = 1 })
NODE
  "$packaged_node" "$test_root/read-settings.cjs" "$(dirname "$packaged_cli")/runtime/client.js" >"$test_root/settings-read.json" 2>"$test_root/settings-read.err"

  # `repo add` is intentionally absent from Ash's minimal public CLI, but the
  # authenticated local repo.add RPC remains available to the desktop runtime.
  cat >"$test_root/register-folder.cjs" <<'NODE'
const { RuntimeClient } = require(process.argv[2])
const client = new RuntimeClient(process.env.ASH_USER_DATA_PATH)
client.call('repo.add', { path: process.argv[3], kind: 'folder' })
  .then(result => { console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1 })
  .catch(error => { console.error(error); process.exitCode = 1 })
NODE
  "$packaged_node" "$test_root/register-folder.cjs" "$(dirname "$packaged_cli")/runtime/client.js" "$test_root/project" >"$test_root/repo-add.json" 2>"$test_root/repo-add.err"

  if [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
    local browser_fixture="$script_root/config/scripts/desktop-distribution/runtime-verification/ash-packaged-browser-local-smoke.cjs"
    "$packaged_node" "$browser_fixture" serve "$test_root" >"$test_root/browser-server.log" 2>"$test_root/browser-server.err" &
    browser_server_pid=$!
    for ((i=0; i<50; i++)); do
      [[ -s "$test_root/local-browser-ready.json" ]] && break
      kill -0 "$browser_server_pid" 2>/dev/null || break
      sleep .2
    done
    [[ -s "$test_root/local-browser-ready.json" ]] || {
      echo 'Private loopback browser HTTP fixture failed to start' >&2
      return 1
    }
    timeout --kill-after=5s 65s "$packaged_node" "$browser_fixture" before "$test_root" \
      "$(dirname "$packaged_cli")/runtime/client.js" >"$test_root/local-browser-before.json" 2>"$test_root/local-browser-before.err"
  fi
  if [[ "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ]]; then
    # Only the private test-owned PTY emits OSC52. The renderer must parse the
    # real PTY bytes and publish to X11; compare through a second Xlib client.
    local clipboard_value='Ash IDE X11 OSC52 clipboard test' encoded command
    encoded="$(printf '%s' "$clipboard_value" | base64 -w0)"
    command="sleep 4; printf '\\033]52;c;$encoded\\007'; sleep 120"
    (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --command "$command" --focus --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
  elif [[ "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" == '1' || "${ASH_TEST_WAYLAND_GUARD_HOLD:-}" == '1' || "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
    if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' || "${ASH_TEST_WAYLAND_GUARD_HOLD:-}" == '1' ]]; then
      # XTest can confirm Ash's legitimate running-work dialog in X11.
      (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --command 'sleep 120' --focus --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
    elif [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
      # Browser automation mounts the workspace even without requesting focus.
      # Use a live idle shell for this Wayland browser-only journey: a running
      # sleep would correctly prompt for consent. The separate guard-hold case
      # above still verifies that running work prevents unconfirmed closure.
      (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
    else
      # Without synthetic Wayland input, keep the PTY alive but leave the
      # workbench on Landing: KWin can deliver a real close without a dialog.
      (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --command 'sleep 120' --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
    fi
  else
    (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --command 'sleep 120' --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
  fi
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-before.json" 2>"$test_root/terminal-before.err")
  if [[ "${ASH_TEST_WAYLAND_GUARD_HOLD:-}" == '1' ]]; then
    # CLI terminal creation returns before its renderer tab projection is
    # guaranteed to have committed. A close during that gap can be a normal
    # close of Landing, not a test of the running-work guard.
    sleep 3
    local focused_terminal
    focused_terminal="$("$packaged_node" -e 'console.log(require(process.argv[1]).result.terminal.handle)' "$test_root/terminal-create.json")"
    (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal switch --terminal "$focused_terminal" --json >"$test_root/wayland-terminal-focus.json" 2>"$test_root/wayland-terminal-focus.err")
    sleep 2
  fi
  if [[ "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" == '1' ]]; then
    # Establish a real Claude-format working state while GUI presentation
    # exists. No provider login is needed: the isolated test owns its hook
    # token and injects only fixture events into the production hook server.
    "$packaged_node" "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-packaged-closed-gui-agent-hook.cjs" \
      forged "$test_root" >"$test_root/hook-forged.json" 2>"$test_root/hook-forged.err"
    "$packaged_node" "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-packaged-closed-gui-agent-hook.cjs" \
      working "$test_root" >"$test_root/hook-working.json" 2>"$test_root/hook-working.err"
  fi
  if [[ "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ]]; then
    local clipboard_observed=0
    for ((i=0; i<18; i++)); do
      if "$test_root/ash-x11-clipboard-probe" "$clipboard_value" >"$test_root/x11-osc52-clipboard.json" 2>"$test_root/x11-osc52-clipboard.err"; then
        clipboard_observed=1
        break
      fi
      sleep .25
    done
    ((clipboard_observed == 1)) || {
      echo 'Native X11 clipboard did not receive the expected live terminal OSC52 write' >&2
      tail -1 "$test_root/x11-osc52-clipboard.err" >&2 || true
      return 1
    }
  fi

  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
    "$test_root/ash-x11-window-control" close "$ash_pid" >"$test_root/x11-close.json" 2>"$test_root/x11-close.err"
  elif [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
    require_command pkg-config
    pkg-config --exists gio-2.0 || { echo 'Native GIO D-Bus dev package required' >&2; return 2; }
    cc -std=c11 -Wall -Wextra -Werror -O2 \
      "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-private-wayland-window-observer.c" \
      $(pkg-config --cflags --libs gio-2.0) -o "$test_root/ash-private-wayland-window-observer"
    "$test_root/ash-private-wayland-window-observer" "$test_root" >"$test_root/wayland-window-observer.log" 2>&1 &
    wayland_observer_pid=$!
    for ((i=0; i<50; i++)); do
      [[ -s "$test_root/wayland-window-observer-ready" ]] && break
      kill -0 "$wayland_observer_pid" 2>/dev/null || break
      sleep .1
    done
    [[ -s "$test_root/wayland-window-observer-ready" ]] || {
      echo 'Private Wayland window observer failed to start' >&2
      return 1
    }
    run_wayland_window_observer before-close
  else
    cat >"$test_root/close-ash.js" <<'JS'
// KWin runs this only in a private virtual compositor. Match the real Wayland
// app ID, not the executable name (`ash-ide`) or a changeable window caption.
var matches = workspace.windowList().filter(function(w) {
  return w.normalWindow && String(w.resourceClass || '').toLowerCase() === 'com.ashide.desktop';
});
if (matches.length === 1 && matches[0].closeable) {
  workspace.activeWindow = matches[0];
  matches[0].closeWindow();
}
JS
    local script_result script_id
    script_result="$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript s "$test_root/close-ash.js")"
    script_id="$(awk '$1 == "i" { print $2 }' <<<"$script_result")"
    [[ "$script_id" =~ ^[0-9]+$ ]] || { echo 'KWin rejected close script' >&2; return 1; }
    busctl --user call org.kde.KWin "/Scripting/Script$script_id" org.kde.kwin.Script run >"$test_root/kwin-script.log" 2>&1
  fi
  if [[ "${ASH_TEST_WAYLAND_GUARD_HOLD:-}" == '1' ]]; then
    sleep 2
    "$packaged_node" "$packaged_cli" status --json >"$test_root/status-running-work-guard.json" 2>"$test_root/status-running-work-guard.err"
    assert_cli_state "$test_root/status-running-work-guard.json" ready available
    "$packaged_node" - "$test_root" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const read = name => JSON.parse(fs.readFileSync(path.join(root, `${name}.json`), 'utf8'))
const initial = read('status-before')
const guard = read('status-running-work-guard')
const terminal = read('terminal-create').result.terminal
const focus = read('wayland-terminal-focus')
assert.equal(initial.ok, true)
assert.equal(guard.ok, true)
assert.equal(guard.result.runtime.state, 'ready')
assert.equal(guard.result.app.desktopWindowStatus, 'available')
assert.equal(initial.result.runtime.runtimeId, guard.result.runtime.runtimeId)
assert.equal(initial.result.app.pid, guard.result.app.pid)
assert.equal(focus.result.focus.navigated, true)
assert.equal(focus.result.focus.handle, terminal.handle)
process.kill(terminal.processId, 0)
const protocol = fs.readFileSync(path.join(root, 'app.log'), 'utf8')
const toplevel = protocol.match(/get_toplevel\(new id xdg_toplevel#(\d+)\)/)
assert.ok(toplevel, 'real Wayland top-level must exist')
assert.match(protocol, /set_app_id\("com\.ashide\.desktop"\)/)
assert.match(
  protocol,
  new RegExp(`xdg_toplevel#${toplevel[1]}\\.close\\(\\)`),
  'KWin must really deliver a close event to this exact Ash native top-level'
)
assert.doesNotMatch(
  protocol,
  new RegExp(`-> xdg_toplevel#${toplevel[1]}\\.destroy\\(\\)`),
  'The Wayland renderer may not destroy the guarded top-level'
)
console.log(JSON.stringify({
  status: 'PASS', nativeWaylandCloseEvent: true,
  nativeWaylandCloseHeld: true, windowStatus: 'available',
  appPid: guard.result.app.pid, runtimeId: guard.result.runtime.runtimeId,
  terminalHandle: terminal.handle, terminalPid: terminal.processId
}))
NODE
    # Do not bypass the user confirmation to force a green close/reopen test.
    # The owned runtime is stopped explicitly by the existing EXIT cleanup.
    return 0
  fi
  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' && ( "${ASH_TEST_BROWSER_SMOKE:-}" == '1' || "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' || "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" == '1' ) ]]; then
    # The local live PTY is now represented in the workbench; unlike Landing,
    # the real close flow correctly shows an explicit running-work dialog.
    # Test its deliberate user confirmation instead of bypassing the guard.
    sleep 2
    "$packaged_node" "$packaged_cli" status --json >"$test_root/status-running-work-guard.json" 2>"$test_root/status-running-work-guard.err"
    assert_cli_state "$test_root/status-running-work-guard.json" ready available
    "$test_root/ash-x11-window-control" send-return "$ash_pid" >"$test_root/x11-close-confirm-return.json" 2>"$test_root/x11-close-confirm-return.err"
  fi
  for ((i=0; i<45; i++)); do
    "$packaged_node" "$packaged_cli" status --json >"$test_root/status-closed.json" 2>"$test_root/status-closed.err" || true
    if assert_cli_state "$test_root/status-closed.json" graph_not_ready openable 2>/dev/null; then break; fi
    sleep .3
  done
  assert_cli_state "$test_root/status-closed.json" graph_not_ready openable
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-closed.json" 2>"$test_root/terminal-closed.err")

  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
    local closed_window_observed=0
    for ((i=0; i<45; i++)); do
      if "$test_root/ash-x11-window-control" probe-closed "$ash_pid" >"$test_root/x11-closed-window.json" 2>"$test_root/x11-closed-window.err"; then
        closed_window_observed=1
        break
      fi
      sleep .2
    done
    ((closed_window_observed == 1)) || {
      echo 'Native X11 observer still sees an Ash window after close' >&2
      return 1
    }
  fi

  if [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
    if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'wayland' ]]; then
      run_wayland_window_observer closed-before-browser
    fi
    timeout --kill-after=5s 65s "$packaged_node" "$browser_fixture" closed "$test_root" \
      "$(dirname "$packaged_cli")/runtime/client.js" >"$test_root/local-browser-closed.json" 2>"$test_root/local-browser-closed.err"
    "$packaged_node" "$packaged_cli" status --json >"$test_root/status-closed-after-browser.json" 2>"$test_root/status-closed-after-browser.err"
    assert_cli_state "$test_root/status-closed-after-browser.json" graph_not_ready openable
    (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-closed-after-browser.json" 2>"$test_root/terminal-closed-after-browser.err")
    if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
      "$test_root/ash-x11-window-control" probe-closed "$ash_pid" >"$test_root/x11-closed-window-after-browser.json" 2>"$test_root/x11-closed-window-after-browser.err"
    else
      run_wayland_window_observer closed-after-browser
    fi
  fi

  if [[ "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" == '1' ]]; then
    # Start listening only *after* status proves GUI is closed; the first
    # native notification in this bus must originate from the later Stop.
    [[ ! -e "$test_root/native-notification.json" ]] || return 1
    "$test_root/ash-private-notification-sink" "$test_root" \
      '--suffix:Claude finished' 'Claude finished.' \
      >"$test_root/notification-sink.log" 2>&1 &
    notification_sink_pid=$!
    for ((i=0; i<45; i++)); do
      [[ -s "$test_root/dbus-notification-ready" ]] && break
      kill -0 "$notification_sink_pid" 2>/dev/null || break
      sleep .1
    done
    [[ -s "$test_root/dbus-notification-ready" ]] || {
      echo 'Private D-Bus notification server failed after GUI closure' >&2
      return 1
    }
    "$packaged_node" "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-packaged-closed-gui-agent-hook.cjs" \
      finished "$test_root" >"$test_root/hook-finished.json" 2>"$test_root/hook-finished.err"
    if [[ "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' || "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then
      # The turn-end quiet window is 1500ms; observe well past it without
      # polling the user's session. A single attempted Notify fails the test
      # regardless of the message's title or body.
      sleep 4
      [[ ! -e "$test_root/native-notification-attempted" && ! -e "$test_root/native-notification.json" ]] || {
        echo 'Disabled notifications still attempted native D-Bus delivery' >&2
        return 1
      }
      printf '{"ok":true,"nativeNotificationSuppressed":true,"observationWindowMs":4000}\n' >"$test_root/no-native-notification.json"
      "$packaged_node" "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-private-notification-setting.cjs" \
        verify "$test_root" "$test_root/private-settings-defaults.cjs" "$preference" >"$test_root/private-settings-after.json" 2>"$test_root/private-settings-after.err"
    else
      local native_notification_observed=0
      for ((i=0; i<55; i++)); do
        if [[ -s "$test_root/native-notification.json" ]]; then
          native_notification_observed=1
          break
        fi
        kill -0 "$notification_sink_pid" 2>/dev/null || break
        sleep .1
      done
      ((native_notification_observed == 1)) || {
        echo 'No native Linux agent completion notification after GUI closure' >&2
        tail -9 "$test_root/notification-sink.log" >&2 || true
        return 1
      }
    fi
    # Hook state persistence is asynchronous and independent of D-Bus. Require
    # the exact pane to reach a durable `claude/done` row while the GUI is
    # still closed, rather than racing an immediate filesystem read on Wayland.
    local persisted_agent_done=0
    for ((i=0; i<40; i++)); do
      if "$packaged_node" - "$test_root/profile/agent-hooks/last-status.json" "$test_root/terminal-create.json" <<'NODE' >/dev/null 2>&1
const assert = require('node:assert/strict')
const fs = require('node:fs')
const row = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const terminal = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).result.terminal
assert.equal(row.entries?.[terminal.paneKey]?.payload?.agentType, 'claude')
assert.equal(row.entries?.[terminal.paneKey]?.payload?.state, 'done')
NODE
      then
        persisted_agent_done=1
        break
      fi
      sleep .2
    done
    ((persisted_agent_done == 1)) || {
      echo 'Agent completion never became durable while the GUI was closed' >&2
      return 1
    }
  fi

  "$packaged_node" "$packaged_cli" open --json >"$test_root/open.json" 2>"$test_root/open.err"
  for ((i=0; i<90; i++)); do
    "$packaged_node" "$packaged_cli" status --json >"$test_root/status-reopened.json" 2>"$test_root/status-reopened.err" || true
    if assert_cli_state "$test_root/status-reopened.json" ready available 2>/dev/null; then break; fi
    sleep .4
  done
  assert_cli_state "$test_root/status-reopened.json" ready available
  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'wayland' && "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
    run_wayland_window_observer reopened
  fi
  if [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]]; then
    timeout --kill-after=5s 35s "$packaged_node" "$browser_fixture" after "$test_root" \
      "$(dirname "$packaged_cli")/runtime/client.js" >"$test_root/local-browser-after.json" 2>"$test_root/local-browser-after.err"
  fi
  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' ]]; then
    "$test_root/ash-x11-window-control" probe "$ash_pid" >"$test_root/x11-reopened-window.json" 2>"$test_root/x11-reopened-window.err"
  fi
  if [[ "${ASH_TEST_DISPLAY_SERVER:-wayland}" == 'x11' && "${ASH_TEST_CAPTURE_X11_SCREENSHOT:-}" == '1' ]]; then
    capture_x11_pixels reopened
  fi
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-reopened.json" 2>"$test_root/terminal-reopened.err")
  assert_lifecycle
}

display_server="${ASH_TEST_DISPLAY_SERVER:-wayland}"
[[ "$display_server" == 'wayland' || "$display_server" == 'x11' ]] || {
  echo 'ASH_TEST_DISPLAY_SERVER must be wayland or x11' >&2
  exit 2
}
if [[ "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' && "$display_server" != 'x11' ]]; then
  echo 'The X11 clipboard fixture requires native X11' >&2
  exit 2
fi
if [[ "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ]]; then
  require_command base64
fi
if [[ "${ASH_TEST_WAYLAND_GUARD_HOLD:-}" == '1' ]]; then
  [[ "$display_server" == 'wayland' && "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" != '1' &&
     "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" != '1' && "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" != '1' ]] || {
    echo 'Focused guard-hold test requires native Wayland without notification test flags' >&2
    exit 2
  }
fi
if [[ "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" == '1' ]]; then
  require_command pkg-config
  pkg-config --exists gio-2.0 || { echo 'Native GIO D-Bus dev package required' >&2; exit 2; }
fi
if [[ ( "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' || "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ) && "${ASH_TEST_WINDOWLESS_NOTIFICATION:-}" != '1' ]]; then
  echo 'Disabled-notification QA requires the packaged windowless notification fixture' >&2
  exit 2
fi
if [[ "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' && "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then
  echo 'Run independent disabled-global and disabled-source fixture cases' >&2
  exit 2
fi
if [[ "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' || "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then
  require_command pnpm
fi

if [[ "${1:-}" == '--inner' ]]; then
  shift
  private_root="$(realpath -e "${ASH_TEST_PRIVATE_ROOT:-/var/tmp}" 2>/dev/null || true)"
  fixture_target="$(realpath -e "${1:-}" 2>/dev/null || true)"
  fixture_name="$(basename "$fixture_target")"
  if [[ $# != 4 || ! "$1" =~ ^(/tmp|/var/tmp)/ash(wl|x11)\.[[:alnum:]]{6}$ ||
        -z "$private_root" || -z "$fixture_target" ||
        "$(dirname "$fixture_target")" != "$private_root" ||
        ! "$fixture_name" =~ ^ash(wl|x11)\.[[:alnum:]]{6}$ ||
        ( -n "${ASH_TEST_PRIVATE_ROOT:-}" && ( ! -L "$1" || "$(readlink "$1")" != "$fixture_target" ) ) ||
        ( -z "${ASH_TEST_PRIVATE_ROOT:-}" && "$fixture_target" != "$1" ) ||
        ! -f "$1/.ash-desktop-lifecycle-fixture" ||
        "$(stat -c %u "$1" 2>/dev/null)" != "$(id -u)" ||
        "$(stat -c %a "$1" 2>/dev/null)" != 700 ]]; then
    echo 'Refusing --inner: not an owned, private, disposable Ash desktop test fixture' >&2
    exit 2
  fi
  private_session "$@"
  exit
fi

[[ "$(uname -s)" == 'Linux' ]] || { echo 'Linux-only smoke' >&2; exit 2; }
for command in bash dbus-run-session timeout realpath stat id python3; do require_command "$command"; done
if [[ "$display_server" == 'x11' ]]; then
  for command in Xvfb xauth xprop mcookie cc; do require_command "$command"; done
  if [[ "${ASH_TEST_CAPTURE_X11_SCREENSHOT:-}" == '1' ]]; then
    for command in import magick; do require_command "$command"; done
  fi
else
  for command in busctl kwin_wayland; do require_command "$command"; done
fi
[[ $# -le 1 ]] || { echo "Usage: $0 [AppImage path]" >&2; exit 2; }
appimage="$(realpath "${1:-$script_root/dist/ash-ide-linux.AppImage}")"
packaged_node="$(dirname "$appimage")/linux-unpacked/resources/node-runtime/bin/node"
packaged_cli="$(dirname "$appimage")/linux-unpacked/resources/app.asar.unpacked/out/cli/index.js"
[[ -x "$appimage" && -x "$packaged_node" && -f "$packaged_cli" ]] || {
  echo 'Build the AppImage and linux-unpacked runtime together before this smoke' >&2
  exit 2
}
# Keep fixture files in the caller's private run directory while a short /tmp
# symlink keeps Unix socket names below Linux's pathname limit.
umask 077
test_root_real=''
test_root_alias=''
if [[ -n "${ASH_TEST_PRIVATE_ROOT:-}" ]]; then
  private_root="$(realpath -e "$ASH_TEST_PRIVATE_ROOT")"
  [[ -d "$private_root" && "$(stat -c %u "$private_root")" == "$(id -u)" &&
     "$(stat -c %a "$private_root")" == '700' ]] || {
    echo 'ASH_TEST_PRIVATE_ROOT must be an owned mode-700 directory' >&2
    exit 2
  }
  fixture_prefix='ashwl'
  [[ "$display_server" == 'x11' ]] && fixture_prefix='ashx11'
  for attempt in 1 2 3 4 5; do
    test_root_real="$(mktemp -d "$private_root/$fixture_prefix.XXXXXX")"
    chmod 700 "$test_root_real"
    test_root_alias="/tmp/$(basename "$test_root_real")"
    if ln -s -- "$test_root_real" "$test_root_alias" 2>/dev/null; then
      break
    fi
    rmdir -- "$test_root_real"
    test_root_real=''
    test_root_alias=''
  done
  [[ -n "$test_root_alias" && -L "$test_root_alias" ]] || {
    echo 'Could not create a unique short path for the private desktop fixture' >&2
    exit 1
  }
  test_root="$test_root_alias"
  cleanup_fixture_alias() {
    if [[ -n "$test_root_alias" && -L "$test_root_alias" &&
          "$(readlink "$test_root_alias")" == "$test_root_real" ]]; then
      rm -- "$test_root_alias"
    fi
  }
  trap cleanup_fixture_alias EXIT
else
  if [[ "$display_server" == 'x11' ]]; then
    test_root_real="$(mktemp -d /var/tmp/ashx11.XXXXXX)"
  else
    test_root_real="$(mktemp -d /var/tmp/ashwl.XXXXXX)"
  fi
  test_root="$test_root_real"
fi
mkdir -p "$test_root/home/.config" "$test_root/home/.cache" "$test_root/home/.local/share" "$test_root/home/.local/state" "$test_root/home/.codex" "$test_root/home/.claude" "$test_root/run" "$test_root/profile" "$test_root/project"
chmod 700 "$test_root" "$test_root/run"
printf '%s\n' 'Test-owned disposable Ash IDE native desktop fixture' >"$test_root/.ash-desktop-lifecycle-fixture"
cat >"$test_root/run/dbus-session.conf" <<EOF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:path=$test_root/run/dbus-session.sock</listen>
  <auth>EXTERNAL</auth>
  <standard_session_servicedirs/>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
EOF
if [[ "${ASH_TEST_NOTIFICATIONS_DISABLED:-}" == '1' || "${ASH_TEST_AGENT_COMPLETION_DISABLED:-}" == '1' ]]; then
  (cd "$script_root" && pnpm exec esbuild src/shared/constants.ts --bundle --platform=node --format=cjs --log-level=error \
    "--outfile=$test_root/private-settings-defaults.cjs")
fi

set +e
env -u DISPLAY -u WAYLAND_DISPLAY -u XAUTHORITY -u SSH_AUTH_SOCK -u ORCA_PAIRING_CODE -u ORCA_REMOTE_PAIRING \
  HOME="$test_root/home" \
  XDG_RUNTIME_DIR="$test_root/run" \
  XDG_CONFIG_HOME="$test_root/home/.config" \
  XDG_CACHE_HOME="$test_root/home/.cache" \
  XDG_DATA_HOME="$test_root/home/.local/share" \
  XDG_STATE_HOME="$test_root/home/.local/state" \
  CODEX_HOME="$test_root/home/.codex" \
  CLAUDE_CONFIG_DIR="$test_root/home/.claude" \
  timeout "$( [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]] && echo 205 || echo 155 )s" dbus-run-session --config-file="$test_root/run/dbus-session.conf" -- "$0" --inner "$test_root" "$appimage" "$packaged_node" "$packaged_cli" >"$test_root/driver.log" 2>&1
result=$?
set -e
if (( result != 0 )); then
  echo "FAIL (exit $result): private $display_server AppImage lifecycle; evidence: $test_root_real" >&2
  tail -n 25 "$test_root/driver.log" >&2
  exit "$result"
fi
"$packaged_node" - "$test_root" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const read = name => JSON.parse(fs.readFileSync(path.join(root, `${name}.json`), 'utf8'))
const daemon = read('stop-daemon')
const runtime = read('stop-runtime')
assert.equal(daemon.ok, true)
assert.equal(daemon.result.status, 'stopped')
assert.equal(daemon.result.killedCount, 1)
assert.equal(runtime.ok, true)
assert.equal(runtime.result.status, 'stopping')
assert.equal(read('graceful-shutdown-census').ok, true, 'graceful stop left fixture-owned Ash/browser processes alive')
const reported = fs.readFileSync(path.join(root, 'driver.log'), 'utf8').split('\n').find(line => line.startsWith('{"status":"PASS"'))
assert.ok(reported, 'missing successful identity and protocol assertions')
if (process.env.ASH_TEST_CHROMIUM_NETLOG === '1') {
  const netlogPath = path.join(root, 'chromium-netlog.json')
  assert.ok(fs.existsSync(netlogPath), 'Chromium netlog was not created')
  const netlog = JSON.parse(fs.readFileSync(netlogPath, 'utf8'))
  assert.ok(Array.isArray(netlog.events), 'Chromium netlog is missing events')
  console.log(`Chromium private network log: ${netlog.events.length} events in ${netlogPath}`)
}
console.log(reported)
console.log('Test-owned daemon and runtime stopped; private logs at ' + root)
NODE
# Retain JSON, protocol and shutdown logs but not the 500+ MB extraction cache.
# This is strictly inside the disposable fixture generated by mktemp above.
if [[ -d "$test_root/home/.cache/ash-ide/appimage" ]]; then
  rm -rf -- "$test_root/home/.cache/ash-ide/appimage"
fi
echo "Private test evidence directory: $test_root_real"
