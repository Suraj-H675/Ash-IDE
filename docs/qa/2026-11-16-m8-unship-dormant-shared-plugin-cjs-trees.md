# M8 / EX-03, PK-08 — unship dormant standalone shared app-plugin CommonJS trees

**Date:** 2026-11-16 (Asia/Kolkata). **Base:** clean, synchronized canonical `main` at `8b39d24a846b25a6fa8c5827063c03baebb33e09`; its exact [GitHub Actions run 43754557721](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43754557721) completed **success**. **Branch:** `fix/m8-unship-dormant-shared-plugin-cjs-trees` in an isolated worktree. **Source reference:** read-only pinned Orca `55697aec91390357540103f49991458f756b41cc`; original MIT notice preserved.

## Scope and dependency judgment

A read-only static literal-import audit of the **actual preceding verified AppImage's ASAR**, not canonical `main`'s older `dist/`, found no incoming packaged CommonJS/ESM literal imports from outside the following three standalone compiled roots:

- `out/shared/plugins/approval` — 5 JavaScript files
- `out/shared/plugins/declarative/runtime` — 17 JavaScript files
- `out/shared/plugins/declarative/testing` — 16 JavaScript files

The declarative testing modules can import runtime modules **within** the selected exclusion set. The static audit does **not** establish that related _source code_ is absent from the compiled Electron main/renderer bundles. Source imports exist in legacy plugin GUI/main integrations; those bundled features require separate entrypoint and renderer review. Likewise, dynamic computed imports are not proven absent by a literal-import scan.

Added the three exact standalone roots to `EXCLUDED_APP_PLUGIN_SHARED_CJS_ROOTS`, excluded them from electron-builder's packaged `out/` files, and made `verifyAshPackagedAsarHygiene` reject any return inside **app.asar**, **app.asar.unpacked**, or a newly introduced statically named CommonJS/ESM import from retained packaged JavaScript. No shared plugin source, built-in editor syntax, browser extension, native agent, provider-native skills/MCP, terminal, Git or local browser entrypoint was deleted.

## Independently executed evidence

- The eight new negative package-hygiene tests **failed as expected on the old verifier** (three ASAR files, three unpacked artifacts, a CommonJS `require`, and an ESM static `import()`). After implementation, **101/101 package hygiene tests passed**. An expanded run including retained terminal/environment/agent-skill CLI and authenticated Ash RPC manifest tests passed **135/135 in five files**.
- Full `pnpm run typecheck`, changed-code Oxlint, Oxfmt and `git diff --check`: **PASS**. `verify-source-ledger.mjs --write-modifications` reconciled the changed upstream-derived Electron builder config; full ledger verification **PASS** with **33,506** pinned upstream files, **588** Ash adaptations, **8,567** recorded upstream removals and unchanged MIT notice.
- `pnpm run build:release:javascript`: **PASS**. Main **9,678 transformed modules**, 257-chunk renderer boot graph, sandbox preload and **1,084 compiled CLI closure files / three commands** passed. No main or renderer source was changed.
- Fresh `pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64`: **PASS**. Packaged plain-Node daemon, real bundled Node PTY, Linux modes (**6,827 verified files/directories**) and **15 native glibc-floor checks** passed. The native Wayland clipboard helper was reused rather than freshly compiled because Docker was unavailable, after checking seven identical native inputs and its recorded fingerprint.
- Real archive-path comparison against the preceding verified `8b39d24a` package: **5,120 → 5,079 ASAR entries**. Exactly **38 compiled JS files and three directory entries** from the three designated roots were removed, with **zero other non-renderer path additions or deletions**. The 120 renderer hashed asset paths were refreshed one-for-one; this is a **path-set comparison**, not byte-identical renderer content. The main, CLI and renderer entrypoints, native-chat files and existing shared plugin manifest remain present.
- Unsigned engineering `dist/ash-ide-linux.AppImage`: **223,932,817 bytes**, SHA-256 `d41f3728631714ad1e0dedf3465ed50a74aa101c815e4d0f42d8ce1fd2536ab9`. Staged `app.asar`: **9,832,804 bytes**, SHA-256 `ffcb3406165bdd28a7d23574427649e7ad3206b6893e38b0e78d68c004561098`. Not a signed or public release.
- Real packaged native **X11/Xvfb** browser navigation/restoration, GUI-closed authenticated notification and persistent PTY close/reopen: **PASS**, test-owned fixture `/var/tmp/ashx11.TsYFL4`, runtime `5ac2121d-0e08-47e6-aec8-7297d08e7b44`, terminal PID `2544905`. Native **Wayland/KWin** GUI close/reopen with persistent PTY: **PASS**, test-owned fixture `/var/tmp/ashwl.CIWYGE`, runtime `1c7422dd-1136-4e52-aaee-fd3aeb05765a`, terminal PID `2546578`. Both test-owned runtime/daemon trees were stopped.

## Limits and follow-up

This milestone removes **standalone compiled CommonJS copies** of excluded app-plugin machinery, not all app-plugin code from the Electron and renderer bundles. Remaining plugin UI, shared manifests, worker/protocol compatibility and generated skill guidance still require consumer-verified removal. Real external provider authentication, normal Git-over-SSH network reachability, comprehensive visual parity, DEB/RPM, macOS/Windows native execution, updater rollback and independent true multi-window verification were **not exercised here**. No real user projects, provider credentials, unrelated application data or upstream source checkout were changed.

Integration into canonical `main`, successor GitHub CI and final acceptance need separate observation. The successful linked CI belongs to the **base commit**, not the change being reviewed here.
