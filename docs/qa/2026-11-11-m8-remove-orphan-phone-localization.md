# M8 — remove orphan phone UI localization while preserving the local emulator

**Date:** 2026-11-11 (Asia/Kolkata).

**Integration workflow:** Single-writer, direct-to-`main` on the existing clean canonical checkout `/home/suraj/projects/Ash-IDE`, based on previously accepted SHA `444e597a5aa0c732ee5632f0913d648129355c87`. No new branch, worktree or repository. This differs from the preceding M8 slices at the user's request to avoid unnecessary feature branches; hosted CI can only verify this commit **after** its normal, non-force main push.

## Source, localization and product boundaries

- Removed **3,092 orphaned phone-facing translation leaves** across all eleven shipped renderer locale catalogs (292 English entries and 280 per other locale). The removed subtrees belong to the previously deleted Orca phone landing/carousel and phone-only mobile Settings, network/pairing setup, relay beta notice and mobile pane/settings search.
- Removed **31 unused Korean key-override entries** and **three matching handcrafted cross-locale override entries**. Existing unrelated override keys and translations retain their original values and order.
- **Preserved** local Android/iOS emulator settings and search strings under `auto.components.settings.mobile.emulator`, `MobileEmulatorSettingsPane` and other `MobileEmulator*` namespaces; retained the shared `MobileBrandIcons.tsx` component and five emulator Settings modules.
- **Preserved** responsive browser viewport presets (`browser.viewport.mobile-*`), terminal overlay labels, active remote pairing-generator fragments and local E2EE browser-session strings; these have distinct remaining source consumers. This is not a blanket removal of every occurrence of “mobile” or “pairing”.
- Added `src/renderer/src/i18n/ash-excluded-phone-locales.test.ts`: the shipped eleven-locale inventory and exact dead-key absence, positive checks for emulator and viewport entries, and absence of removed keys in override files. Registered the focused test in `.github/workflows/foundation.yml`.
- Original pinned Orca source provenance retained: this change **modifies** eleven upstream-derived locale JSON files and the source hash ledger but deletes **zero** upstream source files. No new exclusion entries or license changes.
- No user repository, provider identity/credential, browser partition, historical device record, installed app configuration or other application's data was modified. Test-owned Wayland profile isolated all HOME/XDG/Git/Codex/Claude/GH data.

## Observed local verification

- Focused locale/excluded phone entry point/desktop mobile-named overlay: **7/7 tests PASS across 3 suites**.
- Expanded retained local E2EE, WebSocket auth/refusal, terminal/PTYS, agent launch/replay, historically paired device cleanup, renderer/preload exclusions and new locale gate: **246/246 tests PASS across 33 suites**. The inherited agent-launch tests emit known nonfatal stale-terminal and optional mobile-tab-selection warnings, but no test failed.
- Full TypeScript projects: **PASS**. Changed test Oxfmt, native Oxlint and type-aware Oxlint with `--deny-warnings`: **PASS**, zero lint warnings/errors. JSON files retain existing two-space/one-trailing-newline formatting; no unrelated catalog reordering.
- Pinned Orca provenance: **PASS**. 33,506 source records, **369 adapted Ash source hashes**, **8,391 documented excluded files**, original MIT notice SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`. Source exclusion count is unchanged.
- Guarded Electron production source build: **PASS**, plain Node daemon entry, sandbox preload and renderer boot graph (255 chunks, 7,836.4 KB minified). Inherited ineffective dynamic-import warnings remain.
- Actual Linux Wayland source-app launch: **PASS**, using private disposable profile `/tmp/ash-m8-pruned-phone-i18n-wayland-of9fz5`. Ash IDE renderer DOM complete; `pty.spawn`, native chat and Settings present; excluded mobile, automations and speech preload keys absent. The test-owned Electron and three helpers were stopped.

## Localization validator baseline and limitations

- **Before the edits**, `verify-localization-catalog.mjs` already failed: source references to `menu.exploreAsh` and `tray.openAsh` are absent from English catalog. **After the edits**, it still fails with the *same two missing keys*. We did not silently add unrelated strings.
- **Before the edits**, source extraction already failed with 18,338 extracted keys, 716 English entries not statically referenced (515 named nowhere in source), and eight inline fallback drifts. **After the edits**, it still reports the same 18,338 extracted keys and eight fallback drifts, but the orphan counts decrease to **424 not statically referenced and 223 named nowhere**—292 fewer in both categories, exactly matching the removed English phone strings. The remaining extraction failures are open rather than falsely treated as passes.
- Runtime-required English and protected-copy validators report stale generated/catalog entries after these edits; the corresponding generated artifacts were **not modified** by this removal. A same-command pre-edit baseline was not collected for those two checks, so their failure must **not** be categorically attributed to this change or described as definitively pre-existing. These validator failures are **not passing gates**; their complete repair needs a deliberate separate localization contract pass.
- **Unverified:** packaged AppImage/daemon/listener inspection, actual non-English UI switching on a real GUI, Linux X11, Windows/macOS, real provider-authenticated end-to-end behavior and full M8/release acceptance.

## Integration gate

Review source and override diffs, verify only the intended catalogs/test/QA/provenance/CI paths are staged, and create **one coherent tested commit directly on `main`**. Push normally without force/history rewrite. Verify the **exact pushed SHA** and GitHub `main` CI conclusion; acceptance is conditional on that observed result, not on source build evidence alone. Do not delete pre-existing branches or worktrees without separate authorization.
