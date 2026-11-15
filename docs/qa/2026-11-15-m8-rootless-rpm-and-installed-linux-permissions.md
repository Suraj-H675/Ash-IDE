# M8 Linux release-packaging gate — rootless RPM, DEB/RPM install scripts, mode hardening

**Date:** 2026-11-15 (Asia/Kolkata). **Starting canonical main:** `2ba1b060bdc1a080bc04079519948a89dafc15ce` (GitHub Actions `43668673515` observed successful). **Feature branch:** `test/m8-isolated-linux-rpm-package`, isolated worktree `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`. **Orca reference:** independent pinned read-only upstream `55697aec91390357540103f49991458f756b41cc`, MIT license attribution intact. **Build environment:** Arch Linux x64; non-root, no functioning Docker socket and no system `rpmbuild` installation.

## Rootless build toolchain (did not change system packages)

Downloaded official Arch package-manager repositories' `nettle3=3.10.2-2`, `rpm-sequoia=1.10.3-1` and `rpm-tools=6.0.1-2`, each verified against the official `pacman -S --print-format '%h'` SHA-256 before extraction to the **owned temporary** `/var/tmp/ash-rpm.uUqnL6/pkgroot` directory. Reused the already cached, SHA-256-verified official `libxcrypt-compat=4.5.2-1` package and extracted it to that same root: the bundled FPM Ruby needs `libcrypt.so.1`, absent on the Arch host. Scoped `PATH`, `LD_LIBRARY_PATH` and `RPM_CONFIGDIR` only to child build/test processes. `rpmbuild --version` returned **6.0.1**, and FPM Ruby `--version` returned **1.17.0**. No root, Docker daemon, `sudo`, `pacman -S`, system-wide library changes or package installation were used.

The first actual RPM build without security fixes succeeded in generating `ash-ide-0.1.0.x86_64.rpm`, proving that RPM target discovery/build could be unblocked, but an **independent actual artifact audit found blocking issues**:

- RPM metadata said `License: unknown` despite the existing Ash root `LICENSE` (MIT); the root `package.json` omitted `license`.
- Both installed RPM and DEB put the app under `/opt/Ash IDE`, but the preexisting post-install and post-removal scripts searched only `/opt/ash-ide`. Consequently the headless `/usr/bin/ash-ide` symlink and Chromium sandbox permission setup would be skipped. This was a **real installer correctness defect**, not a build-tool failure.
- The unmodified electron-builder extracted tree had **70 entries** with group/other write access (`0777` executable, `0666` resource files). The initial RPM's real `FILEMODES` header confirmed **70** such entries. These modes are inappropriate for a root-installed application because non-root users could replace installed executable/resource content.

## Implemented correction and safety behavior

1. Added `license: MIT` to `package.json` (matching the existing root MIT license and packaged `app.asar` `/LICENSE`). Kept the intentional existing `desktopName: com.ashide.desktop.desktop` and resulting `com.ashide.desktop.desktop` launcher path: Electron strips one `.desktop` suffix to derive the Wayland app ID `com.ashide.desktop`; changing this would break identity.
2. Installer now prefers the actual `/opt/Ash IDE` directory, with exact `/opt/ash-ide` legacy compatibility, applies `chmod 4755` to its Chromium sandbox *only when* the expected packaged CLI shim exists, and creates/updates `/usr/bin/ash-ide` only when the path is absent or already a symlink pointing to an exact owned Ash target. Existing third-party files/symlinks are never overwritten. Post-removal deletes only symlinks with an exact owned target for RPM `0` / Debian `remove|purge`, not on upgrades.
3. Added `linux-package-file-permissions.cjs` to the Linux `afterPack` hook, following executable resource staging but **before all distribution targets**. It scans the copied output via `lstat`, does not follow symlinks, refuses special files, and refuses a writable multiply-linked file **before doing any chmod**, avoiding accidental changes to hardlinked source packages. It strips group/world write bits, preserves execute bits and performs an independent post-write rescan. The real build logged **70 corrected entries / 6,986 files/directories independently verified / 0 symlinks**.
4. Added standalone private-filetree regression tests for package scripts and file-mode behavior; foundation CI runs them and validates the maintainer shell syntax. The installer test rewrites every absolute target path into a fixture-owned mode-0700 directory with explicit path-verification guards; never runs the real package script against the host `/usr/bin` or `/opt`. Tests covered fresh install, idempotency, sandbox mode, unrelated symlinks/files, legacy symlink upgrade, RPM/DEB uninstall and upgrade, missing shim, permission normalization/idempotency, external symlinks, and hardlink fail-before-mutate.

## Final production-source build and actual archive inspection

**PASS** `pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage deb rpm --x64` with the isolated private toolchain and `TMPDIR=/var/tmp`, after the fixes. No target was skipped. Package hygiene verified **5,195 ASAR entries**, 15 target-architecture native binaries against the Ubuntu 20.04 glibc floor, the plain-Node daemon entrypoint, Node-served PTY and 2 required bundled plugin bundles. Final **unsigned/unpublished** artifacts:

