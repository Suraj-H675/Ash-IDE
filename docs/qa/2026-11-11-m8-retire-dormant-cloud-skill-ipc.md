# M8: retire dormant Orca Cloud skill IPC registration

**Date:** 2026-11-11

**Base:** `main` at `9ece39cb12597417fec4cfd32ce95bcba2b5a6c5`
**Scope:** Excluded vendor Cloud backend only; not full M8 or release acceptance.

## Dependency and preservation boundary

Production startup in `src/main/startup/main-process-ready-runtime.ts` calls `registerProviderNativeSkillDiscoveryHandler(store, runtime)`. No production caller invokes the inherited `registerSkillsHandlers` wrapper in `src/main/ipc/skills.ts`. That unused wrapper alone imported and registered `registerSkillCloudIpcHandlers`, which in turn owned the five now-orphaned Cloud sharing/package-install IPC files.

This change removes the dormant wrapper, its Cloud imports and orphan-only supporting schemas/progress handlers. It preserves the actual startup `skills:discover` handler, trusted sender check, native provider skill discovery roots, passive WSL stopped-distribution protections and source skill discovery. Existing local skill files, provider credentials and runtime installations are untouched.

This **does not** remove the UI for Orca Cloud skill sharing, the exposed legacy preload methods, all Cloud skill runtime services, or bundled local skill functionality. Those need separate caller-by-caller audits. No live provider account or user profile was used.

## Source and regressions

The source provenance exclusion ledger records each deleted file and its SHA-256 from the pinned Orca snapshot:

| Removed upstream module                                 | Pinned SHA-256                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/main/ipc/skill-cloud-ipc-handlers.ts`              | `1d6a31fac38d992aabb4ecac7869f4ce9e91a6a44a341823d9c3f0ff1e13f42b` |
| `src/main/ipc/skill-install-management-ipc-handlers.ts` | `44c0295b8a941ac86cd9a6845bc9ad5d291221cdb0fd9d4d32d7c64c93601797` |
| `src/main/ipc/skill-install-progress-ipc.ts`            | `02320cbe4f2ebacd4454157da8e52807c86f049deed9bbd35a957cd43f10fddd` |
| `src/main/ipc/skill-cloud-install-ipc-schemas.ts`       | `85d16c5167a92cc5746ee654ee8ecd9e125cf30356e2664e27adca63394996d4` |
| `src/main/ipc/skill-share-publishing-ipc-schemas.ts`    | `592a44678eb263f127ed1737c89d72be4a3befc342a49db96dc059605bb44a6a` |

`src/main/ipc/ash-excluded-skill-cloud-handlers.test.ts` prevents reintroduction of the excluded module tree and registration path and asserts the active provider-native discovery boundary. `provider-native-skill-discovery.test.ts` independently exercises runtime provider roots, stopped-WSL protection, trusted sender refusal, and malformed target rejection; the obsolete mock of the removed Cloud module was eliminated. The Foundation workflow runs both suites.

## Verification and remaining gates

- Focused and adjacent Vitest: **3 suites / 6 tests passed**, including retained provider-native discovery and the preceding cloud organization exclusion.
- Full `pnpm run typecheck` **passed**. `pnpm run check:code-quality:changed` **passed** with zero new findings, including type-aware and structural rules. `oxfmt --check` and `git diff HEAD --check` passed.
- Provenance verifier **passed**: 33,506 pinned upstream records, 376 adapted Ash source hashes, **8,403 documented removals**, original MIT license unchanged.
- `pnpm run build:electron-vite` **passed**, including the Electron preload guard and 255 renderer chunks. Existing chunk-size and ineffective dynamic-import warnings remain. This is a source build, not an AppImage or full packaged desktop qualification.
- Hosted GitHub CI status is reported for the exact pushed SHA in the final integration handoff, not inferred from local validation.
- Native source-app GUI: unchanged startup provider-native handler, but this isolated backend removal does not itself prove packaged GUI or native skill IPC behavior.

This note covers one bounded deletion slice. Hosted CI and packaging, legacy skill-sharing renderer/preload entrypoints, AppImage, X11, macOS/Windows, and full M8 release acceptance remain separate gates.
