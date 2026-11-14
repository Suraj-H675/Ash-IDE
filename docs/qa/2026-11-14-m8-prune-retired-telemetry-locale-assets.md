# M8 / EX-09, EX-10 — remove orphaned product-telemetry locale assets

**Date:** 2026-11-14 (Asia/Kolkata). **Base:** `main` at `5606335bb0d6b2294c6e11d0c1706b3d17513d08`, clean and synced. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `fix/m8-prune-orphan-telemetry-copy`. **Source:** pinned Orca `55697aec91390357540103f49991458f756b41cc`, MIT with original notice retained.

## Exact scope and preserved compatibility

- Removed **32 retired product-telemetry translation leaves from each of 11 desktop catalogs (352 total)**: the old opt-in first-launch banner, removed opt-in Privacy pane, outdated Settings/nav captions, obsolete PostHog/telemetry search words and disabled-telemetry diagnostic notices. No active UI source has a direct reference to those removed keys; the retired first-launch surface and dashboard tracking hook were deleted in the preceding M8 slice.
- Removed three matching handwritten `Privacy & Telemetry` string overrides from `config/scripts/locale-catalog/locale-value-overrides.mjs`. Added a negative regression test to the retained renderer exclusion tests in GitHub Actions.
- **Deliberately preserved** local diagnostics labels, redaction/review functionality, native provider account/session behavior, local mobile emulators, browser viewport presets, and the retained Codex history-sharing search keyword `auto.components.settings.privacy.search.ead1deded2`. The last key is indirectly consumed as an object property in `codex-history-sharing-copy.ts`, so a naive all-privacy-search-key deletion would break it despite the source extractor reporting no direct `translate()` reference.
- Every catalog retains existing two-space JSON formatting and ordering of all remaining entries. Historical consent *data* is not migrated/deleted, and no provider account, user repository, profile, browser data or installed app configuration was touched.
- Updated provenance hashes for adapted upstream locale files and the existing override module. Original source and MIT notice inventory unchanged; no new upstream exclusions were needed because no source files were deleted.

## Verification performed

- Red-first new test: **2/2 FAIL** on previously present obsolete catalog keys and override values. After changes, it passed alongside retained phone-localization and local-only privacy suites: **8/8 PASS in 4 test files**.
- `pnpm run verify:localization-catalog`: **PASS**, **19,991 source references** verified; all 11 catalogs valid, with English reference baseline reduced by exactly 32 formerly unused entries from 18,780 to 18,748.
- `node config/scripts/provenance/verify-source-ledger.mjs --write-modifications` and independent verification: **PASS**, **33,506 upstream records**, **583 adapted source hashes**, **8,567 documented exclusions**, unchanged Orca MIT notice SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Changed-file JSON/YAML/TS formatting: **PASS**; targeted test lint with `--deny-warnings`: **PASS** after correcting the new test's mandatory-braces lint finding.
- The English catalog contains no remaining literal `telemetry`, `posthog` or retired anonymous-usage opt-in copy, and the deleted `Privacy & Telemetry` override values are absent.
- Full `pnpm run typecheck`: **PASS**. `pnpm run build:desktop:assets`: **PASS** (257 renderer chunks; 7,798.6 KB boot graph; sandbox preload and 1,221-file / three-command CLI closure). Existing dynamic-import advisory warnings remain.
- After the clean desktop rebuild, scanning compiled renderer JavaScript and JSON found **no** old Privacy & Telemetry heading, telemetry banner/opt-in copy or retired usage-analytics wording.
- `pnpm run build:native`, `pnpm run ensure:electron-runtime`, and `electron-builder --linux AppImage --x64` with disk-backed `TMPDIR=/var/tmp`: **PASS**. Fresh `dist/ash-ide-linux.AppImage`: **224,358,840 bytes**, SHA-256 **`a7b0e3b6854a53f9a66f85735ce4b60da9a8cf8c808bbb4c281f5c7edd5c50a1`**. Packaged hygiene: **5,195 reviewed ASAR entries**, **15 compatible native binaries**, plain-Node daemon entry, bundled Node PTY and two required bundled plugin resources **PASS**.
- Independently read **993 actual packaged renderer JavaScript/JSON assets from `dist/linux-unpacked/resources/app.asar`**: **zero** matches for retired Privacy & Telemetry heading, consent banner, anonymous usage opt-in or feature-prioritization copy.
- Real native Wayland AppImage close/reopen GUI/PTY lifecycle: **PASS**. App PID `195962`, runtime ID `27df0a1e-bb37-4542-ae25-b038aeb9cdfc`, persistent terminal handle `term_4ba3fa65-0ea2-458b-aac2-50d6b38a3a50` and PTY PID `196659`, with no duplicate after reopen. Test-owned daemon/runtime stopped; private fixture `/var/tmp/ashwl.XJpu6b`.

## Limits

- Retired locale text absence does **not** prove the app makes no analytics network requests. EX-09 still requires a monitored first-launch-to-shutdown run and whole-package inspection. It also does not imply other unrelated inherited Orca or removed-product strings are absent from all assets.
- This is intentionally an English-only product; compatibility copies in other languages do not represent a commitment to maintain a language switcher.
- Native X11, other localization validators, update/rollback, broad provider journeys, macOS/Windows native release tests and exact integrated CI are independent gates. Do not mark full M8 or release acceptance from this narrow removal.
