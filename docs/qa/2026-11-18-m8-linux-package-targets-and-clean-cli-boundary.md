# M8 QA — Linux AppImage target selection and clean packaging boundary

**Status at QA capture:** independently verified isolated feature branch `fix/m8-linux-package-target-selection`; integration and hosted CI are evaluated separately.

- Base SHA: `7124b88ead575da0796a9dbe242674173937d6c4` (`main`)
- Reviewed upstream reuse remains pinned to Orca v1.4.214 and the existing Ash provenance ledger.
- M8 release and rollback acceptance remain incomplete; this is a bounded packaging/build correctness slice.

## Problem and correction

The preexisting Linux build entry point always selected AppImage, DEB and RPM together. On the tested Arch host the packaged Electron Builder `fpm` first failed because `libcrypt.so.1` was absent; using the **already cached** Arch compatibility package in a private temporary directory allowed DEB creation, but RPM then required the unavailable `rpmbuild` executable. No system package or library was installed. Independent AppImage builds did not need either optional distro-packaging dependency.

`ASH_LINUX_PACKAGE_TARGETS` now selects a validated, unique comma-separated subset of `AppImage,deb,rpm` for local Linux builds. The existing `pnpm run build:linux` still builds all three targets by default, while the new `pnpm run build:linux:appimage` explicitly builds only AppImage. Unknown, empty and duplicate target selections fail rather than silently dropping packages. Architecture pinning and the `arm64` release environment remain unchanged.

A clean isolated checkout exposed a second packaging defect: `build:cli:assets` compiled the CLI without creating `out/package.json`, even though the Electron after-pack guard requires the **unpacked CommonJS package boundary**. Existing main builds happened to contain a previous generated copy. The asset build now runs the existing `verify-cli-bin.mjs --fix-executable --fix-package-json` step after CLI compilation, without calling `prepare:cli-output` or its side-effecting global development CLI installer. The previously stale Orca package-name assertion in the CLI verifier test was updated to `ash-ide-compiled-output`. The foundation CI package-test step now includes the Linux selector and CLI verifier regressions.

## Actual packaging evidence

- The first ordinary multi-target DEB/RPM attempt stopped at `fpm`'s missing `libcrypt.so.1`. A private extraction of the cached `libxcrypt-compat-4.5.2-1-x86_64` package made the tool's `fpm --version` return `1.17.0`. The tool retry built the DEB and stopped at the separate missing `rpmbuild` prerequisite. The compat library was not installed into host directories.
- Actual built DEB: `dist/ash-ide_0.1.0_amd64.deb`, **152,745,164 bytes**, SHA-256 `ca0cab2c30be68b7eb04ca7b8151e780e49fa3a06361808ad514d9b8e5e2d6bd`. Archive `control` identifies `ash-ide` 0.1.0, amd64, MIT, Ash maintainer/vendor, and the existing Ash GitHub URL.
- The real DEB archive includes `postinst` and `postrm` byte-for-byte identical to the reviewed source hooks (SHA-256 `2e57bcf132f985a69da6e8a39431e929dc6a375b2880f2` and `82bf7cc26b359f3a165117ccf1ec64e35aa6101ec9a688b99131f09590c86b1a`). Archive contents include `ash-ide`, `chrome-sandbox`, `app.asar`, Ash CLI shim and desktop integration. The `com.ashide.desktop.desktop` filename is an intentionally documented identity mapping; see the earlier 2026-11-12 Linux desktop identity review.
- `node config/scripts/desktop-distribution/runtime-verification/verify-linux-package-maintainer-scripts.mjs` — **passed** on a private fixture including install/upgrade/remove, foreign-link preservation and sandbox mode. `node config/scripts/desktop-distribution/linux/linux-package-file-permissions.test.cjs` — **passed** including symlink/hardlink protection and idempotence.
- Exact real DEB/RPM package-manager transactions **not tested** on this Arch host: `dpkg`, `dpkg-deb`, `rpm` and `rpmbuild` are absent. User namespaces are available. Do not equate static fixture success with real package installation or rollback proof.

## Regression and integration evidence

- New target-selection test plus existing Electron Builder configuration and CLI boundary tests: **3 Vitest files, 20 tests passed**. A stale Orca compiled-package-name expectation in the existing CLI verifier test was corrected and the entire regression group added to foundation CI.
- Project TypeScript type-check — **passed**, both directly and during the fresh end-to-end build.
- Oxfmt and Oxlint with deny-warnings on changed source/tests — **passed**.
- Source provenance — **33,506 pinned upstream records, 696 Ash modifications, 8,868 documented removals, pinned MIT hash verified**.
- Full `pnpm run build:linux:appimage` from this isolated checkout — **passed** after the clean-build repair. `build:desktop` included the full type-check, CLI asset generation, Electron/Vite build, and bundled CLI runtime verification (**1,075 closure files / 3 commands**). Native helper ABI and package hygiene checks passed (**4,988 reviewed ASAR entries; 15 native binaries**).
- Both the generated `out/package.json` and the packaged, unpacked `out/package.json` contain `name: ash-ide-compiled-output`, `type: commonjs`, version `0.1.0`, and pinned source commit `7124b88ead575da0796a9dbe242674173937d6c4`. Neither file was present in the fresh checkout before the build.
- Fresh worktree AppImage output: `dist/ash-ide-linux.AppImage`, **220,050,148 bytes**, SHA-256 `ce1f37ac4954a434012307a0d8c8076cdc37f7ee3d17bf29e3dfe4e1040ff3e2`. The selective build emitted **no DEB or RPM artifacts** in this checkout.
- The packaged native X11/Xvfb lifecycle smoke **passed**, including GUI close/reopen while retaining the local runtime and PTY, real window/screenshot pixel checks, and explicit test-owned daemon shutdown. The separate real native Wayland packaged lifecycle smoke **also passed**, retaining the same runtime/PTY across GUI close/reopen and stopping test-owned processes afterwards.

## Remaining M8 release gates

A successful AppImage build is not evidence that Debian/RPM installers, update deferral, authenticated Ash artifact updates, rollback of application **and compatible state**, uninstall preservation, or macOS/Windows packages are accepted. Run actual rootless DEB/RPM transactions on an authorized host with `dpkg`/`rpm` tooling and test rollback before declaring M8 complete. No real user profile, repository, installed Ash/Orca application, or provider account was modified in this slice.
