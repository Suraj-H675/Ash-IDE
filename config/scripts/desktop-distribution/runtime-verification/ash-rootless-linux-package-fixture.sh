#!/usr/bin/env bash
# Sourced only by the opt-in real RPM and DEB transaction QA scripts. Build an
# entirely disposable chroot with just the maintainer-script shell/toolchain.
# Do not mount or reuse the host's /opt, /usr/bin, or package database.

ash_require_rootless_package_test() {
  [[ "$(uname -s)" == Linux && "$(id -u)" != 0 ]] || {
    echo 'Rootless package tests require a non-root Linux caller' >&2
    exit 2
  }
  for tool in unshare timeout mktemp stat ldd awk cp chmod mkdir readlink ln rm cat dirname; do
    command -v "$tool" >/dev/null || {
      echo "Missing rootless-package test tool: $tool" >&2
      exit 2
    }
  done
  unshare --user --map-root-user --mount --fork true || {
    echo 'Unprivileged user/mount namespaces are unavailable' >&2
    exit 2
  }
}

ash_make_rootless_package_test_root() {
  local prefix="$1"
  case "$prefix" in
    ash-rpm-transaction | ash-deb-transaction) ;;
    *) echo 'Invalid Ash package fixture prefix' >&2; exit 2 ;;
  esac
  umask 077
  fixture="$(mktemp -d "/var/tmp/$prefix.XXXXXX")"
  rootfs="$fixture/rootfs"
  mkdir -p "$rootfs"/{bin,usr/bin,usr/lib,lib64,opt,etc,dev,var/lib,tmp,home/qa/.config/ash-ide}
  chmod 1777 "$rootfs/tmp"
  printf 'Owned Ash package transaction fixture: %s\n' "$(id -u)" >"$fixture/.ash-rootless-package-qa"
  ash_assert_rootless_package_test_root

  # The real package manager chroots its scripts. Copy only the trusted local
  # binaries and their libraries into the fixture. Avoid following any symlink
  # back into the user's real filesystem from the chroot.
  local name binary ldd_output library
  for name in bash chmod readlink ln rm; do
    binary="$(command -v "$name")"
    [[ "$binary" == /* ]] || { echo "Non-absolute test binary: $name" >&2; exit 2; }
    mkdir -p "$rootfs$(dirname "$binary")"
    cp -L -- "$binary" "$rootfs$binary"
    ldd_output="$(ldd "$binary")"
    [[ "$ldd_output" != *'not found'* ]] || {
      echo "Missing host library for $name" >&2
      exit 2
    }
    while IFS= read -r library; do
      [[ -f "$library" ]] || { echo "Missing dynamic library: $library" >&2; exit 2; }
      mkdir -p "$rootfs$(dirname "$library")"
      if [[ ! -f "$rootfs$library" ]]; then
        cp -L -- "$library" "$rootfs$library"
      fi
    done < <(printf '%s\n' "$ldd_output" | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^\//) print $i}')
  done
  [[ -x "$rootfs/usr/bin/bash" ]] || {
    echo 'Test root requires /usr/bin/bash (including the /bin/bash interpreter)' >&2
    exit 2
  }
  ln -s /usr/bin/bash "$rootfs/bin/sh"
  ln -s /usr/bin/bash "$rootfs/bin/bash"

  sentinel="$rootfs/home/qa/.config/ash-ide/sentinel"
  printf 'Ash test-owned user data: preserve across package transactions\n' >"$sentinel"
  chmod 600 "$sentinel"
  installed_link="$rootfs/usr/bin/ash-ide"
  installed_app="$rootfs/opt/Ash IDE/ash-ide"
  sandbox="$rootfs/opt/Ash IDE/chrome-sandbox"
  expected_link='/opt/Ash IDE/resources/bin/ash-ide'
}

ash_assert_rootless_package_test_root() {
  [[ -f "$fixture/.ash-rootless-package-qa" &&
     "$(cat "$fixture/.ash-rootless-package-qa")" == "Owned Ash package transaction fixture: $(id -u)" &&
     "$(stat -c %u "$fixture")" == "$(id -u)" &&
     "$(stat -c %a "$fixture")" == 700 &&
     -d "$rootfs/var/lib" ]] || {
    echo 'Rootless package fixture marker/ownership validation failed' >&2
    exit 1
  }
}

ash_assert_rootless_package_user_data() {
  [[ -f "$sentinel" && "$(cat "$sentinel")" == \
     'Ash test-owned user data: preserve across package transactions' ]] || {
    echo 'A package transaction unexpectedly altered test-owned user data' >&2
    exit 1
  }
}
