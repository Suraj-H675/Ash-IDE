# M8 — Packaged PTY smoke respects a safe private temporary directory

**Date:** 2026-11-13 (Asia/Kolkata)

**Base:** `main` at `c865b1a1c3967a9f0a0fbb43541730fab7a0432f`; follow-up to the Codex native-settings write-boundary integration.

## Failure and correction

The post-integration `pnpm run build:linux` built Electron assets, passed the standalone Node build and reached electron-builder's packaged-daemon preflight, but the daemon failed to publish its startup state with an `UNKNOWN: ... write` error. The test helper `runTerminalHostRoundTrip()` hard-coded its scratch directory under `/tmp/oth-`; this host's `/tmp` mount has a per-user quota exhausted despite free space. The same newly packaged Node executable and unpacked daemon entry **passed** the real PTY command/output round trip with an explicitly supplied private `/var/tmp/oth-` test root.

The test helper now respects `os.tmpdir()` (including an explicitly configured `TMPDIR`) when the resulting Unix socket pathname is at most 100 bytes. It falls back to the historical short `/tmp` prefix when a configured path would exceed that limit. Each test still uses `mkdtempSync`, owns its daemon process, and removes only its scratch fixture. This changes the packaging verification harness, not Ash's normal runtime socket selection or provider homes.

## Verification and limitations

- **Red first:** both new scratch-prefix unit tests failed because the resolver did not exist; after implementation **2/2 passed**. Oxfmt, Oxlint and `git diff --check` passed.
- **Real packaged PTY:** the newly unpacked Linux Node executable launched the newly built packaged `daemon-entry.js`, authenticated to its local Unix socket and produced the expected PTY output with the default resolver selecting a private disk-backed `TMPDIR`. The helper reported **PASS** and cleaned up the test-owned daemon/scratch.
- This is not evidence that `build:linux`, the AppImage artifact, or desktop UI succeeded. A complete package build and the private native Wayland AppImage lifecycle check must be re-run against the updated source before any packaged acceptance claim.
