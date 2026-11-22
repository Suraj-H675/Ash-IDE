#!/usr/bin/env bash
# Manually invoked, QA-only native X11 proof for two local AppImage versions.
# Reuses one disposable profile; never installs, upgrades, or uses a real home.
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
helper="$script_root/config/scripts/desktop-distribution/runtime-verification/ash-two-version-native-profile-qa.cjs"
pidfd_tool="$script_root/config/scripts/desktop-distribution/runtime-verification/ash-two-version-native-pidfd.py"
embedded_tool="$script_root/config/scripts/desktop-distribution/runtime-verification/ash-two-version-native-embedded-fixture.mjs"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required QA tool unavailable: $1" >&2; exit 2; }
}

require_fixture() {
  [[ "$1" =~ ^/var/tmp/ashcross\.[[:alnum:]]{6}$ ]] || return 1
  [[ "$(realpath -e "$1")" == "$1" && "$(stat -c %a "$1")" == 700 &&
     "$(stat -c %u "$1")" == "$(id -u)" && -f "$1/.ash-native-cross-version-fixture" ]]
}

run_private_session() {
  # These process-ownership values intentionally outlive the function frame:
  # an EXIT trap still needs them when an inner command fails under set -e.
  root="$1"
  local previous_image="$2" previous_version="$3" candidate_image="$4" candidate_version="$5"
  require_fixture "$root" || { echo 'Unsafe private native test root' >&2; exit 2; }
  [[ "$previous_image" == "$root/previous.AppImage" && "$candidate_image" == "$root/candidate.AppImage" ]] || {
    echo 'Private launches must use the exact hashed in-fixture AppImage snapshots' >&2; exit 2;
  }
  # All CLI code and Node binaries below were extracted from those two pinned
  # AppImages. Never load an adjacent linux-unpacked tree from a build checkout.
  local previous_resources="$root/previous-embedded/resources"
  local candidate_resources="$root/candidate-embedded/resources"
  previous_node="$previous_resources/node-runtime/bin/node"
  local candidate_node="$candidate_resources/node-runtime/bin/node"
  local previous_out="$previous_resources/app.asar.unpacked/out"
  local candidate_out="$candidate_resources/app.asar.unpacked/out"
  local previous_cli="$previous_out/cli/index.js" candidate_cli="$candidate_out/cli/index.js"
  xvfb_pid=''
  xvfb_ticks=''
  app_pid=''
  app_ticks=''

  cleanup() {
    local exit_code=$?
    trap - EXIT
    # The daemon deliberately outlives the GUI. On failure, do not use pkill
    # or guess: verify its exact test-root PID record and incarnation first.
    if [[ -s "$root/profile/daemon/daemon-v55.pid" ]]; then
      "$previous_node" "$helper" stop-fixture-daemon "$root/profile/daemon/daemon-v55.pid" || exit_code=1
    fi
    if [[ -n "$app_pid" ]]; then
      if [[ -n "$app_ticks" ]]; then
        "$previous_node" "$helper" stop-fixture-app "$root" "$app_pid" "$app_ticks" || exit_code=1
      else
        echo 'App incarnation not pinned; refusing numeric-PID signaling' >&2
        exit_code=1
      fi
      wait "$app_pid" 2>/dev/null || true
    fi
    if [[ -n "$xvfb_pid" ]]; then
      if [[ -n "$xvfb_ticks" ]]; then
        "$previous_node" "$helper" stop-fixture-xvfb "$root" "$xvfb_pid" "$xvfb_ticks" || exit_code=1
      else
        echo 'Xvfb incarnation not pinned; refusing numeric-PID signaling' >&2
        exit_code=1
      fi
      wait "$xvfb_pid" 2>/dev/null || true
    fi
    echo "CLEANUP original_exit=$exit_code test-owned desktop and daemon checked" >> "$root/lifecycle.txt"
    exit "$exit_code"
  }
  trap cleanup EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT

  mkdir -p "$root/home/.config" "$root/home/.cache" "$root/home/.local/share" \
    "$root/home/.local/state" "$root/home/.claude" "$root/home/.codex" "$root/run" \
    "$root/profile" "$root/project"
  chmod 700 "$root/run"
  export HOME="$root/home" USERPROFILE="$root/home" XDG_CONFIG_HOME="$root/home/.config"
  export XDG_CACHE_HOME="$root/home/.cache" XDG_DATA_HOME="$root/home/.local/share"
  export XDG_STATE_HOME="$root/home/.local/state" XDG_RUNTIME_DIR="$root/run"
  export CODEX_HOME="$root/home/.codex" CLAUDE_CONFIG_DIR="$root/home/.claude"
  export ASH_USER_DATA_PATH="$root/profile" ORCA_USER_DATA_PATH="$root/profile"
  export TMPDIR="$root" QT_QPA_PLATFORM=xcb XDG_SESSION_TYPE=x11
  unset DISPLAY WAYLAND_DISPLAY XAUTHORITY SSH_AUTH_SOCK

  local ready=0 display_num attempt
  for ((attempt=0; attempt<12; attempt++)); do
    display_num=$((200 + RANDOM % 700))
    [[ ! -e "/tmp/.X11-unix/X$display_num" && ! -e "/tmp/.X$display_num-lock" ]] || continue
    export DISPLAY=":$display_num" XAUTHORITY="$root/Xauthority"
    xauth -f "$XAUTHORITY" add "$DISPLAY" . "$(mcookie)" > "$root/xauth.log" 2>&1
    chmod 600 "$XAUTHORITY"
    Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -noreset -auth "$XAUTHORITY" > "$root/xvfb.log" 2>&1 &
    xvfb_pid=$!
    xvfb_ticks="$(python3 "$pidfd_tool" snapshot xvfb "$root" "$xvfb_pid" |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["linuxStartTicks"])')"
    for ((i=0; i<40; i++)); do
      if xprop -root -notype WM_NAME > "$root/x11-root.log" 2>&1; then ready=1; break; fi
      kill -0 "$xvfb_pid" 2>/dev/null || break
      sleep .2
    done
    ((ready == 1)) && break
    python3 "$pidfd_tool" signal xvfb "$root" "$xvfb_pid" "$xvfb_ticks" > "$root/xvfb-retry-stop.json"
    wait "$xvfb_pid" 2>/dev/null || true
    xvfb_pid=''
    xvfb_ticks=''
  done
  ((ready == 1)) || { echo 'Could not create a private authenticated Xvfb server' >&2; return 1; }

  cc -std=c11 -Wall -Wextra -Werror -O2 \
    "$script_root/config/scripts/desktop-distribution/runtime-verification/ash-x11-window-control.c" \
    -lX11 -lXtst -o "$root/x11-window-control"
  "$previous_node" "$helper" seed "$root" "$previous_out" > "$root/seed.json"
  "$previous_node" "$previous_cli" profile state checkpoint --profile-id native-cross-version --json > "$root/old-checkpoint.json"
  local backup_id
  backup_id="$("$previous_node" "$helper" checkpoint-id "$root" "$root/old-checkpoint.json")"

  run_phase() {
    local name="$1" image="$2" node="$3" cli="$4" out="$5" version="$6"
    export ASH_APP_EXECUTABLE="$image"
    printf 'Starting %s\n' "$name" >> "$root/lifecycle.txt"
    "$image" --ozone-platform=x11 > "$root/${name}.app.log" 2>&1 &
    app_pid=$!
    app_ticks="$(python3 "$pidfd_tool" snapshot app "$root" "$app_pid" |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["linuxStartTicks"])')"
    local app_ready=0 app_identity
    for ((i=0; i<100; i++)); do
      if [[ -f "$root/profile/ash-runtime.json" ]]; then
        "$node" "$cli" status --json > "$root/${name}.status.json" 2> "$root/${name}.status.err" || true
        if "$node" "$helper" status "$root/${name}.status.json" "$version" > /dev/null 2>&1; then
          app_ready=1
          break
        fi
      fi
      kill -0 "$app_pid" 2>/dev/null || break
      sleep .4
    done
    if ((app_ready != 1)); then
      echo "Native GUI startup for $name failed" >&2
      tail -n 20 "$root/${name}.app.log" >&2
      return 1
    fi
    app_identity="$("$node" "$helper" status "$root/${name}.status.json" "$version")"
    "$root/x11-window-control" probe "$app_identity" > "$root/${name}.x11-window.json"
    "$node" "$helper" settings "$out" > "$root/${name}.settings.json"
    "$root/x11-window-control" close "$app_identity" > "$root/${name}.close.json"
    # The daemon survives normal GUI closure. Stop it before stopping the
    # independent Ash runtime, or the next AppImage may adopt its old daemon.
    "$node" "$cli" terminal-daemon stop --yes --json > "$root/${name}.daemon-stop.json" 2> "$root/${name}.daemon-stop.err"
    "$node" "$cli" runtime stop --yes --json > "$root/${name}.runtime-stop.json" 2> "$root/${name}.runtime-stop.err"
    # 'stopping' only acknowledges the RPC. A successful version switch also
    # requires this *same pinned app process* to exit without a fallback kill.
    python3 "$pidfd_tool" wait app "$root" "$app_pid" "$app_ticks" > "$root/${name}.natural-exit.json" || {
      echo "Runtime $name accepted stop but failed to exit normally" >&2
      return 1
    }
    if ! wait "$app_pid"; then
      echo "Runtime $name exited with an unsuccessful native process status" >&2
      return 1
    fi
    app_pid=''
    app_ticks=''
    printf 'Completed %s\n' "$name" >> "$root/lifecycle.txt"
  }

  run_phase first-previous "$previous_image" "$previous_node" "$previous_cli" "$previous_out" "$previous_version"
  "$candidate_node" "$helper" assert-before "$root" "$candidate_out" > "$root/after-first-read.json"
  "$candidate_node" "$helper" mutate "$root" "$candidate_out" > "$root/upgrade-write.json"
  run_phase second-candidate "$candidate_image" "$candidate_node" "$candidate_cli" "$candidate_out" "$candidate_version"
  "$previous_node" "$helper" assert-after "$root" "$previous_out" > "$root/after-second-read.json"
  "$previous_node" "$previous_cli" profile state rollback --backup "$backup_id" --profile-id native-cross-version --json > "$root/rollback.json"
  "$previous_node" "$helper" assert-before "$root" "$previous_out" > "$root/rollback-checked.json"
  run_phase third-previous "$previous_image" "$previous_node" "$previous_cli" "$previous_out" "$previous_version"
  "$candidate_node" "$helper" assert-before "$root" "$candidate_out" > "$root/final-read.json"
  "$previous_node" "$helper" verify-summary "$root" "$previous_version" "$candidate_version"
  # Do not return with an EXIT trap referring to this function's local root.
  # Successful cleanup must execute while the owned fixture scope is live.
  cleanup
}

