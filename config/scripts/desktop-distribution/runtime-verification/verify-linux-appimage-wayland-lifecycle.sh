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
if (process.env.ASH_TEST_BROWSER_SMOKE === '1') {
  const visited = read('local-browser-before')
  const restored = read('local-browser-after')
  const guarded = read('status-running-work-guard')
  const confirmed = read('x11-close-confirm-return')
  assert.equal(visited.ok, true)
  assert.equal(visited.firstPage, true)
  assert.equal(visited.click, true)
  assert.equal(visited.evaluation, true)
  assert.equal(visited.secondPage, true)
  assert.equal(restored.ok, true)
  assert.equal(restored.sameBrowserPageId, true)
  assert.equal(restored.retainedUrl, true)
  assert.equal(restored.loadedAfterReopen, true)
  assert.equal(guarded.result.runtime.state, 'ready', 'running work must prompt before closing')
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.returnSent, true)
}
const nativeX11 = process.env.ASH_TEST_DISPLAY_SERVER === 'x11'
if (nativeX11) {
  const window = read('x11-window')
  const close = read('x11-close')
  const reopenedWindow = read('x11-reopened-window')
  assert.equal(window.ok, true)
  assert.equal(window.nativeX11, true)
  assert.equal(window.class, 'com.ashide.desktop')
  assert.ok(window.width >= 500 && window.height >= 300, 'visible native X11 top-level')
  assert.equal(close.ok, true)
  assert.equal(close.closeRequestSent, true, 'native WM_DELETE_WINDOW must be delivered')
  assert.equal(close.window, window.window, 'close only the inspected Ash window')
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
    [[ -z "${app_pid:-}" ]] || kill "$app_pid" 2>/dev/null || true
    [[ -z "${browser_server_pid:-}" ]] || kill "$browser_server_pid" 2>/dev/null || true
    [[ -z "${kwin_pid:-}" ]] || kill "$kwin_pid" 2>/dev/null || true
    [[ -z "${xvfb_pid:-}" ]] || kill "$xvfb_pid" 2>/dev/null || true
    [[ -z "${app_pid:-}" ]] || wait "$app_pid" 2>/dev/null || true
    [[ -z "${browser_server_pid:-}" ]] || wait "$browser_server_pid" 2>/dev/null || true
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
  export ASH_USER_DATA_PATH="$test_root/profile" ORCA_USER_DATA_PATH="$test_root/profile"
  export ASH_APP_EXECUTABLE="$appimage"
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
  else
    (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --command 'sleep 120' --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
  fi
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-before.json" 2>"$test_root/terminal-before.err")
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
  else
    cat >"$test_root/close-ash.js" <<'JS'
// KWin runs this only in a private virtual compositor. Match the real Wayland
// app ID, not the executable name (`ash-ide`) or a changeable window caption.
var matches = workspace.windowList().filter(function(w) {
  return w.normalWindow && String(w.resourceClass || '').toLowerCase() === 'com.ashide.desktop';
});
if (matches.length === 1 && matches[0].closeable) matches[0].closeWindow();
JS
    local script_result script_id
    script_result="$(busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript s "$test_root/close-ash.js")"
    script_id="$(awk '$1 == "i" { print $2 }' <<<"$script_result")"
    [[ "$script_id" =~ ^[0-9]+$ ]] || { echo 'KWin rejected close script' >&2; return 1; }
    busctl --user call org.kde.KWin "/Scripting/Script$script_id" org.kde.kwin.Script run >"$test_root/kwin-script.log" 2>&1
  fi
  if [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' || "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ]]; then
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

  "$packaged_node" "$packaged_cli" open --json >"$test_root/open.json" 2>"$test_root/open.err"
  for ((i=0; i<90; i++)); do
    "$packaged_node" "$packaged_cli" status --json >"$test_root/status-reopened.json" 2>"$test_root/status-reopened.err" || true
    if assert_cli_state "$test_root/status-reopened.json" ready available 2>/dev/null; then break; fi
    sleep .4
  done
  assert_cli_state "$test_root/status-reopened.json" ready available
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
if [[ ( "${ASH_TEST_BROWSER_SMOKE:-}" == '1' || "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ) && "$display_server" != 'x11' ]]; then
  echo 'Optional packaged browser and X11 clipboard fixtures currently require native X11' >&2
  exit 2
fi
if [[ "${ASH_TEST_OSC52_CLIPBOARD:-}" == '1' ]]; then
  require_command base64
fi

if [[ "${1:-}" == '--inner' ]]; then
  shift
  if [[ $# != 4 || ! "$1" =~ ^/var/tmp/ash(wl|x11)\.[[:alnum:]]{6}$ ||
        "$(realpath -e "$1" 2>/dev/null)" != "$1" ||
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
for command in bash dbus-run-session timeout realpath stat id; do require_command "$command"; done
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
# KWin's Wayland socket and Ash's authenticated RPC socket have Linux pathname
# limits. /var/tmp provides a short, disk-backed private fixture path for both
# native display servers, IPC sockets and AppImage extraction (not /tmp tmpfs).
# Retain logs on failure so the native cause remains inspectable.
if [[ "$display_server" == 'x11' ]]; then
  test_root="$(mktemp -d /var/tmp/ashx11.XXXXXX)"
else
  test_root="$(mktemp -d /var/tmp/ashwl.XXXXXX)"
fi
mkdir -p "$test_root/home/.config" "$test_root/home/.cache" "$test_root/home/.local/share" "$test_root/home/.local/state" "$test_root/home/.codex" "$test_root/home/.claude" "$test_root/run" "$test_root/profile" "$test_root/project"
chmod 700 "$test_root" "$test_root/run"
printf '%s\n' 'Test-owned disposable Ash IDE native desktop fixture' >"$test_root/.ash-desktop-lifecycle-fixture"

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
  timeout "$( [[ "${ASH_TEST_BROWSER_SMOKE:-}" == '1' ]] && echo 170 || echo 120 )s" dbus-run-session -- "$0" --inner "$test_root" "$appimage" "$packaged_node" "$packaged_cli" >"$test_root/driver.log" 2>&1
result=$?
set -e
if (( result != 0 )); then
  echo "FAIL (exit $result): private $display_server AppImage lifecycle; evidence: $test_root" >&2
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
