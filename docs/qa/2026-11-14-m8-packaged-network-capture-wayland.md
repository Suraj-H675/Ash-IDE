# M8 / EX-09 — first-run-through-shutdown packaged network inspection

**Date:** 2026-11-14 (Asia/Kolkata). **Baseline:** canonical `main` at `02377026eaac03ce567aa0e6bdb60c2f7df8e8e0`, clean and synced; GitHub Actions run `43554296027` successful. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `fix/m8-packaged-network-boundary-evidence`. **Pinned source:** independent Orca `55697aec91390357540103f49991458f756b41cc` (MIT).

## Change and safety boundary

- Added `config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-network-audit.sh`: reproducible, bounded, child-process-tree Linux `strace` network-syscall capture around the **existing packaged Wayland lifecycle test**. The wrapper checks tracer operation with an unsuccessful loopback connection first. It never attaches to an existing user application or writes trace logs to Git.
- Extended the existing Wayland lifecycle with an authenticated `settings.get` request while Ash is running; only `{"ok":true,"settingsRead":true}` is recorded, **never** the settings values or provider secrets. Its default mode remains a real GUI/PTY close/reopen and verified test-owned shutdown. Optional `ASH_TEST_CHROMIUM_NETLOG=1` captures Chromium's netlog in the private test fixture. Raw netlog URLs may be sensitive, so they must stay there.
- The recorder uses `-s 0` to prevent recording socket request/response payloads, suppresses port-zero address-selection probes in its endpoint summary, records non-loopback destinations without assuming every outbound socket is analytics, and checks known PostHog hostnames in Chromium's captured host list. This is a **QA-only tooling change**: no product networking, browser, updater, provider, runtime, package or dependency code was changed.

## Concrete environment, artifact and trace

- Arch Linux `7.2.11-arch1-1`, native private KWin Wayland compositor, Electron `43.8.6`. Tested existing source-matched Linux x64 AppImage `dist/ash-ide-linux.AppImage`, **224,358,840 bytes**, SHA-256 **`a7b0e3b6854a53f9a66f85735ce4b60da9a8cf8c808bbb4c281f5c7edd5c50a1`**, previously built and package-hygiene verified at `02377026`.
- The host did not have `strace` installed. The Arch archive `strace-7.2-1-x86_64.pkg.tar.zst` was downloaded to a **private `/var/tmp` directory only**, checked with `pacman-key --verify` (**good full-trust signature from Arch packager Carl Smedstad**) and extracted without installing or modifying system packages. No root or privileged network capture was used.
- An initial attempt to trace the FUSE-mounted AppImage failed before app startup (`fusermount: Operation not permitted` under `ptrace`). This is **not** valid telemetry evidence. The corrected invocation sets `APPIMAGE_EXTRACT_AND_RUN=1` so the same hashed AppImage payload executes without the blocked FUSE mount. Normal, untraced AppImage launch is tested separately.
- Test-owned capture directory: `/var/tmp/ashnet.eHor8m` (mode 0700), corresponding app fixture `/var/tmp/ashwl.MdXKx4` (mode 0700), Chromium netlog file mode 0600. Raw files are **not** staged or published. The capture wrapper returned success with the explicit result `CAPTURED_REQUIRES_ENDPOINT_REVIEW`, **33,599** syscall-trace lines and **9,455** Chromium netlog events.
- Chromium netlog hostnames: `github.com`, `redirector.gvt1.com`, `rr5---sn-gwpa-cage7.gvt1.com`. The Google `gvt1.com` requests have `/edgedl/chrome` path prefixes (Chromium component delivery); GitHub URLs concern the Ash repository, consistent with—but not proving causality for—the Ash updater. No `posthog` or `telemetry` string appeared in Chromium event parameters for this run.
- The syscall trace **also records non-loopback destinations**, notably DNS `100.100.100.100:53` and HTTPS peers `2001:4860:4860::8888`, `2404:6800:4000:1006::71`, `2404:6800:4000:1006::8a`, `2405:200:1630:b07::10` and `64:ff9b::14cf:4952`. Zero-port address-selection probes are excluded from the listed network target summary. The trace includes KWin and other disposable fixture children; it **does not independently attribute every IP connection to Ash** or decode encrypted HTTPS request purpose.
- A read-only inspection of Chromium netlog source dependencies correlated `2405:200:1630:b07::10` with the Google component-download request graph and the `64:ff9b::14cf:4952` NAT64 endpoint with GitHub requests in the first capture. Those source associations do not establish the full meaning of every encrypted connection; they are not a substitute for a security/privacy review of the browser's unsolicited component downloads.
- The traced AppImage lifecycle **PASS**: app PID `235078`, runtime ID `46ba37e8-1987-4513-92d1-b9f99c1cd8c6`, one persistent terminal handle `term_1dd6525f-0aa1-43ae-a6aa-c96063e188b0`, PTY PID `235781`. Real GUI closed/reopened without replacement/duplication; test-owned daemon and runtime stopped.
- After extending the default test, the same AppImage executed **without** `ptrace` and with the normal FUSE runtime: **PASS**, app PID `242306`, runtime ID `aa167da6-5959-41e3-9cc5-b7bc77318a02`, retained terminal handle `term_ed326e5c-5b14-418b-a05b-1a2107585e13`, PTY PID `242935`; owned runtime/daemon stopped. Private fixture `/var/tmp/ashwl.OY3Ydu`.
- **Final revised capture wrapper retest PASS** (post-sanitization and known-PostHog-host assertion): `/var/tmp/ashnet.5P27lF`, with app fixture `/var/tmp/ashwl.nLAo4z`. The same AppImage checksum was asserted, **34,932** syscall-trace lines and **10,994** Chromium netlog events recorded; hostnames were exactly the three above; `knownPosthogHostMatches` was empty. Outcome remained **`CAPTURED_REQUIRES_ENDPOINT_REVIEW`** because legitimate and/or unclassified non-loopback HTTPS destinations were recorded. The separately traced loopback-positive control passed.