if [[ "${1:-}" == '--inner' ]]; then
  shift
  [[ $# == 5 ]] || { echo 'Invalid private native test arguments' >&2; exit 2; }
  run_private_session "$@"
  exit
fi

[[ $(uname -s) == Linux && $# == 7 ]] || {
  echo 'Usage: verify-linux-appimage-cross-version-profile-x11.sh PREVIOUS_APPIMAGE PREVIOUS_SHA256 PREVIOUS_VERSION CANDIDATE_APPIMAGE CANDIDATE_SHA256 CANDIDATE_VERSION PINNED_SQUASHFS_READER' >&2
  exit 2
}
for command in node python3 sha256sum stat realpath id mktemp Xvfb xauth xprop mcookie cc dbus-run-session timeout; do
  require_command "$command"
done
previous_image="$(realpath -e "$1")"
previous_sha="$2"
previous_version="$3"
candidate_image="$(realpath -e "$4")"
candidate_sha="$5"
candidate_version="$6"
reader_path="$(realpath -e "$7")"
[[ "$previous_sha" =~ ^[a-f0-9]{64}$ && "$candidate_sha" =~ ^[a-f0-9]{64}$ ]] || {
  echo 'AppImages must be pinned by exact SHA-256' >&2; exit 2;
}
for image in "$previous_image" "$candidate_image"; do
  [[ -f "$image" && -x "$image" ]] || { echo 'Expected a real executable AppImage' >&2; exit 2; }
done
[[ "$(sha256sum "$previous_image" | cut -d' ' -f1)" == "$previous_sha" ]] || exit 2
[[ "$(sha256sum "$candidate_image" | cut -d' ' -f1)" == "$candidate_sha" ]] || exit 2
node - "$previous_version" "$candidate_version" <<'NODE'
const a=require('node:assert/strict');
const [oldVersion,newVersion]=process.argv.slice(2);
for(const version of [oldVersion,newVersion])a.match(version,/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const left=oldVersion.split('.').map(Number),right=newVersion.split('.').map(Number);
const changed=left.findIndex((part,i)=>part!==right[i]);a.ok(changed!==-1&&right[changed]>left[changed],'Candidate must be newer');
NODE

# Keep the authenticated X11 display and Ash data in a private test-owned home.
# The identity-pinned inputs are not a trusted update feed; this is QA only.
test_root="$(mktemp -d /var/tmp/ashcross.XXXXXX)"
chmod 700 "$test_root"
printf '%s\n' 'Test-owned Ash IDE native cross-version fixture' > "$test_root/.ash-native-cross-version-fixture"
# This materializes *only* the exact verified AppImage bytes and their embedded
# CLI/Node trees into the private fixture. Build-output directories are ignored.
node "$embedded_tool" "$previous_image" "$previous_sha" "$previous_version" "$reader_path" "$test_root" previous > "$test_root/previous-embedded-receipt.json"
node "$embedded_tool" "$candidate_image" "$candidate_sha" "$candidate_version" "$reader_path" "$test_root" candidate > "$test_root/candidate-embedded-receipt.json"
set +e
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$test_root/home" \
  timeout --kill-after=8s 230s dbus-run-session -- "$0" --inner \
  "$test_root" "$test_root/previous.AppImage" "$previous_version" "$test_root/candidate.AppImage" "$candidate_version" \
  > "$test_root/driver.log" 2>&1
result=$?
set -e
if ((result != 0)); then
  echo "FAIL ($result): isolated native shared-profile X11 proof, private evidence: $test_root" >&2
  tail -n 24 "$test_root/driver.log" >&2
  exit "$result"
fi
grep '^{"status":"PASS"' "$test_root/driver.log" | tail -n 1
echo "Test-owned GUI and daemon shutdown requested; private evidence: $test_root"
