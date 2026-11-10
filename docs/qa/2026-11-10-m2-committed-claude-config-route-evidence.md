# M2 / AG-05 — committed local Claude configuration-route evidence

**Date:** 2026-11-10 (Asia/Kolkata)
**Scope:** Linux/macOS fresh direct host-local Claude PTYs only.
**Branch:** `feat/m2-claude-committed-account-route`, based on `f67aa3cba9aa62bb9ca03f1ceeb9c95017d594c3`.
**Acceptance:** Partial internal routing-evidence improvement. AG-05, AG-07, SEC-04, and full M2 **remain open**.

## Implemented boundary

The existing verified managed-account profile pin now owns a private, nonforgeable in-process route receipt. Main attaches an immutable `config-route-only` account/profile-identity snapshot to `CommittedLocalPtySpawnEvidence` **only** when the production pin recorded a native PTY attempt without uncertain dispatch and a matching returned PTY ID and incarnation, the launch is an eligible fresh local Claude launch, and the committed host pane binding matches the same generation. Missing/forged/unbound/ambiguous pin states do not issue this receipt. The existing incarnation-fenced runtime exit observer removes the entire committed record upon the corresponding PTY exit; GUI detach does not imply exit.

The receipt is internal to Main. It does **not** prove the provider account authenticated by Claude, a provider session UUID, a real Claude root `SessionStart` event, or a durable daemon-session owner. The separate `accountEvidence.status` remains `missing`, and the global provider-hook-write gate remains disabled. No renderer/RPC/persistence format, foreign provider setting, credential, shell startup behavior, Windows, WSL, daemon, or remote route was changed.

## Observed local evidence

- Direct Node Vitest forks across the routing pin, native pin, committed evidence, native runtime-controller path and local PTY cancellation: **5 suites, 51/51 PASS**. Uses only disposable managed homes and a fake Claude executable. It tests A and B after selected-account switch, refused replacement marker, route receipt immutability, absence on missing/forged/unbound/ambiguous pins, matching exit cleanup, and unchanged foreign settings sentinel.
- Node and renderer TypeScript projects: **PASS** with `node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs`.
- Oxfmt check and native + type-aware Oxlint with `--deny-warnings` on the five changed TypeScript files: **PASS** (Codex implementation verification).
- `node config/scripts/provenance/verify-source-ledger.mjs`: **PASS**, independently outside the restricted Codex sandbox; 33,506 pinned upstream source records, 220 documented Ash adaptations, 8,260 removals, intact source license hash.
- `git diff --check`: **PASS**. The temporary dependency symlink into the canonical same-lockfile `node_modules` was removed after verification.
- Full workspace-package rebuild in the restricted Codex sandbox: **BLOCKED** by read-only pnpm store lock. This is not counted as a successful package build. Feature GitHub CI must independently run the pinned package build and source/desktop gates before merging.

## Next acceptance requirements

Require clean feature-branch hosted CI at the exact SHA, deliberate integration and post-integration validation. Production hook-ingest/root SessionStart correlation still lacks independently established provenance and authenticated provider identity. Windows PowerShell route freezing is not implemented. Real authenticated Claude turns, persistent host/GUI reconnect and packaged Arch Wayland/X11 remain separately required for full M2 and release acceptance.
