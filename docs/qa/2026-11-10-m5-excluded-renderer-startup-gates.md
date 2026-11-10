# M8 early slice — excluded renderer startup capability gates

- **Date:** 2026-11-10 (Asia/Kolkata)
- **Branch:** `feat/m5-excluded-renderer-startup-gates`, based on `fd3761ed62586e3eb6d9f0785c576588f8db8be7`
- **Milestone classification:** Early M8 vertical-removal work, performed during M2 hardening; the historical feature-branch name does not mean M5 editor acceptance.
- **Scope:** Ordinary local desktop renderer startup; limited removal of excluded global app-managed skill and mobile entry points, plus non-Windows WSL migration gating
- **Acceptance:** Source-level and isolated React/native runner verification only. A real post-change Arch Wayland GUI console run, Windows native recovery, and packaged desktop acceptance are **not** established by these tests.

## Changes and rationale

The prior Arch Wayland startup fixture recorded unsupported IPC calls to `skills:bundledPlan`, `mobile:listDevices`, and `wslMove:listPendingRendererRewrites`. These are renderer consumers of dormant or excluded services, not permission to re-enable those services. This slice removes automatically mounted bundled-skill freshness/update UI (nudge, modal and status segment), removes the app-managed Skills/Mobile sidebar destinations and pages, and treats persisted views naming those removed pages as `terminal`. A local `useSkillFreshness` hook returns a disabled, **not up-to-date** state rather than requesting a missing app-managed planner on Linux, macOS or Windows. Provider-native skills, agent native tools and MCP are not removed.

The WSL-move renderer store-rewrite entry point now returns without IPC on non-Windows hosts, while the Windows `win32` path retains its actual migration query and code. Existing platform information comes from the trusted desktop preload, not a user-agent guess. The separate Windows-drive UNC migration path is not changed.

## Checks and limitations

- Isolated Happy DOM/React test in `ash-excluded-startup-gates.test.tsx`: real local `useSkillFreshness` mounts on Linux, macOS and Windows perform no planner invocation and return non-loading, no-plan results; Linux/macOS WSL move does not invoke its API, Windows path invokes it; startup hydration maps removed views to the terminal. **5/5 tests PASS** under direct Node Vitest forks after the final changes.
- Node/renderer TypeScript project runner: **PASS**.
- Native and type-aware Oxlint with warnings denied, plus Oxfmt: **PASS** on the edited TypeScript sources and regression test.
- Source provenance ledger: updated for eight renderer files derived from pinned Orca; **PASS** with 33,506 pinned upstream records, 228 documented adapted files, 8,260 documented removals and unchanged MIT license verification.
- Electron desktop source bundle: **PASS**, with pre-existing chunk-size and ineffective dynamic-import warnings; sandbox preload verification passed. Hosted feature/main CI remains pending. Neither passing unit tests nor a desktop bundle alone proves a real mapped GUI has stopped logging the three errors.

This is not the entire feature-exclusion cleanup. Old mobile-pairing/settings, scheduled-agent, generic skills-management, remote-development and other excluded code remains to be audited and removed separately without disrupting retained provider-native tools or local Windows support. Application-driven navigation to an already removed page and full browser/Web preload behavior require later integration review.
