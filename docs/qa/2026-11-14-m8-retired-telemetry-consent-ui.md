# M8 / EX-09, EX-10 — Retire the leftover telemetry consent UI

**Date:** 2026-11-14 (Asia/Kolkata). **Base main:** `7ed496e97a4fdc7109f2e33dd2ac846168979cfb`; GitHub Actions run `43545687058` completed successfully. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `fix/m8-retire-stale-telemetry-consent-ui`. **Pinned Orca reference:** `55697aec91390357540103f49991458f756b41cc` (MIT).

## Change and compatibility boundary

- Removed the unmounted legacy first-launch telemetry consent banner and surface, including the historical opt-in/acknowledge actions and upstream Orca telemetry-policy URL. Removed their now-unused functions from the typed renderer telemetry compatibility module.
- Removed the dashboard's analytics-only event hook and its window-visibility sampling interval; the actual in-window and pop-out dashboard snapshots, controls and lifecycle remain.
- Updated the live Settings navigation and Privacy pane header to **Privacy & Diagnostics**, describing local diagnostic review rather than anonymous usage collection. The existing local create/review/discard diagnostics controls remain.
- Preserved historical consent fields in saved settings and the fail-closed preload compatibility bridge; no profile migration, account mutation, provider-hook change or repository write was performed. Recorded three removed upstream files and refreshed current source hashes in the provenance manifests.

## Actual verification

- **7/7 targeted Vitest tests passed** across four files (renderer privacy navigation and controls, web no-telemetry bridge, main no-product-transport). The added negative test checks local-only Settings metadata and absence of retired renderer entrypoints.
- Full `pnpm run typecheck` **PASS**; changed-file Oxfmt, Oxlint, `git diff --check` **PASS**. Pinned provenance **PASS**: 33,506 original source records, 582 Ash adaptations, 8,567 documented exclusions, original Orca MIT license hash retained.
- `pnpm run build:desktop:assets` **PASS**: 257 renderer chunks, 7,798.6 KB boot graph, sandbox preload, CLI closure 1,221 files / three commands. Compiled renderer JavaScript scan found **no** `FirstLaunchBanner`, `TelemetryFirstLaunchSurface`, `useAgentDashboardTelemetry` or upstream telemetry-policy URL.
- `pnpm run build:native` and `pnpm run ensure:electron-runtime` **PASS**. First `electron-builder` attempt failed with OS error `-122` (the user-quota-limited `/tmp` tmpfs). A single retry with `TMPDIR=/var/tmp` succeeded; no unrelated build caches or worktrees were deleted.
- Linux x64 AppImage **PASS**: `dist/ash-ide-linux.AppImage`, **224,367,070 bytes**, SHA-256 **`89ec55d7d8da4a10ccd3dd96bd28e9e1aa11b1d2460962e64296ff4c82f91cfc`**. Packaged hygiene: **5,195 ASAR entries**, 15 native binaries meeting the configured glibc floor, plain-Node daemon entry and bundled Node PTY **PASS**.
- Fresh isolated native Wayland AppImage close/reopen test **PASS**: app PID `98976`, runtime ID `97307a79-c162-4754-a958-c064cd56e5f1`, terminal handle `term_1ae0b947-6e07-4dfb-bedb-807502478c82`, PID `99577` persisted across last-window closure and reopen. Test-owned runtime and daemon stopped. Private fixture evidence: `/var/tmp/ashwl.09QTcY`.

## Remaining gates

- Some obsolete telemetry and consent *translation strings* still exist in inert packaged locale JSON assets; the removed UI is absent from executable renderer chunks. This does **not** establish final whole-package EX-09/EX-10 acceptance.
- `pnpm run verify:localization-catalog` **FAIL**: 17 missing keys in untouched pre-existing code-host/onboarding/settings/menu sources. This task did not rewrite unrelated catalogs or claim that localization gate passed.
- Final first-run-to-shutdown network-capture evidence, full exclusion bundle audit, X11, update/rollback, multi-platform release checks, complete visual parity and broader agent-provider E2E remain separate requirements. This is an independently tested M8 reduction, **not** a release-ready declaration.
