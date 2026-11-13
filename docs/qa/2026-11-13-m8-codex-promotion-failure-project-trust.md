# M8 — Fail-closed project trust on failed Codex settings promotion

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `0f96dee1afd03e6eaef490f6469f191625bac720` (GitHub Actions run `43375779744` succeeded).
**Branch:** `fix/m8-codex-promotion-failure-trust-guard` in the existing isolated Codex settings worktree.

## Defect and scope

If `promoteCodexRuntimeSettingsToSystem()` returns `null` (for example, because Ash's derived settings baseline is unreadable), the retained mirror previously reported the sync stall and returned without reconciling native Codex project distrust. A formerly trusted runtime project could therefore survive an explicit native `trust_level = "untrusted"` change. The related fail-closed path for a missing or unreadable native observation was also bypassed.

The `null`-promotion branch now invokes `guardNativeTrustAfterFailedPromotion()`, co-located with the existing project-revocation synchronization logic. This applies explicit native project revocations into the Ash-managed runtime using compare-and-swap atomic writes, without promoting pending local settings back to native Codex and without modifying native provider configuration. If native project trust cannot be read or safely applied, the synchronous caller receives an error rather than proceeding with stale managed trust. The original stalled-config reporting remains in a `finally` block. Ordinary successful promotions, read-only normal mirrors, and the separate retained legacy-pane mirror are not broadened by this change.

## Test evidence and review

- Two regression tests were observed **red before the fix** and green after: an unreadable derived baseline must not suppress explicit native distrust; if promotion and the native source are unreadable, managed sync must refuse stale trust.
- Updated `STA-4737` denied-runtime fixture to assert fail-closed sync while independently confirming the unreadable managed config's bytes were not modified. This replaces its previous silent-no-op expectation with the stricter trust safety contract; the regression was not removed or skipped.
- Focused promotion suite: **17/17 passed**.
- Expanded Codex settings, hooks, trust, and runtime-account suite: **307 passed; 15 platform-specific skips; 62 files**.
- WSL and real-home routing fixtures: **18 passed across six files**. No real WSL guest execution on this Linux verification host.
- Targeted Oxlint/Oxfmt and Git whitespace checks: **passed**. TypeScript, provenance, and post-integration checks are tracked separately in the completion record.
- Tests use disposable native and Ash Codex homes and injected filesystem errors. No live signed-in Codex session or desktop GUI workflow was exercised in these source tests.

## Residual gates

This milestone confirms synchronous managed-home launch preparation and config preservation. It does not prove provider trust cannot change after the observed snapshot, or cover any other native provider mutation path not explicitly verified. End-to-end signed-in Codex launch, GUI error surfacing, packaged acceptance, and the complete M8 security review remain open.
