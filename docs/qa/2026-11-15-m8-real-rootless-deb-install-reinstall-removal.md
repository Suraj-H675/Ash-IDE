# M8 — actual DEB/dpkg install, reinstall, remove and purge, without host installation

**Date:** 2026-11-15 (Asia/Kolkata). **Baseline main:** `7257ff7c95b0f4b925bc5d951f40deb5a171be67`, exact CI run `43671464883` **success**. **Isolated branch/worktree:** `test/m8-rootless-rpm-and-deb-transactions` at `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`; the same branch also contains the real RPM transaction harness. Orca reference remains pinned, separate, and read-only at `55697aec91390357540103f49991458f756b41cc`, with MIT provenance intact.

## Why this matters

Earlier source changes corrected the packaged DEB's real installation directory (`/opt/Ash IDE` rather than `/opt/ash-ide`), set `license: MIT`, preserved unrelated CLI ownership and hardened all installed archive members against group/world writes. That package was previously **inspected**, not actually installed by `dpkg`. Its maintainer scripts must be tested as package-manager transactions, including proper registration, upgrade/removal semantics, and no unapproved deletion of user data or other application files.

## Rootless test boundary

Used the official Arch Linux repository `dpkg=1.23.11-1` tool (`dpkg` and `dpkg-deb`) extracted into owner-only `/var/tmp/ash-dpkg-tools.J90uNj`, not installed system-wide. Verified the downloaded `.pkg.tar.zst` against package-manager SHA-256 `47780df7542be2198013106a79d821b62e082462d4ebb8fdc9b527519cc2a63c`. The actual packaged artifact was **the already built, unmodified** `dist/ash-ide_0.1.0_amd64.deb` with SHA-256 `126f6ee6723ff1b9c61b52bf486a7114a1a11db14f0f2c23d5e82ff4b2cc3f4e`.

Executed real `dpkg --root=<private-rootfs> --force-depends --no-triggers` commands **inside a non-root user/mount namespace**. `--root` directs both installed files and `/var/lib/dpkg` registration to the test-only filesystem; it chroots maintainer scripts. No bind mounts to the host's `/usr`, `/opt`, `/home` or live package database; no `sudo`, Docker daemon, user-owned repo/profile, or real provider account was touched. Dependency verification is deliberately bypassed because this minimal root contains only the Bash interpreter, script helpers, selected dynamic libraries, and a fake test-owned user-settings sentinel, not a full Ubuntu/Debian distribution. The package itself and both embedded scriptlets are unmodified.

## Observed package-manager evidence

The first manual `/var/tmp/ash-deb-install.6mcRm2` invocation actually unpacked the package, but the configure stage failed because the deliberately minimal test root initially lacked `/bin/bash` (the DEB postinst shebang). Adding **only this missing private chroot interpreter** allowed `dpkg --configure ash-ide` to pass. The eventual shared fixture now supplies both `/bin/sh` and `/bin/bash` before any package operation. This was a test-environment omission rather than an Ash source fix.

Observed on the corrected manual test: `dpkg --status ash-ide` returned **`Status: install ok installed`** and version `0.1.0`; the real postinst created `/usr/bin/ash-ide -> /opt/Ash IDE/resources/bin/ash-ide` and changed the installed `chrome-sandbox` to `rwsr-xr-x` (`4755`). A same-version `dpkg --install` replacement succeeded; `dpkg --remove ash-ide` removed the packaged executable and owned link while leaving the test-owned settings sentinel unchanged. Reinstalling while the private `/usr/bin/ash-ide` was a dangling foreign symlink left it intact through both install and removal. No unexpected host effects were observed.

**Fresh reproducible harness PASS** on `/var/tmp/ash-deb-transaction.VDmYBs` via the new `config/scripts/desktop-distribution/runtime-verification/verify-linux-deb-rootless-install.sh`:

```json
{"status":"PASS","realDpkgTransactions":true,"rootlessUserNamespace":true,"dependencyResolution":"bypassed","freshInstall":true,"sameVersionReinstall":true,"ownedLinkRemoval":true,"userDataRetained":true,"foreignSymlinkPreserved":true,"foreignRegularFilePreserved":true,"sandboxMode4755":true,"purgePreservedUserData":true}
```

The harness separately tested installing **with a foreign regular executable at the same CLI path** and then `dpkg --purge ash-ide`. It verified that this test-owned foreign file stayed untouched and user data remained intact. No real host CLI or user data was removed. The harness shares a fail-closed owner/marker-checked `0700` rootfs initializer with the RPM harness rather than duplicating the namespace and library-staging code. Foundation CI checks both harnesses and the shared helper for shell syntax, but **does not execute package transactions without a suitable private toolchain/user namespace**.

## How to reproduce

Once `dpkg` and `dpkg-deb` are available in a private child `PATH` and `DPKG_DATADIR` points at their isolated metadata directory (or equivalent supported installation), run **as a non-root user**:

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  bash config/scripts/desktop-distribution/runtime-verification/verify-linux-deb-rootless-install.sh \
  "$PWD/dist/ash-ide_0.1.0_amd64.deb"
```

The script prints one machine-readable PASS result and its owned test-root path. It does not accept a caller-supplied install root, and all package operations are bounded. It intentionally retains the private fixture for inspection.

## Remaining release acceptance

**Real DEB/dpkg transaction safety: PASS in the isolated root**. This is not equivalent to installing on stock Ubuntu/Debian with real package dependency resolution, desktop integration, systemd, mandatory access controls, or real root. The same limitation applies to the rootless RPM proof; see `2026-11-15-m8-real-rootless-rpm-install-upgrade-removal.md`. Linux AppImage native Wayland/X11 tests and source package/provenance checks were separately accepted in the preceding packaging milestone. Native target-distro full installation, macOS/Windows, updater rollback, excluded-bundle final audit, and real provider-agent notifications remain open.

This QA-only milestone did not rebuild, sign, upload or publish packages, and does not alter product source. The final integrated commit, post-merge tests, push and **new** exact GitHub CI result require independent observation; the baseline `43671464883` success is not a claim about these new files.
