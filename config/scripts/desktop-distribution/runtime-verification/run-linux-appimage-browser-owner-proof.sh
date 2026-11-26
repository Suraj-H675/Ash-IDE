#!/usr/bin/env bash
# Run the packaged browser owner proof with Chromium DevTools fenced inside a
# disposable user/network namespace. There is deliberately no host-network fallback.
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
usage() {
  echo "Usage: $0 <AppImage path> <x11|wayland> <owned mode-700 run directory>" >&2
  exit 2
}
[[ $# == 3 ]] || usage

appimage="$(realpath -e "$1")"
display_server="$2"
private_root="$(realpath -e "$3")"
[[ "$display_server" == 'x11' || "$display_server" == 'wayland' ]] || usage
[[ -x "$appimage" ]] || { echo 'AppImage must be executable' >&2; exit 2; }
[[ -d "$private_root" && "$(stat -c %u "$private_root")" == "$(id -u)" &&
   "$(stat -c %a "$private_root")" == '700' ]] || {
  echo 'Run directory must be owned by the current user and mode 700' >&2
  exit 2
}
for command in unshare ip readlink setpriv; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done

if [[ "$display_server" == 'wayland' ]]; then
  # Verify system provenance before user namespace UID remapping.
  installed_kwin="$(realpath -e "$(command -v kwin_wayland)")"
  [[ "$(stat -c %u "$installed_kwin")" == 0 && ! -w "$installed_kwin" ]] || {
    echo 'Expected a non-writable system-owned KWin binary' >&2
    exit 2
  }
  export ASH_TEST_OWNER_KWIN_PATH="$installed_kwin"
  export ASH_TEST_OWNER_KWIN_SHA256="$(sha256sum "$installed_kwin" | cut -d' ' -f1)"
fi

exec 9</proc/self/ns/net
parent_netns="$(readlink /proc/self/fd/9)"
host_uid="$(id -u)"
exec unshare --user --map-current-user --net --keep-caps --fork sh -ceu '
  expected_netns="$1"
  private_root="$2"
  display_server="$3"
  host_uid="$4"
  lifecycle="$5"
  appimage="$6"
  current_netns="$(readlink /proc/self/ns/net)"
  parent_netns_from_fd="$(readlink /proc/self/fd/9)"
  [ "$parent_netns_from_fd" = "$expected_netns" ] || {
    echo "Caller network namespace handle was not retained" >&2
    exit 2
  }
  [ "$current_netns" != "$expected_netns" ] || {
    echo "Private network namespace was not created" >&2
    exit 2
  }
  [ "$(id -u)" = "$host_uid" ] || {
    echo "Private namespace changed the process uid" >&2
    exit 2
  }
  ip link set lo up
  export ASH_TEST_EXPECTED_NETNS="$expected_netns"
  export ASH_TEST_PARENT_NETNS_FD=9
  export ASH_TEST_PRIVATE_ROOT="$private_root"
  export ASH_TEST_DISPLAY_SERVER="$display_server"
  export ASH_TEST_BROWSER_SMOKE=1
  export ASH_TEST_BROWSER_OWNER_PROBE=1
  # Namespace-local capabilities are needed only for loopback setup. Do not
  # grant Ash or its observers any of those capabilities.
  exec setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- "$lifecycle" "$appimage"
' sh "$parent_netns" "$private_root" "$display_server" "$host_uid" \
  "$script_root/config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh" \
  "$appimage"
