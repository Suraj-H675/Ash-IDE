# M8 — excluded application-managed remote SSH startup: native Wayland

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** verified `main` `526e379cfd834ae3d239d55e056f67e961d57d80`
**Feature:** `feat/m8-excluded-remote-ssh-startup`; code commit `6caddd054ac993f6aeea447c0cd2fd1b57405358`
**Classification:** Partial early M8 exclusion of passive remote-development startup; **not** full remote-development source/UI removal or full M8/M2 acceptance.

## Approved boundary and changes

Decision D-005 and the approved feature capability matrix exclude **application-managed SSH remote host/workspace/agent deployment, remote development and automatic remote-host reconnect**. Ordinary `ssh` invoked from a terminal and normal Git-over-SSH remain retained and must continue to honor the user's existing SSH configuration and credential helper. Ash must not import or rewrite a user's `~/.ssh/config` automatically to populate a retired remote-host UI.

The renderer's always-mounted application-lifetime IPC bridge no longer installs `registerDirectSshStateIpcBridge`, which previously performed automatic `ssh:listTargets` hydration and then `ssh:importConfig` passive sync even in an empty Ash profile. Startup session hydration no longer reconnects saved remote SSH targets before restoring terminals. Its bound action selector drops three remote-host connection callback dependencies. **Saved session/store data was not deleted or rewritten by this patch**; any historical remote targets require separate migration policy.

The legacy SSH Main/preload APIs, remote-host settings, explicit remote-host UI and remotely owned terminal/session data still require classified removal/handling in later M8 work. This patch neither registers missing remote-host IPC nor changes shell command execution, Git's SSH transport, Git identity, SSH keys or configuration. It does not demonstrate an actual Git-over-SSH network transaction.

## Source verification

- Node Vitest forks: **10/10 PASS** across the existing renderer startup exclusion suite and application-plugin boundary suite. The new selector contract verifies startup actions do not subscribe to remote-host SSH callback changes, while retained local actions remain stable.
- Node/renderer TypeScript: **PASS**.
- Oxfmt, native and type-aware Oxlint with denied warnings: **PASS**.
- Electron source desktop bundle: **PASS**, sandbox preload verified; existing ineffective dynamic import warnings remain.
- Provenance ledger: **PASS**, 33,506 pinned upstream source records, 248 adapted source hashes, 8,260 documented removals and unchanged MIT license SHA-256.

## Native Arch Wayland on the exact source commit

Launched real Electron `ash-ide` source app on Arch Linux/Hyprland Wayland with fresh private `/tmp/ash-gui-ready-qa-FWnmfI/` HOME, XDG configuration/data/state/cache, Ash user data, CODEX_HOME, CLAUDE_CONFIG_DIR and browser state. No user provider credentials, real repositories or host SSH configuration was read or changed by the fixture.

The mapped visible Ash IDE window, Main's first-window startup barrier, persistent local runtime pointer, renderer reload, existing retained GitHub PR-refresh handler delivery, provider usage state, and provider-native disposable `.agents/skills/ash-qa-fixture/SKILL.md` discovery all passed. **19/19 native assertions passed**. The Main handler map remained at **548** registered endpoints. Both profile-scoped runtime and terminal daemon stop commands returned exit 0, with no temporary-profile processes left running.

Compared against the immediately previous integrated source baseline `526e379c` (private `/tmp/ash-gui-ready-qa-a0eknV/`), **3 distinct missing startup IPC handler names fell to 1**, removing exactly `ssh:importConfig` and `ssh:listTargets` with **no new names**. The remaining single name is `updater:getStatus`.

## Remaining gates

The retained ordinary Git/SSH path was untouched but not independently tested over a remote SSH connection. The old remote-host settings/routes, passive-sync helper, SDK/provider files and saved remote-session migration still need an M8 audit; the raw startup-error count alone does not prove complete feature removal. The Ash desktop updater status remains to be restored with correct packaged/development unavailable-state handling, rather than installing obsolete Orca updater cloud endpoints.

Before accepting this slice on `main`, exact-tip hosted feature CI, deliberate fast-forward, post-integration tests and main CI must pass. Full M8, real Claude/Codex authenticated sessions, SessionStart trust correlation, Windows/macOS and packaged release acceptance remain **OPEN**.