| Artifact | SHA-256 |
|---|---|
| `dist/ash-ide-linux.AppImage` | `83e727d968d0038986af61180449102806483753cb4ce4668d69f0a957788150` |
| `dist/ash-ide_0.1.0_amd64.deb` | `126f6ee6723ff1b9c61b52bf486a7114a1a11db14f0f2c23d5e82ff4b2cc3f4e` |
| `dist/ash-ide-0.1.0.x86_64.rpm` | `66aac0394363c51b4de014cc28238be50af2c9f0ebc93ce8ae06009c0c7923df` |

**Actual final RPM header, not an inferred staged-tree check:** `Name ash-ide`, `Version 0.1.0-1`, `Arch x86_64`, `License MIT`, `Vendor Ash IDE`, expected repository URL. Exactly **6,529 RPM `FILEMODES` records, zero group/world-writable entries**. All three installed `ash-ide`, `chrome-sandbox` and CLI shim under `/opt/Ash IDE` have `0755` packaged modes, with postinstall `chmod 4755` intentionally deferred to installation. RPM includes `gtk3`, `libnotify`, `python3`, `python3-gobject`, `xorg-x11-server-Xvfb` dependencies; bundled AppImage-only Node is absent from installed RPM. Verified actual embedded RPM postinstall/uninstall scripts reference the correct path and narrowly managed symlink. The launcher filename is `com.ashide.desktop.desktop` per the source identity convention.

**Actual final DEB control/payload**, independently extracted from its `.deb` ar archive: `Package ash-ide`, `Version 0.1.0`, `Architecture amd64`, `License MIT`, `Depends` includes `libnotify4` **and** `libnotify-bin`. Both embedded `postinst` and `postrm` scripts are corrected. The real `data.tar.xz` member listing showed **7,019 members with zero group/world-writable entries**, including `0755` for the app binary, sandbox and CLI shim, and `0644` desktop entry. Package archives were inspected but **not installed on the user system**.

**New hardened AppImage real native X11 PASS** `/var/tmp/ashx11.U4VwbH`: native Xvfb, packaged browser click/evaluation/navigation, real OSC 52 clipboard, GUI close/reopen with identical app PID **`669537`**, runtime ID **`7fd7f9fd-f233-4eca-bfe2-423b53cded68`**, terminal handle **`term_5050398f-247d-4bf7-b3d0-d6fa95dc4a49`**, live PTY PID **`670190`**. Explicit test-owned daemon/runtime shutdown succeeded.

**New hardened AppImage real native Wayland PASS** `/var/tmp/ashwl.mrxL7I`: private virtual KWin session, authenticated Claude-format post-GUI-close hook, real private D-Bus agent completion notification, durable `claude/done` status, original app PID **`671606`**, runtime ID **`a9f28b2f-410b-443f-90a8-219ca0083751`**, terminal handle **`term_b29201b0-d6aa-4054-8052-cfcbfcd490a8`**, live PTY PID **`672118`** preserved across GUI close/reopen. Test-owned daemon/runtime and compositor shutdown succeeded; no real provider account was touched.

## Acceptance boundary and remaining gates

**M8 local Linux package generation and installed-file-mode release checks: PASS** on Arch using the private toolchain; this materially improves the previously BLOCKED RPM target. These are not proof of a real `rpm -i` transaction on Fedora/RHEL nor actual `dpkg -i` on Ubuntu/Debian; package manager integration, SELinux and dependency resolution on those systems remain unverified. Host `rpmbuild` remains uninstalled outside the private test root; shipping CI should install an appropriate pinned distro toolchain or run a supported container before release. Sandbox setuid behavior is validated by test-owned simulation but not by a privileged real package installation. No package signing, publishing, cross-platform release, updater rollback, or real paid provider-agent lifecycle was attempted. The prior RT-12 controlled-hook Linux X11/Wayland evidence remains valid; M8 overall still open.

Git integration, main post-integration tests, GitHub push and **new exact CI result** require separate observed evidence; the preceding run `43668673515` is **not** claimed for the new changes. All rootless toolchain downloads/extractions and raw smoke artifacts remain outside Git under owned `/var/tmp` directories.

## Reproduce without installing on the host

Once `rpmbuild` and its required libraries are available in an isolated child `PATH`/`LD_LIBRARY_PATH`/`RPM_CONFIGDIR`:

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  pnpm exec electron-builder --config config/electron-builder.config.cjs \
  --linux AppImage deb rpm --x64

node config/scripts/desktop-distribution/linux/linux-package-file-permissions.test.cjs
node config/scripts/desktop-distribution/runtime-verification/verify-linux-package-maintainer-scripts.mjs
```

For an installed release, separately verify real post-install and removal behavior on clean, disposable Ubuntu/Fedora images before accepting the distribution target.
