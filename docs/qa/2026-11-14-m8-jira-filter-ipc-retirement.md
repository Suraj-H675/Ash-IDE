# M8 / EX-07 — Retire Jira filter-state IPC, RPC and preload transports

**Date:** 2026-11-14 (Asia/Kolkata)
**Feature branch:** `fix/m8-retire-jira-ui-filter-ipc`; source commit `9446d281aedac9bf1d29439ec4c86b1fccdda95a`.
**Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-25d08210`.
**Base:** canonical `main` at `75975b1d40f8128095b5a9a8d764bd0e962b081c`; GitHub Actions run `43483128767` completed successfully.
**Pinned upstream:** Orca `55697aec91390357540103f49991458f756b41cc` (v1.4.214, MIT, Lovecast Inc.).

## What was removed

- Unregistered `ui:getJiraQuickFilters`, `ui:setJiraQuickFilters`, `ui:getJiraSavedFilters` and `ui:mutateJiraSavedFilters` from native Electron IPC.
- Removed corresponding `ui.getJiraQuickFilters`, `ui.setJiraQuickFilters`, `ui.getJiraSavedFilters` and `ui.mutateJiraSavedFilters` definitions from the authenticated runtime RPC method registry.
- Removed the four preload bridge implementations and their public desktop UI API type members. Deleted the web-client bridge implementing those same four methods.
- Regenerated the RPC params catalog from the actual server method registry. This also eliminated stale Jira/Linear parameter declarations left over from previously retired server method roots, without modifying the unrelated remaining RPC implementations.
- Converted dormant renderer Jira filter transport helpers into explicit fail-closed compatibility functions. They never contact a provider or request a retired IPC/RPC method, even if older unmounted hooks call them.
- Kept generic persisted UI hydration and old Jira quick/saved filter schema normalization for **historical data preservation**. No automatic credential migration, saved-filter deletion or change to existing user preferences is performed.
- Recorded the deleted web-client bridge and its original source SHA-256 in `docs/provenance/ash-exclusions.json`.

## Actual verification

- **Red first:** both new transport test files originally failed all 4 checks against the previously registered desktop/preload/RPC methods and exposed RPC operations.
- **After the fix:** **99 tests passed across 20 files**, covering native IPC registration, web UI API export, runtime method manifests, rejected excluded calls, historical data preservation, generic UI settings, and retained code-host Tasks/onboarding/feature-wall behavior.
- Full repository `pnpm run typecheck`: **PASS**. Changed-file Oxfmt and Oxlint: **PASS**. `git diff --check`: **PASS**.
- `node config/scripts/plugin-authoring/rpc-catalog/generate-rpc-params-catalog.mjs --check`: **PASS**; generated contract matches source registry.
- Pinned provenance ledger verification: **33,506 upstream records, 563 Ash adaptations, 8,559 documented exclusions**, with original MIT notice preserved.
- `pnpm run build:desktop:assets`: **PASS**, 257 renderer chunks, 7,801.0 KB minified boot graph, sandbox preload verification, and 1,224 CLI closure files/3 commands.
- `pnpm run build:orcad`: **PASS**, 12.78 MB/8,145 modules; zero Electron and `node:sqlite` imports, Node 24.22.1 referenced.
- `pnpm run build:native` and `pnpm run ensure:electron-runtime`: **PASS**.
- Fresh Linux x64 AppImage: `dist/ash-ide-linux.AppImage`, **224,371,145 bytes**, SHA-256 **`16aed1e7dcf00ce72844140881fed8c54726181165fa53c5b9e2a19fe8f0431b`**. Packaging verified **5,199 archive entries**, 15 bundled native binaries against Ubuntu 20.04 glibc floor, packaged daemon entrypoint, bundled Node PTY and two plugin-resource bundles.
- Built-output scan of `out/preload`, `out/main`, `out/renderer` and `out/orcad` for the four excluded Jira IPC/RPC filter method names: **none found**.
- Packaged Linux **Wayland GUI lifecycle PASS**: app PID `4178894`; runtime ID `2559760e-a15b-41c6-99e7-802eb0be81c8`; terminal handle `term_bf7ba70a-e89d-4b92-9b29-484fb1db632f`; terminal PID `4179504` survived closing and reopening the last GUI window. Test-owned daemon/runtime stopped; private fixture logs `/var/tmp/ashwl.iH1B0K`.

## Remaining risk / acceptance limits

- This verifies **the specific retired Jira filter transport boundary**, not all of EX-07: historical Jira/Linear models, other inherited backend modules and generic UI persistence compatibility remain subject to whole-product review. Generic `ui.set` still accepts the broader persisted UI shape so we do not silently erase existing state.
- Full app exclusion scan, other EX-01–EX-10 gates, authenticated coding-provider E2E, Windows/macOS, X11 on this new commit, visual parity and updater rollback remain outside this milestone.
- No Jira/Linear account, existing provider credential, user repository or external provider was touched during testing; fixtures were synthetic.
- This document records local evidence only. Hosted CI for the successor integrated commit must be observed before it can be called successful.
