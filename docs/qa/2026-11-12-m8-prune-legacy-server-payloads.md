# M8 — Exclude Linear SDK and paired-mobile page from server artifact contracts

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** validated `main` at `641a869a76e720eb149607d91c8f64a382bf1861`; [GitHub CI 43175298920](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43175298920) **passed** for that base. The successor CI result for this work must be checked independently.

**Scope:** partial desktop-only M8 removal (Linear/Jira connector and mobile pairing exclusions), not general deletion of local server, authenticated IPC, terminal/PTY, Git-over-SSH, provider tools, or browser functionality. Pinned source provenance is Orca `55697aec91390357540103f49991458f756b41cc`, MIT; Ash has independent history.

## Root cause and change

The previous desktop Linux build excluded `@linear/sdk` from `resources/node_modules`, but the **separately built `orcad` server artifact** still unconditionally bundled `@linear/sdk/index.js` through `orcad-linear-sdk-package.mjs`, and its artifact/hash/template manifests required the SDK. This was a real remaining excluded-payload entry point, regardless of the desktop packaging gate.

The server build additionally required a paired-phone **mobile web page** at `out/mobile-web/manifest.json`, despite Ash's desktop-only product decision. An initial `pnpm run build:orcad` after removing only the SDK stage **failed** because that page had not been built. This revealed that the server package, its content hash, template creation, template checksum verifier, and materializer still shared a mandatory mobile bundle contract.

Removed both staging scripts and their invoked packaging steps. Updated the canonical `ORCAD_ARTIFACTS` inventory, artifact/version hash calculation, standalone server-template builder, installer identity/hash materializer, and remote-install filename list to exclude `node_modules/@linear/sdk/index.js` and `out/mobile-web/*`. Removed the obsolete orcad-slot-only mobile page resolver test; the independent mobile RPC fixture remains available to evaluate the legacy code until that subsystem is removed vertically.

The template verifier now compares **actual common-root files on disk** against the exact declared artifact inventory (excluding only the template manifest and the separately verified target subtree). This closes a further defect found by a fail-first test: the old verifier accepted undeclared files in the shared template root, including a stale vendored Linear SDK or mobile page. The new test first verifies a synthetic eight-target template succeeds, then proves both excluded payload paths are rejected. This does not replace the existing target-specific checksum and file inventory checks.

## Verification performed

- Focused Vitest after final source changes: **2 suites, 27/27 tests passed**, including old mobile RPC tests, allowed artifact inventory and rejected extra shared-root files. The negative test **failed against the old verifier** before adding exact common-file checks; it passed afterward. Expanded post-staging regression covering runtime control methods and both desktop packaging exclusion/config suites: **5 suites, 55/55 PASS**.
- `pnpm run typecheck`: **PASS** for the changed package and TypeScript projects.
- `pnpm run build:desktop:assets`: **PASS**, including the CLI artifacts, Electron main/preload/renderer build, sandbox-preload verification and bundled skills CLI runtime verification. Existing large-chunk and ineffective dynamic-import warnings remain; they did not fail this build.
- Provenance: the two removed pinned upstream source files are recorded in `ash-exclusions.json` with their exact upstream SHA-256 values. `ash-modifications.json` tracks the edited source hashes; MIT license remains unchanged. The post-staging `node config/scripts/provenance/verify-source-ledger.mjs` gate verifies this recorded manifest.
- **`pnpm run build:orcad` remains FAIL / not accepted.** After removing the obsolete mobile-page prerequisite, the build progressed to the server module dependency guard and reported: `[build-orcad] 1 module(s) in the bundle import electron: src/main/runtime/rpc/methods/ash-runtime-control.ts`. That existing `runtime.stop` handler dynamically imports Electron to quit the GUI runtime, while the `orcad` target is plain Node and deliberately forbids Electron. This stop-lifecycle contract needs its own reviewed refactor, not disabling the guard or pretending the server package succeeded.

## Remaining M8 acceptance

The broader orphan Jira/Linear handlers and source trees, mobile RPC methods, voice worker, PostHog transport, excluded settings/routes, and remote development code are **not all removed** by this package-contract change. Browser native functionality and local PTY/runtime continuity remain separate positive gates. No real provider account, workspace, installed application, or live Ash/Orca profile was changed. This is **partial exclusion progress**, not full Linux release readiness or verified cross-platform server packaging.
