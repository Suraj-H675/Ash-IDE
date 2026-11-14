# M8 / EX-09 — Remove product telemetry transport and release secrets

**Date:** 2026-11-14 (Asia/Kolkata). **Base main:** `f12d0451e7e8a0ccdb6cbf9365e0d750e5672074`; GitHub Actions run `43543393691` completed successfully. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `fix/m8-remove-product-posthog-transport`. Pinned upstream: Orca `55697aec91390357540103f49991458f756b41cc` (MIT).

## Change and compatibility boundary

- Removed the PostHog SDK transport, deferred startup/queue timers, obsolete telemetry client test harness, and unregistered product telemetry IPC endpoint. The main `telemetry/client.ts` module is now an inert, typed compatibility layer for existing event call sites: event tracking returns `false`, analytics-enablement checks return `false`, shutdown resolves safely, and neither initialization nor an opt-in action mutates historical settings.
- Removed `posthog-node` from runtime dependencies and regenerated `pnpm-lock.yaml` offline; the PostHog SDK and its `@posthog` transitive packages are absent from the manifest and lockfile.
- Removed `ORCA_POSTHOG_WRITE_KEY` injection from the Electron main bundle and build-global declarations. The release JavaScript artifact configuration **refuses a supplied PostHog key** in development and stable builds and records a `null` telemetry key fingerprint. Release diagnostics identity and user-triggered local diagnostics remain independent.
- Recorded four removed pinned upstream files and their source hashes in `docs/provenance/ash-exclusions.json`. Historic consent fields, install IDs and user preferences remain on disk; this milestone performs no deletion or migration of saved settings, provider credentials, or repositories.

## Verification executed

- **Red-first tests:** a historically opted-in profile triggered a settings mutation through the old client, and the old PostHog network transport files were present. Both checks failed before implementation and now pass.
- **21/21 targeted tests passed in 7 files**: main no-transport boundary, web bridge returning disabled, quit veto/pending-writer behavior, authenticated runtime registry, previous remote preflight and excluded tracker IPC gates.
- Full repository `pnpm run typecheck` **PASS**; changed-file formatting and lint **PASS**, `git diff --check` **PASS**. Pinned provenance verifies **33,506 source records, 578 Ash adaptations, 8,564 documented exclusions**, MIT license hash unchanged.
- Ran `releaseJavascriptConfiguration` for both development and stable identity: `telemetryKeySha256 === null` in both; an injected `ORCA_POSTHOG_WRITE_KEY` is rejected, including during a development build.
- `pnpm run build:desktop:assets` **PASS**: 257 renderer chunks, 7,799.7 KB minified boot graph; sandbox preload verified, CLI closure **1,221 files / 3 commands**.
- `pnpm run build:orcad` **PASS**: **12.47 MB / 8,041 modules**, zero Electron and `node:sqlite` imports, Node 24.22.1 referenced. `pnpm run build:native` and `pnpm run ensure:electron-runtime` **PASS**.
- Fresh Linux x64 AppImage: `dist/ash-ide-linux.AppImage`, **224,367,151 bytes**, SHA-256 **`640a8a54291fe2539d18dc486a1798b685597ac87aa8803dfbc2f448630432be`**. Package hygiene **PASS**: **5,195 archive entries**, 15 bundled native binaries with Ubuntu 20.04 glibc compatibility, plain-Node daemon entry, bundled Node PTY, two bundled plugin-resource packages.
- Compiled-output scan of `out/main`, `out/preload`, and `out/orcad` for the old PostHog endpoint, SDK import, `telemetry:track`, and `telemetry:setOptIn`: **none found**.
- **Actual AppImage Wayland close/reopen GUI and PTY lifecycle PASS:** app PID `62263`, runtime ID `79917b1e-5af2-4e9c-8671-d08dcff8099b`, terminal handle `term_01b059ec-16d0-440e-9180-7cdddea6f705`, terminal PID `62879` survived GUI closure and reopening. Disposable daemon/runtime stopped; private fixture logs `/var/tmp/ashwl.2WtcRZ`.

## Limits / release gates

- Structural absence of a product telemetry SDK and a package scan are stronger than relying on a disabled flag, **but this is not the final EX-09 acceptance claim**. A separate network-capture run covering first launch, settings, user interaction and shutdown is still needed, alongside whole-package exclusion review.
- Historical telemetry schemas, dormant consent types, and user data compatibility remain for migration safety. Do not claim all inherited product analytics naming or UI copy has been removed.
- X11 on this implementation, Windows/macOS release packages, authenticated coding-provider flows, full visual-parity QA, rollback, and other EX-01–EX-10 checks remain outstanding.
- The implementation was locally verified. The integrated GitHub Actions run must be checked separately after push; its success is not assumed here.