## Validation and acceptance limits

- Existing product-telemetry no-transport, retired locale assets and local-only Privacy suite: **6/6 Vitest PASS** in 3 files. Full `pnpm run typecheck`: **PASS**. Both shell scripts: `bash -n` **PASS**. Pinned source provenance: **PASS** (33,506 upstream records, 583 adaptations, 8,567 exclusions, retained MIT license hash).
- Added separate syntax checks for both Linux QA shell scripts to the GitHub foundation workflow; hosted CI for the final integrated commit must be observed separately, not inferred from the earlier successful baseline workflow.
- This is strong dynamic Linux Wayland evidence that **no known PostHog host was observed** in the tested first-run/Settings-read/terminal/close/reopen/shutdown path. It does **not** prove that no telemetry could ever be transmitted on other paths/platforms, nor that all observed external traffic is necessary or non-analytic. The **EX-09 full acceptance gate remains OPEN**, pending review of unclassified HTTPS peers, further deliberate application actions, and platform coverage.
- Chromium's automatic `gvt1.com` component fetch on a clean profile is an observed privacy/product-scope question: do **not** indiscriminately disable browser background services without evaluating impacts on retained Chromium extensions, security and browsing functionality.
- X11, signed cross-platform releases, updater rollback, whole-package exclusion review and authenticated provider journeys remain outside this trace's acceptance boundary.

## Reproduce (in an isolated Arch QA environment)

```bash
ASH_NET_AUDIT_STRACE=/path/to/verified/strace \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-network-audit.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

The driver prints its private evidence directory and a sanitized endpoint summary. It requires matching `dist/linux-unpacked` packaged helper assets, a working native Wayland compositor and the Arch QA stack. Never attach this test to an existing Ash/Orca process or commit the raw network logs.
