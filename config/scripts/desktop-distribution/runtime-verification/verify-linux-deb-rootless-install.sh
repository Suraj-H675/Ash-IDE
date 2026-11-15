#!/usr/bin/env bash
# Exercise original DEB scripts through real dpkg transactions in an owned,
# minimal chroot. This is *not* a full Debian/Ubuntu dependency-resolver test.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/ash-rootless-linux-package-fixture.sh"

package="${1:?Usage: verify-linux-deb-rootless-install.sh /absolute/path/to/ash-ide.deb}"
ash_require_rootless_package_test
[[ "$package" == /* && -f "$package" && ! -L "$package" ]] || {
  echo 'Supply an absolute path to a regular, locally built DEB file' >&2
  exit 2
}
for tool in dpkg dpkg-deb grep; do
  command -v "$tool" >/dev/null || { echo "Missing DEB test tool: $tool" >&2; exit 2; }
done
[[ "$(dpkg-deb --field "$package" Package)" == ash-ide &&
   "$(dpkg-deb --field "$package" Architecture)" == amd64 ]] || {
  echo 'Refusing to run scripts from an unexpected package/architecture' >&2
  exit 2
}

ash_make_rootless_package_test_root ash-deb-transaction
mkdir -p "$rootfs/var/lib/dpkg"/{info,updates,triggers}
: >"$rootfs/var/lib/dpkg/status"

dpkg_in_test_root() {
  ash_assert_rootless_package_test_root
  # dpkg's --root changes both installation and administration/database paths.
  # Maintainer scripts execute from /var/lib/dpkg/info *inside* the chroot.
  timeout --kill-after=6s 115s unshare --user --map-root-user --mount --fork \
    dpkg --root="$rootfs" "$@"
}
assert_installed() {
  [[ -x "$installed_app" && -f "$sandbox" ]] || exit 1
  [[ "$(stat -c %a "$sandbox")" == 4755 ]] || {
    echo 'DEB postinstall did not set Chromium sandbox mode 4755' >&2
    exit 1
  }
  dpkg_in_test_root --status ash-ide | grep -Fqx 'Status: install ok installed' || {
    echo 'DEB package database lacks installed Ash state' >&2
    exit 1
  }
  ash_assert_rootless_package_user_data
}
assert_removed() {
  [[ ! -e "$installed_app" ]] || { echo 'Ash binary retained after DEB removal' >&2; exit 1; }
  if dpkg_in_test_root --status ash-ide 2>/dev/null |
      grep -Fqx 'Status: install ok installed'; then
    echo 'DEB package database still reports installed Ash' >&2
    exit 1
  fi
  ash_assert_rootless_package_user_data
}

# 1. Fresh real dpkg installation, same-version reinstall (scriptlet upgrade
# path), and removal. --force-depends is essential in the deliberately tiny root.
dpkg_in_test_root --force-depends --no-triggers --install "$package" >"$fixture/clean-install.log" 2>&1
assert_installed
[[ "$(readlink "$installed_link")" == "$expected_link" ]] || {
  echo 'DEB postinst did not create the package-owned CLI link' >&2
  exit 1
}
dpkg_in_test_root --force-depends --no-triggers --install "$package" >"$fixture/reinstall.log" 2>&1
assert_installed
[[ "$(readlink "$installed_link")" == "$expected_link" ]] || exit 1
dpkg_in_test_root --force-depends --no-triggers --remove ash-ide >"$fixture/clean-remove.log" 2>&1
assert_removed
[[ ! -e "$installed_link" && ! -L "$installed_link" ]] || {
  echo 'DEB postrm failed to remove the Ash-owned CLI link' >&2
  exit 1
}

# 2. Another application's dangling CLI link is not Ash-owned.
ln -s /opt/unrelated-app/bin/cli "$installed_link"
dpkg_in_test_root --force-depends --no-triggers --install "$package" >"$fixture/unrelated-install.log" 2>&1
assert_installed
[[ "$(readlink "$installed_link")" == /opt/unrelated-app/bin/cli ]] || exit 1
dpkg_in_test_root --force-depends --no-triggers --remove ash-ide >"$fixture/unrelated-remove.log" 2>&1
assert_removed
[[ "$(readlink "$installed_link")" == /opt/unrelated-app/bin/cli ]] || exit 1

# 3. Likewise preserve another application's regular executable on both
# installation and DEB purge. This is a *test-owned* file in the chroot only.
rm -- "$installed_link"
printf 'foreign test-only CLI\n' >"$installed_link"
chmod 755 "$installed_link"
dpkg_in_test_root --force-depends --no-triggers --install "$package" >"$fixture/foreign-file-install.log" 2>&1
assert_installed
[[ "$(cat "$installed_link")" == 'foreign test-only CLI' ]] || exit 1
dpkg_in_test_root --force-depends --no-triggers --purge ash-ide >"$fixture/foreign-file-purge.log" 2>&1
assert_removed
[[ "$(cat "$installed_link")" == 'foreign test-only CLI' ]] || exit 1

ash_assert_rootless_package_test_root
printf '{"status":"PASS","realDpkgTransactions":true,"rootlessUserNamespace":true,"dependencyResolution":"bypassed","freshInstall":true,"sameVersionReinstall":true,"ownedLinkRemoval":true,"userDataRetained":true,"foreignSymlinkPreserved":true,"foreignRegularFilePreserved":true,"sandboxMode4755":true,"purgePreservedUserData":true}\n'
echo "Test-owned fixture: $fixture"
