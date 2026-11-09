# SEC-04 — live Claude PTY adoption must not replay launch

- **Date:** 2026-11-09 (Asia/Kolkata)
- **Branch:** `feat/sec04-live-pane-adoption-regression` based on `a1074cdc`
- **Regression source:** `src/main/runtime/terminal/launch/ash-claude-live-pane-adoption.test.ts`

## Scope

The runtime-owned `createTerminal` route resolves launch options **before** it asks the PTY controller whether an existing stable pane can be adopted. On a window reload or a second window mounting the same pane, a previously live Claude process must not be relaunched, even if the caller carries an old `--resume` command and provider session metadata. A future Ash-private session overlay must be verified/attached only for **a new process**, not when adopting an already-live daemon-owned PTY.

Two tests exercise the actual runtime `createTerminal` method with a simulated local layout-owner PTY controller. The initial create allocates a real stable pane identity inside the fixture and calls `spawn` once. A subsequent `adoptStablePane` reports that same PTY as live:

1. Reopen with `claude --resume <session-id>` and `resumeProviderSession` reuses the original terminal handle, PTY ID, tab ID, and pane key. It does **not** invoke another `spawn`, its callback `onPtySpawnDispatched`, or a new terminal launch recipe.
2. A caller requiring a *fresh* pane at those same live pane IDs gets a refusal. It does not spawn another process or dispatch a launch event.

These tests are now part of `.github/workflows/foundation.yml`. They use only an in-memory controller—**no provider credentials, real Claude request, user folder, global provider settings, or actual GUI**. This regression establishes a runtime branch invariant, not a full PTY-daemon/GUI-process survival acceptance proof. The earlier native Wayland evidence remains separately recorded in `docs/qa/2026-11-08-m2-claude-native-wayland.md`.

## Production constraints

Any future `--settings` adapter must distinguish `adoptStablePane` from `spawnFresh` and never fail a live pane adoption because a private receipt is unavailable or changed. Do not create the overlay for a restored but still-running pane, and do not infer Claude account or provider-session ownership from tab/pane IDs. The provider-global hook-write gate remains closed and SEC-04/AG-07 are not accepted by these tests.
