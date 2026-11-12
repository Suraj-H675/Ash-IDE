#!/usr/bin/env bash
# Exercise a real AppImage under a private Wayland compositor, without using the
# user's desktop, provider homes, installed application or workspace.
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
  'repo-add', 'terminal-create', 'terminal-before', 'terminal-closed',
  'terminal-reopened', 'status-before', 'status-closed', 'open', 'status-reopened'
]) {
  assert.equal(read(name).ok, true, `${name} must succeed`)
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
assert.match(protocol, /get_toplevel\(/, 'native xdg-shell top-level created')
assert.match(protocol, /set_app_id\("com\.ashide\.desktop"\)/, 'Wayland app ID is Ash')
console.log(JSON.stringify({
  status: 'PASS', appPid: before.app.pid, runtimeId: before.runtime.runtimeId,
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
    [[ -z "${kwin_pid:-}" ]] || kill "$kwin_pid" 2>/dev/null || true
    [[ -z "${app_pid:-}" ]] || wait "$app_pid" 2>/dev/null || true
    [[ -z "${kwin_pid:-}" ]] || wait "$kwin_pid" 2>/dev/null || true
    if (( result != 0 )); then echo 'Warning: test-owned shutdown was not fully confirmed' >&2; fi
  }
  trap cleanup EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT

  unset DISPLAY WAYLAND_DISPLAY
  kwin_wayland --virtual --socket ash-private --no-lockscreen --no-global-shortcuts --no-kactivities >"$test_root/kwin.log" 2>&1 &
  kwin_pid=$!
  local i
  for ((i=0; i<60; i++)); do
    [[ -S "$XDG_RUNTIME_DIR/ash-private" ]] && break
    sleep .25
  done
  [[ -S "$XDG_RUNTIME_DIR/ash-private" ]] || { echo 'Private KWin socket unavailable' >&2; return 1; }

  export WAYLAND_DISPLAY=ash-private XDG_SESSION_TYPE=wayland QT_QPA_PLATFORM=wayland
  export ASH_USER_DATA_PATH="$test_root/profile" ORCA_USER_DATA_PATH="$test_root/profile"
  export ASH_APP_EXECUTABLE="$appimage"
  WAYLAND_DEBUG=client "$appimage" --ozone-platform=wayland >"$test_root/app.log" 2>&1 &
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
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal create --command 'sleep 120' --json >"$test_root/terminal-create.json" 2>"$test_root/terminal-create.err")
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-before.json" 2>"$test_root/terminal-before.err")

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
  (cd "$test_root/project" && "$packaged_node" "$packaged_cli" terminal list --json >"$test_root/terminal-reopened.json" 2>"$test_root/terminal-reopened.err")
  assert_lifecycle
}

if [[ "${1:-}" == '--inner' ]]; then
  shift
  if [[ $# != 4 || ! "$1" =~ ^/var/tmp/ashwl\.[[:alnum:]]{6}$ ||
        "$(realpath -e "$1" 2>/dev/null)" != "$1" ||
        ! -f "$1/.ash-wayland-lifecycle-fixture" ||
        "$(stat -c %u "$1" 2>/dev/null)" != "$(id -u)" ||
        "$(stat -c %a "$1" 2>/dev/null)" != 700 ]]; then
    echo 'Refusing --inner: not an owned, private, disposable Ash Wayland test fixture' >&2
    exit 2
  fi
  private_session "$@"
  exit
fi

[[ "$(uname -s)" == 'Linux' ]] || { echo 'Linux-only smoke' >&2; exit 2; }
for command in bash dbus-run-session busctl kwin_wayland timeout realpath stat id; do require_command "$command"; done
[[ $# -le 1 ]] || { echo "Usage: $0 [AppImage path]" >&2; exit 2; }
appimage="$(realpath "${1:-$script_root/dist/ash-ide-linux.AppImage}")"
packaged_node="$(dirname "$appimage")/linux-unpacked/resources/node-runtime/bin/node"
packaged_cli="$(dirname "$appimage")/linux-unpacked/resources/app.asar.unpacked/out/cli/index.js"
[[ -x "$appimage" && -x "$packaged_node" && -f "$packaged_cli" ]] || {
  echo 'Build the AppImage and linux-unpacked runtime together before this smoke' >&2
  exit 2
}
# Both KWin's Wayland socket and Ash's authenticated RPC socket have the Linux
# 107-byte pathname limit. A sibling worktree can be too deep even when the
# compositor uses /tmp. /var/tmp provides a short *disk-backed* path for both
# IPC sockets and the AppImage's large extracted cache (not /tmp tmpfs).
# Retain logs on failure so the native cause remains inspectable.
test_root="$(mktemp -d /var/tmp/ashwl.XXXXXX)"
mkdir -p "$test_root/home/.config" "$test_root/home/.cache" "$test_root/home/.local/share" "$test_root/home/.local/state" "$test_root/home/.codex" "$test_root/home/.claude" "$test_root/run" "$test_root/profile" "$test_root/project"
chmod 700 "$test_root" "$test_root/run"
printf '%s\n' 'Test-owned disposable Ash IDE Wayland fixture' >"$test_root/.ash-wayland-lifecycle-fixture"

set +e
env -u DISPLAY -u WAYLAND_DISPLAY -u SSH_AUTH_SOCK -u ORCA_PAIRING_CODE -u ORCA_REMOTE_PAIRING \
  HOME="$test_root/home" \
  XDG_RUNTIME_DIR="$test_root/run" \
  XDG_CONFIG_HOME="$test_root/home/.config" \
  XDG_CACHE_HOME="$test_root/home/.cache" \
  XDG_DATA_HOME="$test_root/home/.local/share" \
  XDG_STATE_HOME="$test_root/home/.local/state" \
  CODEX_HOME="$test_root/home/.codex" \
  CLAUDE_CONFIG_DIR="$test_root/home/.claude" \
  timeout 120s dbus-run-session -- "$0" --inner "$test_root" "$appimage" "$packaged_node" "$packaged_cli" >"$test_root/driver.log" 2>&1
result=$?
set -e
if (( result != 0 )); then
  echo "FAIL (exit $result): private Wayland AppImage lifecycle; evidence: $test_root" >&2
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
console.log(reported)
console.log('Test-owned daemon and runtime stopped; private logs at ' + root)
NODE
# Retain JSON, protocol and shutdown logs but not the 500+ MB extraction cache.
# This is strictly inside the disposable fixture generated by mktemp above.
if [[ -d "$test_root/home/.cache/ash-ide/appimage" ]]; then
  rm -rf -- "$test_root/home/.cache/ash-ide/appimage"
fi
