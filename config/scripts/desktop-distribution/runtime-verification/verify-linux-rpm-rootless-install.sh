#!/usr/bin/env bash
# Exercise the real RPM database and post-install/post-removal scriptlets, not
# merely a rewritten shell fixture. Nothing is installed onto the host.
# Prerequisites: non-root Linux, user namespaces, rpm, ldd, coreutils, bash.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/ash-rootless-linux-package-fixture.sh"

package="${1:?Usage: verify-linux-rpm-rootless-install.sh /absolute/path/to/ash-ide.rpm}"
ash_require_rootless_package_test
[[ "$package" = /* && -f "$package" && ! -L "$package" ]] || {
  echo 'Supply an absolute path to a regular, locally built RPM file' >&2
  exit 2
}
command -v rpm >/dev/null || { echo 'RPM build tool not available on PATH' >&2; exit 2; }
[[ "$(rpm -qp --nosignature --queryformat '%{NAME}' "$package")" == ash-ide ]] || {
  echo 'Refusing to run installation scriptlets from a package other than ash-ide' >&2
  exit 2
}
[[ "$(rpm -qp --nosignature --queryformat '%{ARCH}' "$package")" == x86_64 ]] || {
  echo 'This test root contains x86_64 host tools; only x86_64 RPM is supported' >&2
  exit 2
}
ash_make_rootless_package_test_root ash-rpm-transaction
mkdir -p "$rootfs/var/lib/rpm"

rpm_in_test_root() {
  ash_assert_rootless_package_test_root
  # unshare gives uid=0 only *inside* the user namespace. rpm's --root
  # chroots its lifecycle scripts into the test-owned, minimal filesystem.
  timeout --kill-after=6s 115s unshare --user --map-root-user --mount --fork \
    rpm --root "$rootfs" --dbpath /var/lib/rpm "$@"
}
assert_installed() {
  [[ -x "$installed_app" && -f "$sandbox" ]] || exit 1
  [[ "$(stat -c %a "$sandbox")" == 4755 ]] || {
    echo 'RPM postinstall did not set Chromium sandbox mode 4755' >&2
    exit 1
  }
  rpm_in_test_root -q ash-ide >/dev/null
  ash_assert_rootless_package_user_data
}
assert_removed() {
  [[ ! -e "$installed_app" ]] || { echo 'Ash binary retained after RPM erase' >&2; exit 1; }
  if rpm_in_test_root -q ash-ide >/dev/null 2>&1; then
    echo 'Ash RPM database entry retained after erase' >&2
    exit 1
  fi
  ash_assert_rootless_package_user_data
}

# 1. Actual clean install, same-version replacement, removal.
rpm_in_test_root --install --nodeps --nosignature "$package" >"$fixture/clean-install.log" 2>&1
assert_installed
[[ "$(readlink "$installed_link")" == "$expected_link" ]] || {
  echo 'Installed Ash CLI symlink did not target the package-owned shim' >&2
  exit 1
}
rpm_in_test_root --upgrade --replacepkgs --nodeps --nosignature "$package" >"$fixture/upgrade.log" 2>&1
assert_installed
[[ "$(readlink "$installed_link")" == "$expected_link" ]] || exit 1
rpm_in_test_root --erase --nodeps ash-ide >"$fixture/clean-remove.log" 2>&1
assert_removed
[[ ! -e "$installed_link" && ! -L "$installed_link" ]] || {
  echo 'RPM removal failed to remove the Ash-owned CLI link' >&2
  exit 1
}

# 2. A different application's dangling CLI link must survive both scripts.
ln -s /opt/unrelated-app/bin/cli "$installed_link"
rpm_in_test_root --install --nodeps --nosignature "$package" >"$fixture/unrelated-install.log" 2>&1
assert_installed
[[ "$(readlink "$installed_link")" == /opt/unrelated-app/bin/cli ]] || exit 1
rpm_in_test_root --erase --nodeps ash-ide >"$fixture/unrelated-remove.log" 2>&1
assert_removed
[[ "$(readlink "$installed_link")" == /opt/unrelated-app/bin/cli ]] || exit 1

# 3. An unrelated regular executable at the CLI path must not be replaced or
# deleted either. This path is created *only* inside the disposable test root.
rm -- "$installed_link"
printf 'not Ash; test-only executable\n' >"$installed_link"
chmod 755 "$installed_link"
rpm_in_test_root --install --nodeps --nosignature "$package" >"$fixture/foreign-file-install.log" 2>&1
assert_installed
[[ "$(cat "$installed_link")" == 'not Ash; test-only executable' ]] || exit 1
rpm_in_test_root --erase --nodeps ash-ide >"$fixture/foreign-file-remove.log" 2>&1
assert_removed
[[ "$(cat "$installed_link")" == 'not Ash; test-only executable' ]] || exit 1

ash_assert_rootless_package_test_root
printf '{"status":"PASS","realRpmTransactions":true,"rootlessUserNamespace":true,"dependencyResolution":"bypassed","freshInstall":true,"sameVersionUpgrade":true,"ownedLinkRemoval":true,"userDataRetained":true,"foreignSymlinkPreserved":true,"foreignRegularFilePreserved":true,"sandboxMode4755":true}\n'
echo "Test-owned fixture: $fixture"
