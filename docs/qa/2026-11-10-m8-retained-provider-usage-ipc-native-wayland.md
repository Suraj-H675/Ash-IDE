# M8 — retained provider usage IPC, native Arch Wayland evidence

**Date:** 2026-11-10 (Asia/Kolkata)
**Base:** validated `main` `ebb2db631463f31e2c65eac95f48a93f03d5a958`
**Feature:** `feat/m8-retained-provider-usage-ipc`, code commit `a1c3c993339375da8f541915f7014d01c488522a`
**Classification:** Retained provider-native usage/status registration. Not complete M2/M8 or authenticated quota/reset acceptance.

## Product boundary and implementation

Ash's approved terminal-first Claude/Codex flow retains per-provider usage/rate-limit status and manual account-scoped refresh; these must not be disabled simply to silence startup errors. Before this slice the renderer subscribed to `rateLimits:update` and called `rateLimits:get` at boot, while Main constructed the fully configured provider usage service but omitted its already-implemented IPC registration.

The desktop startup now registers the existing eight `rateLimits:*` Main endpoints immediately **after** `initializeMainProcessAccountServices()` initializes the real `RateLimitService` and `CodexAccountService`. A missing service fails startup rather than silently fabricating a response. The retained `get` delegates to `getState()`; provider-target and per-account cache logic remain owned by the original implementation. The seven other routes delegate to pre-existing explicit refresh/read methods; `rateLimits:consumeCodexResetCredit` delegates to the existing account service that enforces the durable managed-account reset-credit scope/mutation queue. No extra instance, synthetic quota, unconditional startup refresh or arbitrary credential write was introduced.

**The native test intentionally exercises read-only `get` only.** The unit test injects mocks for explicit refresh and reset-credit actions; it does not spend a real credit, contact a provider, or access real provider homes. Full security/behavior acceptance of real refresh and reset-credit use remains separate.

## Verification

- Direct Node Vitest forks: **2/2 PASS**, including real eight-channel IPC dispatch contract plus adjacent persistent terminal topology startup fixture. Read asserts a typed empty snapshot and exact Claude/Codex runtime targets without triggering refresh. The explicit methods route to injected mock services, including reset-credit to Codex's account service.
- Node/renderer TypeScript **PASS**.
- Oxfmt, native Oxlint and type-aware Oxlint with denied warnings **PASS**.
- Electron source bundle **PASS** with sandbox preload verified; known ineffective-dynamic-import warnings remain.
- Source provenance **PASS**: 33,506 upstream source records, 247 adapted source hashes, 8,260 documented removals, original Orca MIT license hash unchanged.
- CI foundation workflow includes the new Node-forks usage IPC test alongside the retained GitHub PR registration test.

## Real desktop on the exact feature code

Launched the Electron source app with fully isolated HOME/XDG configuration/data/state/cache, Ash userData, CODEX_HOME, CLAUDE_CONFIG_DIR and browser state under a fresh private root `/tmp/ash-gui-ready-qa-bE26sl/` on Arch Linux/Hyprland native Wayland. No real provider credentials, saved Ash workspaces, user browser profiles, external hooks or other-app state were read or changed.

The real `ash-ide` Wayland window mapped and displayed title *Ash IDE*. First-window startup barrier succeeded, local runtime pointer was present, and a renderer reload completed while console, Electron stderr and CDP messages were collected. Main's real `ipcMain` exposed **547 handlers** (baseline 539), including exactly the eight `rateLimits:*` routes. `window.api.rateLimits.get()` returned a state with correctly scoped `claudeTarget` and `codexTarget` both defaulting to `{runtime:'host',wslDistro:null}`; both provider usage readings were `null`, and inactive managed account arrays were empty in the isolated profile. No values were invented to fill missing provider responses.

**16/16 native assertions PASS.** Against the immediately preceding verified `main` `ebb2db63` native baseline `/tmp/ash-gui-ready-qa-8dMlaU/`, distinct missing handler names fell **5 → 4**: only `rateLimits:get` disappeared; none were added. Remaining names: `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`.

Both disposable profile-scoped terminal daemon and local runtime stop operations returned exit 0, and no process referring to the temporary root remained. Screenshot, events and result JSON stay in this private root and are **not** committed.

## Limits and next work

The source app is not a packaged Wayland/AppImage acceptance test. Authenticated provider quota reads, user-controlled account switching, live usage push, reset-credit mutation and direct provider HTTP/CLI auth were not exercised. Provider-native skill discovery, ordinary Git SSH and Ash-owned update status still require correct retained handlers and tests. Inherited **ORCA** Landing branding is visible; full visual parity, full M8 exclusion, M2 authenticated agent turns, trusted root SessionStart correlation, Windows/macOS acceptance and full production packaging remain **OPEN**.

Feature code CI, final-tip feature CI, deliberate fast-forward integration, post-integration verification and exact `main` CI are separate gates before marking this slice integrated.
