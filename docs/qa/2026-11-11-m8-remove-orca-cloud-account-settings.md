# M8: remove Orca cloud account Settings controls

**Date:** 2026-11-11

**Base:** `main` at `b7db677a7aae10c8a8184a1df64a1b9154934ff9`

**Classification:** Scoped renderer exclusion. This is not full M8 or package acceptance.

This slice follows D-006, D-007, and M8 EX-06 in the 19 authoritative Ash IDE documents supplied outside the repository. It removes the Orca Cloud account Settings/search route and the development login preview. AI Provider Accounts Settings, Git navigation, local profile operations, generic developer toast diagnostics, and local HTML and Markdown preview remain available.

## Changes

- Removed the `orca-account` Settings section, target, page renderer, and search catalog. Deleted the now-unreferenced vendor account pane, search catalog, and cloud sign-out confirmation dialog. All three pinned upstream hashes were added to `docs/provenance/ash-exclusions.json`.
- Replaced the artifact unauthenticated state with a static message that cloud sharing and public publishing are unavailable in Ash IDE. The state has no sign-in or Settings action.
- Added the two new unavailable-state messages to the English localization catalog. No unrelated locale catalogs were rewritten.
- Kept local profile creation, switching, and project transfer in the existing store. The regression test drives those operations through the app store against a mocked profile API.
- Updated `docs/provenance/ash-modifications.json` through the source ledger tool. The root MIT license remains unchanged.

Deleted upstream files:

| File                                                                                 | Pinned upstream SHA-256                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `src/renderer/src/components/settings/accounts/orca/OrcaAccountSettingsPane.tsx`     | `c24df4d0b8a6113e34f249b739c1b622fbd4e39fb4c17a3eee02957ec487fa63` |
| `src/renderer/src/components/settings/accounts/orca/orca-account-settings-search.ts` | `617e325c7e98b114779866a5976c66ea509b506a4b5e82110e5dcfe6dff270f6` |
| `src/renderer/src/components/orca-profiles/OrcaProfileSignOutConfirmDialog.tsx`      | `e9e3358ad41e56db0790fa5689617e259867c77946ef387b92ff1d961429ee84` |

## Verification

- The focused new-cloud-settings, existing mobile and speech tests passed 3 files and 11 tests. Independent extended verification included the cloud-organization and phone-localization suites: **5 files and 16 tests passed** after the English localization correction and sign-out dialog exclusion.
- `pnpm run typecheck` passed.
- `pnpm run check:code-quality:changed` passed with 0 new findings across 4 changed files.
- `node_modules/.bin/oxfmt --check` passed on the originally changed 12 formatted files; the added English catalog was also checked separately. `git diff --check` passed.
- After the localization addition, `verify-localization-catalog.mjs` reports only the same two previously documented missing baseline keys, `menu.exploreAsh` and `tray.openAsh`. Before this correction, the two newly introduced artifact message keys were also missing. This validator remains **FAIL (pre-existing)**, not a passing gate; there are no new missing keys from this slice.
- The provenance verifier passed with 33,506 upstream records, 376 imported-source edits, **8,398 documented removals**, and the original MIT license hash. Its normal Node invocation could not spawn Git in the Codex sandbox (`spawnSync git EPERM`); independent verification from the connected DevSpace environment ran the unmodified verifier successfully.
- `pnpm run build:electron-vite` passed. Vite reported chunk-size and ineffective dynamic-import warnings.
- The delegated agent's Wayland smoke was **blocked before window creation** by the Codex sandbox (`Chromium sandbox_host_linux.cc: Operation not permitted`). A separate one-shot smoke through the ordinary DevSpace workspace executor **loaded the actual Wayland Electron window** from `out/main/index.js`. It observed document title `Ash IDE`, a ready renderer DOM, and callable/present `pty.spawn`, Settings, native Chat, and local profile preload APIs. It used a new isolated `/tmp/ash-m8-host-wayland-*` profile, including disposable HOME, XDG, Codex, Claude, and GitHub config paths; it did not reuse user credentials.
- The direct-host smoke's harness exited with timeout status **124** during teardown because the test-owned persistent daemon survived GUI closure (which is an Ash runtime requirement). After confirming the daemon and crashpad helper's command lines referenced **only the disposable test root**, both test-owned processes were terminated. The test runner confirmed `TEMP_PROFILE_REMOVED=true`. Thus GUI startup/preload **passed**; fully automated harness teardown did **not** pass, and this was **not** packaged-AppImage verification.
- A second independent source-app smoke launched Electron using its **normal sandbox**, a private `ORCA_E2E_USER_DATA_DIR`, loopback CDP and isolated HOME/XDG/AI-provider/Git paths. It verified `document.readyState=complete`, title `Ash IDE`, nonempty renderer DOM, callable `pty.spawn`, available `nativeChat`, `settings` and local-profile list interfaces; all excluded mobile, speech, automation, and cloud-organization-admin preload methods were absent. The newly written smoke harness completed and removed its disposable profile. This does not validate packaged daemon lifecycle or native profile IPC invocation.

An extra whole-file lint scan reported only unchanged baseline diagnostics: type assertions in `ArtifactsPage.tsx`, `settings-navigation-types.ts`, and `DevToolsPane.tsx`, plus button spacing in `DevToolsPane.tsx`. The changed-code gate reported no new findings.

## Remaining acceptance

This slice does not audit the separate cloud artifact publishing controls. `ArtifactsSettingsPane` and `ArtifactPublishButton` remain pending that review. Full M8, packaged AppImage and production-daemon inspection, other operating systems, and release acceptance remain open. The base SHA above identifies the starting point; exact integrated HEAD, push and hosted-CI outcomes are reported in the engineering handoff rather than predicted here.
