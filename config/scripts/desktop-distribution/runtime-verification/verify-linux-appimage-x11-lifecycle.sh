#!/usr/bin/env bash
# A true native X11/Xvfb packaged smoke; deliberately not XWayland-in-Wayland.
# The shared lifecycle driver starts only an authenticated private X11 server
# and does not read or modify the user's display or account/profile state.
set -euo pipefail
script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
export ASH_TEST_DISPLAY_SERVER=x11
exec "$script_root/config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-wayland-lifecycle.sh" "$@"
