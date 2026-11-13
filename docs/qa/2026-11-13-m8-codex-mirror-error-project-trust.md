# M8 — Native project revocations after managed Codex mirror errors

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `f297acf329e72dbd9e42762efdc6b6a66cecc128` (the prior promotion-failure guard).
**Branch:** `fix/m8-codex-mirror-write-failure-trust-guard` in the existing isolated Codex settings worktree.

## Finding

After settings promotion succeeds, the managed-home mirror can still fail to apply the provider's latest project distrust. Its previous `catch` and `refused-indeterminate` paths recorded errors but returned control to launch preparation. An injected runtime atomic-write failure left a previously trusted project marked `trusted` even after the native config explicitly revoked it. A runtime that became unreadable after a successful promotion read also passed through a silent no-op.

## Correction

Both failed-mirror paths now call `guardNativeTrustAfterFailedMirror()`, in the existing native revocation sync module. When the native config contains explicit project distrust, Ash tries to apply it using guarded runtime-home compare-and-swap writes without modifying the provider's config. If source or managed trust cannot be verified, it refuses managed-config synchronization instead of silently continuing with stale trust. The existing mirror-error reporting remains in a `finally` block, including on refusal. Normal mirror success and native provider configuration ownership policy are unchanged.

## Evidence

- Red-first regressions proved that a failed ordinary runtime write left native distrust unapplied, and an indeterminate runtime observation could return without refusal. Both pass after the correction. A subsequent guarded-write conflict refuses synchronization; clearing the injected ordinary-write fault permits a safe retry.
- Promotion focused tests: **19 passed**. Focused promotion/unreadable-config tests were also verified together.
- Expanded Codex settings, hooks, trust, and runtime-home tests: **309 passed, 15 platform-specific skips, 62 files**.
- WSL/home-routing test fixtures: **18 passed in six files**, with no live WSL guest used on Linux.
- Targeted lint/formatting, Node TypeScript, provenance, integration build, and GitHub CI must be confirmed separately; a successful prior-base CI is not verification for this change.

## Open gates

This is a synchronous source-path safety check using disposable provider and Ash homes, not a signed-in Codex or packaged GUI verification. Provider trust changes racing after snapshots, other provider-native mutation paths, and full M8 acceptance remain under review.
