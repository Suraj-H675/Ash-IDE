# M8 — exclude desktop mobile pairing Settings and preload entry points

- **Date:** 2026-11-10 (Asia/Kolkata)
- **Branch:** `feat/m8-exclude-mobile-settings-preload`, based on `2f6f7dce396701ce36938997d9d51df9f5ab2861`
- **Classification:** Short M8 desktop renderer/preload exclusion slice; not full M8, packaged-build, or release acceptance.

## Boundary

Desktop Settings no longer mounts the Mobile pairing section or indexes its pairing controls, and the removed `mobile` Settings target is rejected. The old desktop Mobile view actions are gone; generic attempts to activate the persisted `mobile` view fall back to Terminal. The separate Mobile Emulator controls remain available.

Electron preload no longer imports or publishes `window.api.mobile`; its type is optional for archived source and the existing browser preload. Retained historical pairing source goes through `requireLegacyMobileApi()`, which throws `Mobile pairing is not available in Ash IDE` before invoking a privileged or permission-changing mobile operation. The runtime Servers page no longer mounts the separate “Share this computer” action that used this bridge. Adding/connecting saved runtime environments remains available through its own `runtimeEnvironments` API.

Local Settings, PTY/local terminal APIs, native chat, browser automation, Chromium browser extensions, manual Runs, Git-over-SSH, and provider-native hooks/skills/MCP were not changed. No user settings, history, credentials, or migration records were deleted. `registerMobileHandlers` and the broader historical mobile implementation remain out of scope.

## Verification and remaining work

### Verified source checks

- Codex targeted mobile regression: **4/4 PASS**. The initial full TypeScript check caught one optional description access in the newly added test; corrected and rerun with **PASS**. Targeted native and type-aware Oxlint plus Oxfmt: **PASS**.
- Independent reviewer reran six Vitest suites: **49/49 PASS**, including retained manual orchestration Runs and worker recovery, renderer startup, excluded speech, excluded scheduled automation and the new mobile boundary. Full project TypeScript check: **PASS**.
- Electron source build in the normal DevSpace workspace, including the unmodified plain-Node daemon-entry guard and sandbox preload check: **PASS**. Renderer boot graph: **255 chunks / 7,836.4 KB minified**; inherited ineffective dynamic-import warnings remained. The built `out/preload/index.js` contains no `mobileApi` symbol.
- Pinned Orca source provenance: **PASS** with 33,506 upstream file records, 326 Ash source adaptations and 8,267 documented removals; MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.
- The Codex sandbox attempt at source-provenance verification failed with `spawnSync git EPERM`, and its first build attempt failed because the smoke-loader did not capture the daemon's expected stderr. Those checks were independently rerun **without changing their guards** from the normal development workspace and passed. Do not count the sandbox attempts as successes.

### Native Arch Linux/Wayland desktop smoke

The built Electron source desktop ran using `--ozone-platform=wayland` with the private test profile `/tmp/ash-m8-mobile-wayland-YmIOmr/`. HOME, XDG data/config/cache/state, Codex and Claude configuration, GitHub CLI configuration and global Git config were isolated from the user's normal profiles. An ephemeral localhost CDP port inspected the actual renderer's `window.api`:

```
{
  "title": "Ash IDE",
  "readyState": "complete",
  "hasPreload": true,
  "mobilePublished": false,
  "automationsPublished": false,
  "speechPublished": false,
  "ptyPresent": true,
  "nativeChatPresent": true,
  "settingsPresent": true
}
```

**PASS:** real source Electron/Wayland renderer with excluded mobile pairing preload and retained local APIs. The test Electron process and three profile-matched helper processes were stopped after the check. This is not a packaged AppImage, live pairing-revocation, multi-window reattachment, or real authenticated-provider test.

### Remaining acceptance

This slice does not remove dormant mobile pairing or remote-development files, legacy web/mobile preload sources, or historical settings/migration data. No native Windows/macOS/package acceptance was performed. Complete M8 and M2 acceptance remain **OPEN**, including residual general IDE plugin, remote-host and vendor-integrations exclusions.
