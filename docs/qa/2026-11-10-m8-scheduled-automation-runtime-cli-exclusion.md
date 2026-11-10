# M8 scheduled automation runtime and CLI exclusion

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-exclude-scheduled-automation-runtime-cli`, based on `46cda416e10c64956bd625a365f328ff1c640833`.

**Classification:** Backend runtime and legacy CLI exclusion under D-005–D-008 and M8 EX-04/EX-10.

## Behavior

- Orcad startup no longer starts the scheduled automation service.
- WSL host startup no longer wires the saved schedule-wake loop; saved wake records are not read, cleared, or rewritten by this change.
- Scheduled automation RPC methods are absent from the registered RPC manifest and mobile relay allowlist.
- Legacy `orca automations ...` command specs and lazy handler routes are not registered.
- Managed idle exit no longer treats persisted schedules or historical unsettled runs as active work. Live terminals and working agents remain covered by their existing probes.
- Manual `orchestration` Runs, Ash terminal commands, browser automation, automation definitions and run history remain available or stored as applicable. No automation metadata or history is deleted or migrated.

## Compatibility

Existing clients may call the `automation.*` RPC methods or rely on the documented `orca automations ...` commands. Those runtime and CLI contracts are now unavailable and require a separate client migration. Manual orchestration Runs remain available through `orchestration.*` RPC methods and `orca orchestration ...` commands; they do not schedule future work.

WSL and SSH host-move helpers still contain automation `show`/`update` calls. Those move and undo paths need separate compatibility work before use against a runtime that no longer registers automation RPC methods; this change does not migrate or clean up their saved automation metadata.

## Verification

Codex's focused Vitest suite passed **14/14 assertions** (five files). Independent review reran the five focused suites plus manual orchestration Runs and worker-recovery tests: **43/43 assertions PASS** in seven files. Node/CLI/web typechecks, targeted Oxlint and Oxfmt checks, generated RPC catalog verification, Electron source build, and CLI build passed. The CLI build reported that the optional global `/usr/local/bin/ash-ide-dev` development symlink could not be installed without elevated privileges; no system-wide shortcut was changed.

The broad `pnpm run lint` did **not** pass: 22 of 41 steps failed, including missing `skill-guides/`, `skills/` and other upstream check inputs in this source-reuse checkout, plus unrelated repository findings. The bundled-guide flag test failed on three `serve` examples (`--recipe-json`, `--port`, `--project-root`); these exact failures were reproduced independently on the clean integrated `main` baseline. No tests or lint rules were weakened to silence them.

**Generated-guide limitation:** `src/cli/bundled-skill-guides.ts` is an inherited generated snapshot; the original `skill-guides/orca-cli/references/automations.md` source and other guide inputs are not present in this checkout. The embedded automation instructions were narrowed to a compatibility notice because the removed CLI commands must not be advertised. The canonical guide regeneration/verification gate cannot currently be completed from the missing source inputs. The generated reference must be reconciled when the guide-source packaging is corrected. Do not claim this limitation is resolved by passing the hosted foundation workflow.

This is a source-build and focused-regression verification, not a packaged AppImage or full M8 acceptance. The remaining WSL/SSH move and undo compatibility paths need their own source-reachability and fail-closed review before they can be considered safe in a fully retained workflow; no user migration data was changed by this slice.
