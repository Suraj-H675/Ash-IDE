#!/usr/bin/env bash
# Trace network syscalls of a disposable packaged AppImage/Wayland test session.
# Never attach to existing user processes, or publish raw traces / Chromium URLs.
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
appimage="$(realpath -e "${1:-$script_root/dist/ash-ide-linux.AppImage}")"
strace_bin="${ASH_NET_AUDIT_STRACE:-$(command -v strace || true)}"

if [[ $# -gt 1 || ! -x "$appimage" || ! -x "$strace_bin" ]]; then
  echo 'Usage: ASH_NET_AUDIT_STRACE=/path/to/strace verify-linux-appimage-network-audit.sh [AppImage]' >&2
  echo 'Requires an executable AppImage and a locally verified strace binary.' >&2
  exit 2
fi
for required in python3 timeout realpath mktemp sha256sum; do
  command -v "$required" >/dev/null 2>&1 || { echo "Missing $required" >&2; exit 2; }
done

# /var/tmp is disk-backed; /tmp is a quota-limited tmpfs on the Arch QA host.
capture_root="$(mktemp -d /var/tmp/ashnet.XXXXXX)"
chmod 700 "$capture_root"
echo "Private evidence directory: $capture_root"
echo "AppImage SHA-256: $(sha256sum "$appimage" | cut -d ' ' -f 1)"

# Prove the tracer sees a known networking syscall before trusting a negative.
"$strace_bin" -qq -s 0 -e trace=connect -o "$capture_root/control.syscalls" \
  python3 -c 'import socket; s=socket.socket(); s.settimeout(.5); s.connect_ex(("127.0.0.1", 9)); s.close()'
if ! grep -Eq 'connect\(.*(127\.0\.0\.1|AF_INET)' "$capture_root/control.syscalls"; then
  echo 'FAIL: network tracer missed the loopback-positive control' >&2
  exit 1
fi

# Running a FUSE-mounted AppImage under ptrace is refused by the kernel. This
# mode runs the *same* hash-verified AppImage payload after local extraction.
# The existing lifecycle harness creates private HOME/XDG/provider roots and
# its own KWin compositor, then exercises settings, PTY, GUI close/reopen and
# explicit shutdown. -s 0 prevents syscall payload/credential logging.
set +e
APPIMAGE_EXTRACT_AND_RUN=1 ASH_TEST_CHROMIUM_NETLOG=1 ASH_TEST_DISPLAY_SERVER=wayland ASH_TEST_BROWSER_SMOKE=0 \
  TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  timeout --kill-after=10s 220s "$strace_bin" -f -qq -ttt -s 0 \
    -e trace=network -o "$capture_root/network-syscalls.log" \
    "$script_root/config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh" "$appimage" \
    >"$capture_root/lifecycle.stdout" 2>"$capture_root/lifecycle.stderr"
result=$?
set -e
if ((result != 0)); then
  echo "FAIL (exit $result): traced packaged lifecycle; private evidence: $capture_root" >&2
  tail -n 16 "$capture_root/lifecycle.stderr" >&2
  exit "$result"
fi

python3 - "$capture_root" <<'PY'
import collections
import ipaddress
import json
import pathlib
import re
import sys
from urllib.parse import urlsplit

root = pathlib.Path(sys.argv[1])
trace = (root / 'network-syscalls.log').read_text()
if not trace.strip():
    raise SystemExit('FAIL: network syscall trace is empty')

peers = collections.Counter()
source_pids = set()
for line in trace.splitlines():
    if not re.search(r'\b(?:connect|sendto|sendmsg|sendmmsg)\(', line):
        continue
    if 'sa_family=AF_INET' not in line:
        continue
    ipv4 = re.search(r'inet_addr\("([^"]+)"\)', line)
    ipv6 = re.search(r'inet_pton\(AF_INET6, "([^"]+)"', line)
    port = re.search(r'sin6?_port=htons\((\d+)\)', line)
    match = re.match(r'(\d+)\s+', line)
    if not (match and port and (ipv4 or ipv6)):
        continue
    address = (ipv4 or ipv6).group(1)
    destination = ipaddress.ip_address(address)
    if destination.is_loopback or int(port.group(1)) == 0:
        continue
    peers[(str(destination), int(port.group(1)))] += 1
    source_pids.add(match.group(1))

# Chromium's netlog is a separate hint for attributing its own traffic. It
# does not cover Node, native libraries, processes outside Chromium or all
# possible encrypted destinations. Never include URLs or request bodies in
# a public QA summary.
fixture = None
for line in (root / 'lifecycle.stdout').read_text().splitlines():
    prefix = 'Test-owned daemon and runtime stopped; private logs at '
    if line.startswith(prefix):
        fixture = pathlib.Path(line.removeprefix(prefix))
if not fixture:
    raise SystemExit('FAIL: missing fully stopped lifecycle fixture')
netlog_file = fixture / 'chromium-netlog.json'
chromium = json.loads(netlog_file.read_text())
hostnames = set()
for event in chromium.get('events', []):
    params = event.get('params') or {}
    for field in ('url', 'host', 'hostname', 'host_and_port'):
        value = params.get(field)
        if not isinstance(value, str):
            continue
        if field == 'url':
            name = urlsplit(value).hostname
        else:
            name = value.rsplit(':', 1)[0] if value.count(':') == 1 else value
        if name and not name.startswith('/') and ('.' in name or name == 'localhost'):
            hostnames.add(name)

report = {
    'status': 'CAPTURED_REQUIRES_ENDPOINT_REVIEW' if peers else 'CAPTURED_NO_EXTERNAL_SOCKET_TARGETS',
    'captureScope': 'Disposable lifecycle test child process tree; KWin/helpers included',
    'syscallLines': len(trace.splitlines()),
    'nonLoopbackNonzeroPortTargets': [
        {'ip': ip, 'port': port, 'syscalls': count}
        for (ip, port), count in sorted(peers.items())
    ],
    'sourcePids': len(source_pids),
    'chromiumNetlogEventCount': len(chromium['events']),
    'chromiumHostnames': sorted(hostnames),
    'knownPosthogHostMatches': sorted(
        name for name in hostnames
        if name in ('posthog.com', 'posthog.io')
        or name.endswith(('.posthog.com', '.posthog.io'))
    ),
    'testFixture': str(fixture),
    'limitations': 'Destinations cannot alone prove their purpose. DNS/routing probes, non-Chromium clients, encrypted traffic and test-only compositor activity need attribution.'
}
(root / 'endpoint-summary.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
print('Raw trace and Chromium netlog are private test artifacts; do not commit them.')
if report['knownPosthogHostMatches']:
    raise SystemExit('FAIL: retired product analytics host observed in Chromium network log')
PY
