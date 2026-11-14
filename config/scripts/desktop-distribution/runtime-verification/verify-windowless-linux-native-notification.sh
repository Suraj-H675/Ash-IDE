#!/usr/bin/env bash
# Actual notify-send -> private D-Bus org.freedesktop.Notifications integration.
# Uses the production TypeScript notifier bundled by esbuild; never connects to
# the user's session bus, GUI, provider accounts or existing notification center.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
command -v dbus-run-session >/dev/null
command -v cc >/dev/null
command -v pkg-config >/dev/null
command -v node >/dev/null
[[ -x /usr/bin/notify-send ]] || { echo 'System notify-send is unavailable' >&2; exit 2; }

umask 077
fixture="$(mktemp -d /var/tmp/ashnotify.XXXXXX)"
[[ "$(stat -c %a "$fixture")" == 700 ]] || exit 2

cc -std=c11 -Wall -Wextra -Werror -O2 \
  "$repo_root/config/scripts/desktop-distribution/runtime-verification/ash-private-desktop-notification-sink.c" \
  $(pkg-config --cflags --libs gio-2.0) -o "$fixture/private-notification-sink"
(
  cd "$repo_root"
  pnpm exec esbuild src/main/runtime/notifications/windowless-linux-agent-notifier.ts \
    --bundle --platform=node --format=cjs --log-level=error \
    "--outfile=$fixture/notifier.cjs"
)

dbus-run-session -- bash -eu -c '
  fixture="$1"
  expected_title="Ash IDE private desktop notification QA"
  expected_body="Test-owned local runtime event"
  [[ "$DBUS_SESSION_BUS_ADDRESS" == unix:path=/tmp/dbus-* ]] || {
    echo "Refusing to use an unverified private D-Bus session" >&2
    exit 2
  }
  "$fixture/private-notification-sink" "$fixture" "$expected_title" "$expected_body" \
    >"$fixture/native-sink.log" 2>&1 &
  sink_pid=$!
  trap '\''kill "$sink_pid" 2>/dev/null || true; wait "$sink_pid" 2>/dev/null || true'\'' EXIT
  for ((i=0; i<50; i++)); do
    [[ -s "$fixture/dbus-notification-ready" ]] && break
    kill -0 "$sink_pid" 2>/dev/null || break
    sleep .1
  done
  [[ -s "$fixture/dbus-notification-ready" ]] || {
    echo "Private notification sink unavailable" >&2; exit 1;
  }
  node - "$fixture/notifier.cjs" "$expected_title" "$expected_body" <<'\''NODE'\''
const assert = require("node:assert/strict")
const notifier = require(process.argv[2])
notifier.notifyWindowlessLinuxAgent({ title: process.argv[3], body: process.argv[4] })
  .then((sent) => {
    assert.equal(sent, true, "Native D-Bus notification delivery failed")
    console.log(JSON.stringify({ ok: true, nativeNotifierSent: true }))
  })
  .catch((error) => { console.error(error); process.exitCode = 1 })
NODE
  node - "$fixture/native-notification.json" <<'\''NODE'\''
const assert = require("node:assert/strict")
const actual = require(process.argv[2])
assert.deepEqual(actual, {
  ok: true, nativeDBusReceived: true, appNameMatched: true, exactContentMatched: true
})
console.log(JSON.stringify(actual))
NODE
' -- "$fixture"

echo "PASS: a real Linux native notification reached the isolated D-Bus sink; private evidence: $fixture"
