#!/bin/bash
# deb/rpm register ash-ide for headless hosts where the in-app installer cannot run.
# The shim resolves the app relative to itself. electron-builder installs the
# current Ash IDE product under `/opt/Ash IDE` (including the space), whereas
# older builds may have used `/opt/ash-ide`.
set -e

link="/usr/bin/ash-ide"

is_owned_link() {
  [ -L "$link" ] || return 1
  # Compare the exact symlink target, not a broad `/opt/*` prefix. A stale
  # link from an older Ash installation is ours even if its target disappeared.
  case "$(readlink -- "$link")" in
    "/opt/Ash IDE/resources/bin/ash-ide" | /opt/ash-ide/resources/bin/ash-ide) return 0 ;;
    *) return 1 ;;
  esac
}

for dir in "/opt/Ash IDE" /opt/ash-ide; do
  shim="$dir/resources/bin/ash-ide"
  [ -x "$shim" ] || continue
  sandbox="$dir/chrome-sandbox"
  if [ -f "$sandbox" ]; then
    # Why: packaged Linux installs must leave Chromium's sandbox helper usable
    # on hosts where unprivileged user namespaces are unavailable.
    chmod 4755 "$sandbox" || true
  fi

  # Only manage our own symlink; never clobber an unrelated /usr/bin/ash-ide.
  if { [ ! -e "$link" ] && [ ! -L "$link" ]; } || is_owned_link; then
    ln -sfn -- "$shim" "$link"
  fi
  break
done

exit 0
