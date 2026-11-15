# M8 — real rootless RPM install, upgrade, removal, and third-party ownership

**Date:** 2026-11-15 (Asia/Kolkata). **Baseline canonical `main`:** `7257ff7c95b0f4b925bc5d951f40deb5a171be67`; GitHub Actions [run 43671464883](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43671464883) **completed successfully**. **Branch:** `test/m8-rootless-rpm-and-deb-transactions` in existing isolated worktree `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`. **Source provenance:** Ash independently adapts the pinned read-only Orca reference `55697aec91390357540103f49991458f756b41cc`; MIT license preserved.

## The newly closed release gate

The prior packaging milestone built real AppImage, DEB, and RPM artifacts, checked all RPM header modes and DEB tar modes, executed the extracted RPM CLI, and simulated package maintainer scripts on rewritten paths. **It did not execute an actual RPM installation transaction.** That difference matters: RPM must register the package, execute its real post-install/post-uninstall scripts in the correct target root, replace the installed package, restore the sandbox permission, and avoid deleting user data or another application's CLI link.

This milestone runs the **actual** `rpm --install`, `rpm --upgrade --replacepkgs`, `rpm --erase`, and `rpm -q` commands against an **isolated private RPM database and root**. The RPM's original embedded scripts execute without rewriting their paths. The test is non-root, requires a working `unshare --user --map-root-user --mount --fork`, and passes every RPM invocation `--root <owned-temporary-rootfs> --dbpath /var/lib/rpm`. The scriptlets run in that root's minimal chroot. No system package installation, `sudo`, host `/opt`, host `/usr/bin`, host RPM database, real provider account, GUI profile, or user repository is accessed. A separately downloaded/verified Arch `rpm-tools=6.0.1-2` toolchain and `libxcrypt-compat` lived only under the private `/var/tmp/ash-rpm.uUqnL6/pkgroot`, as recorded in the prior packaging report.

The new opt-in shell harness at `config/scripts/desktop-distribution/runtime-verification/verify-linux-rpm-rootless-install.sh` is reproducible on compatible Linux hosts. It refuses root callers; accepts only a regular absolute `ash-ide` x86_64 RPM; checks the user-namespace capability; creates its own new `0700` test root plus ownership marker; copies a narrowly sufficient shell/coreutils toolchain and host libraries **into** the isolated root rather than binding real filesystem directories; bounds each package transaction; and retains the private fixture for post-test inspection. Its private chroot creation and safety guards are shared with the sibling DEB integration harness in `ash-rootless-linux-package-fixture.sh`. Foundation CI checks harness syntax only, because a clean Ubuntu CI runner does not automatically have an RPM toolchain or unprivileged namespaces. This is not claimed as CI-run transaction coverage.

## Concrete results

**Artifact tested:** `dist/ash-ide-0.1.0.x86_64.rpm`, SHA-256 `66aac0394363c51b4de014cc28238be50af2c9f0ebc93ce8ae06009c0c7923df`, from the preceding hardened three-target build; this QA-only milestone did not rebuild or modify it.

**Manual real-transaction proof** under `/var/tmp/ash-rpm-install.boMU9U/rootfs` (all RPM commands returned exit code 0):

1. Installed RPM into private root; queried actual installed record `ash-ide-0.1.0-1.x86_64`.
2. Observed exact `/usr/bin/ash-ide -> /opt/Ash IDE/resources/bin/ash-ide` inside the root and Chromium helper's actual mode `4755`.
3. Replaced the same RPM with `--upgrade --replacepkgs`; retained original CLI link and sandbox mode, with sentinel user-settings file unchanged.
4. Erased the package using real RPM `--erase`; confirmed app executable and its **owned** CLI link gone, private RPM database no longer reports installed Ash, and user-settings sentinel preserved.
5. Reinstalled while the private root's CLI path was pre-populated by a **different application's dangling symlink**; both real post-install and post-removal preserved it unchanged, while the installed Ash sandbox still received mode `4755`.

**Fresh reproducible harness PASS** on a second owned fixture `/var/tmp/ash-rpm-transaction.j4nrTH` (not just the manual one); the refactored shared-fixture harness is tested independently before integration:

```json
{"status":"PASS","realRpmTransactions":true,"rootlessUserNamespace":true,"dependencyResolution":"bypassed","freshInstall":true,"sameVersionUpgrade":true,"ownedLinkRemoval":true,"userDataRetained":true,"foreignSymlinkPreserved":true,"foreignRegularFilePreserved":true,"sandboxMode4755":true}
```

The harness additionally installed and removed the actual RPM with an unrelated **regular executable** preexisting at `/usr/bin/ash-ide` **inside its disposable root**; the foreign contents remained unchanged. It checks that the AppImage/DEB/RPM packaging fix's installer guards behave through real package-manager lifecycle transactions, not only isolated script invocation. The fixture's user data is test-created at `/home/qa/.config/ash-ide/sentinel` and retained across all transactions.

**Shared-fixture regression PASS**, separate fresh root `/var/tmp/ash-rpm-transaction.W919Hv`: the final source refactor repeated the complete RPM install, same-version upgrade, removal, foreign symlink/regular file and sentinel assertions, returning the same PASS booleans. The sibling DEB harness uses the same private root scaffolding without altering the RPM scriptlet test logic.

## Reproduce

The previously verified isolated toolchain must be in the child process's `PATH`, `LD_LIBRARY_PATH`, and `RPM_CONFIGDIR` (or use an equivalent installed RPM toolchain), while the caller itself is **not root**:

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  bash config/scripts/desktop-distribution/runtime-verification/verify-linux-rpm-rootless-install.sh \
  "$PWD/dist/ash-ide-0.1.0.x86_64.rpm"
```

The harness prints a single JSON PASS result and its test-owned fixture path. It neither removes other fixtures nor mutates/reuses an existing installation root. Environment requirements are independently checked before running installation scripts.

## What this does **not** prove

- **The dependency resolver is deliberately bypassed** (`--nodeps`) in the minimal root, so this is not a real Fedora/RHEL `dnf install` integration test, nor proof of Fedora-version-specific library dependencies, SELinux contexts, signed RPM publication, systemd integration, or a graphical desktop under an installed RPM. Those target-distro gates remain open.
- The test uses unprivileged user-namespace root, not the real host's root account. The `4755` filesystem mode was observed in the isolated root; no privileged host installation occurred.
- The sibling rootless **real dpkg** transaction evidence is documented separately in `2026-11-15-m8-real-rootless-deb-install-reinstall-removal.md`; neither test proves complete target-distribution dependency resolution. Windows/macOS, updater rollback, full exclusions, real provider-authenticated agent lifecycle, and native focused Wayland dialog confirmation remain separate M8 gates.
- Git integration, push, and the **new** exact GitHub Actions run must be observed separately; do not treat the baseline green CI run as passing the new commit.
