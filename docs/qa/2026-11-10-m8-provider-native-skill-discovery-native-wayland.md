# M8 — retained provider-native skill discovery, native Arch Wayland

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** validated `main` `5d7b423f5891c253b599d57e3c61caf88ef55c99`
**Branch:** `feat/m8-provider-native-skill-discovery-ipc`; code commit `6eece2bcd45c230e76aa5f8da69b94d5b9957741`
**Classification:** Narrow retained local/provider-native skill discovery IPC repair; *not* full M8 exclusion or full M2 acceptance.

## Product boundary and source change

The approved feature matrix retains Claude/Codex and other provider-native local skills and MCP integrations, but excludes Orca's application-wide skills marketplace, sharing/cloud installs, general app plugins and app-managed bundled-skill update workflow. `skills:discover` was called at startup yet not registered by Ash Main. The upstream `registerSkillsHandlers(store,runtime)` also registers excluded skill cloud and bundled installer/auto-update APIs, so using it indiscriminately was not acceptable.

The existing validated discovery logic was factored into `registerProviderNativeSkillDiscoveryHandler(store,runtime)`. The ready desktop Main process calls **only** this narrow registrar after persistent account services and local runtime configuration. The real handler retains `SkillDiscoveryTargetSchema` validation, trusted UI `webContents` authorization, exact workspace/repo skill scan, resolved managed provider-root overrides, passive stopped-WSL gate with unavailable-vs-empty distinction, and the coalesced native discovery cache. The legacy broad registrar reuses this extracted handler for source consistency but is **not** invoked by Ash's desktop readiness path. No synthetic skill inventory or cloud service was created.

This does not mean the legacy source files, preload interfaces, bundled installer code or deprecated marketplace paths are fully removed. Their later removal remains an independent M8 requirement.

## Automated source verification

- Direct Node Vitest forks **2/2 PASS** on the focused real-handler contract and adjacent startup topology test. The handler test verifies **only** `skills:discover` registered, no cloud registrar invoked, trusted event accepted, forged sender refused, invalid source-kind rejected before scan, `refuseStoppedWslDistro:true` preserved on passive resolution, scoped repo set passed, and managed provider root overrides forwarded. The topology test confirms real startup invokes the narrow registrar while preserving durable duplicate-PTY repair.
- Node/renderer TypeScript **PASS**.
- Oxfmt and native/type-aware Oxlint with denied warnings **PASS**.
- Electron source desktop bundle **PASS**, sandbox preload verified; inherited ineffective-dynamic-import warnings remain.
- Pinned Orca provenance **PASS**: 33,506 upstream file records, 248 documented adapted source hashes, 8,260 documented removals, original MIT license hash unchanged.
- New test is wired into the hosted foundation Node-forks retained IPC step.

## Exact-feature native Arch Wayland evidence

The built source commit `6eece2bcd45c230e76aa5f8da69b94d5b9957741` launched as a real native `ash-ide` Electron window on Arch Linux/Hyprland Wayland under a newly isolated private `/tmp/ash-gui-ready-qa-a0eknV/` profile. HOME/XDG directories, Ash userData, CODEX_HOME and CLAUDE_CONFIG_DIR were all disposable. No user's normal repository, provider credentials, browser profile, or hook configuration was accessed or changed.

The test created a single disposable `skill-workspace/.agents/skills/ash-qa-fixture/SKILL.md`, then invoked real `window.api.skills.discover({runtime:'host',cwd:skillWorkdir,sourceKinds:['repo'],names:['ash-qa-fixture'],refresh:true})`. The actual Main-process scan returned one skill named `ash-qa-fixture` with `sourceKind='repo'` and a `skillFilePath` under the disposable root. Every reported source kind was `repo`. The IPC map had **548 handlers** versus 547 before, with **exactly one** `skills:*` channel, `skills:discover`, and none of the excluded skill-cloud or bundled-plan channels.

The first-window startup barrier, isolated runtime pointer and native Hyprland window mapping succeeded. The renderer was reloaded with Electron stderr, console and CDP listeners in place. **19/19 assertions PASS.** Against the immediately preceding verified source baseline `5d7b423f` (`/tmp/ash-gui-ready-qa-bE26sl/`), distinct missing-handler names decreased **4 → 3**, removing exactly `skills:discover` with **no new names**. Remaining: `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`.

Both test-owned terminal-daemon and local-runtime stop commands exited 0, and no scoped profile processes remained. Detailed events, screenshot and result JSON remain in the disposable private test directory, not committed.

## Acceptance limits and next milestone

Native POSIX skill scanning has been exercised; **actual stopped-WSL behavior** is guarded by existing source and verified by a mocked resolver contract in this slice, not by a live Windows/WSL runtime. No real user provider profiles or authenticated agent turns were involved. Full native plugin/skill management, provider-authorized agent flow, trusted SessionStart correlation, full M8 and M2 remain **OPEN**.

Next classify the two legacy remote-development SSH startup requests against retained **ordinary Git over SSH** (which must not be damaged), and restore the Ash-owned updater status from a grounded local updater implementation without re-enabling unwanted Orca update/cloud services.

Hosted feature-tip CI, fast-forward integration, post-integration tests and hosted `main` CI remain separate final gates.
