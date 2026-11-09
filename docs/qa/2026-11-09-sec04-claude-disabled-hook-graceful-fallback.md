# AG-07 — ordinary Claude terminal survives unavailable Ash hooks

- **Date:** 2026-11-09 (Asia/Kolkata)
- **Branch:** `feat/sec04-claude-degraded-fallback`
- **Source:** `src/main/runtime/terminal/launch/ash-claude-degraded-status-launch.test.ts`
- **Coverage:** test-only runtime dispatch, not a real Claude model turn or GUI launch.

## Requirement

The authoritative `11_ACCEPTANCE_AND_TEST_EVIDENCE.md` AG-07 states: when provider hooks are disabled or unavailable, ordinary agent launch still works where supported and status degrades honestly. The security contract (`13_SECURITY_PRIVACY_RELEASE_AND_MIGRATION.md`) forbids changing existing provider/foreign hooks to force Ash's status reporting. The current experimental session overlay is **not** a required dependency of launching Claude, and its failed recovery must not block the ordinary terminal path.

## Regressions and results

A disposable `0700` Ash data root contains an Ash-owned session overlay plus a simulated pre-existing foreign Claude `settings.json`. A test deliberately makes Ash's private receipt either **missing** or **malformed**. The runtime's real `createTerminal` method starts a Claude `startupAgent` through a simulated local layout-owner PTY controller. Each case asserts:

- Exactly one PTY dispatch; ordinary Claude launch still succeeds.
- The actual launch command contains Claude, but no `--settings` or `--session-id` injected by Ash.
- The foreign settings file remains byte-identical and the private Ash overlay file is not deleted or repaired.
- The production global-provider hook-write gate remains closed (`canAshWriteProviderGlobalHooks() === false`).

The test is part of `.github/workflows/foundation.yml`; it requires neither Claude installation nor provider credentials. There is no real terminal child, no real browser, and no inference about an authenticated status stream. It demonstrates **degraded-mode process dispatch** only, not finished AG-07 acceptance or live status accuracy.

## Acceptance boundary

When the host later supports **explicitly authorized** session-scoped hook attachment, a receipt integrity failure must refuse that *explicit opt-in launch*, without silently falling back to a different account or silently deleting the overlay. Ordinary launches with hooks disabled should remain unaffected. Real provider, account-binding, CLI and GUI/runtime recovery acceptance remains separate.
