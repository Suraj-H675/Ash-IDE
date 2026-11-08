# SEC-04 — durable Ash-private Claude settings overlay recovery

- **Date / platform:** 2026-11-08, Arch Linux x86_64, Node 24.22.1, Claude Code 2.1.286.
- **Base:** `9e83436f`; branch `feat/sec04-overlay-durable-recovery`.
- **Boundary:** local, experimental session-scoped settings; no production launch or global-provider configuration writes.

## Why

`createAshClaudeSessionSettings` previously returned a `sha256` receipt only in process memory. After a persistent host restart, a runtime with a saved session UUID could no longer recover the expected bytes safely, nor distinguish a legitimate unchanged overlay from an existing file with an identical name. A new Claude CLI process also needs its own explicit `--settings` flag, including on `--resume`.

## Change

For each UUIDv4 session, Ash publishes two files beneath **its own private userData** directory `provider-session-settings`: `claude-<uuid>.json` (the provider-facing hook settings) and `claude-<uuid>.json.receipt.json` (an Ash-only `{format:1,sessionId,sha256}` expectation). Both use exclusive, fsynced no-overwrite hard-link publication and mode `0600` under a mode `0700` directory. The settings file is published **first** so an existing file cannot acquire a newly minted ownership receipt. A process killed between publications leaves an incomplete pair, which is **never silently adopted, repaired, or deleted**. If receipt publication completed but the process died before removing its `.stage` hard link, recovery accepts that exact private inode-matched two-link state **without removing the stage**, but rejects a hard link to any other location.

`recoverAshClaudeSessionSettings(ashUserData, sessionId)` validates both private paths, receipt schema/size/mode/owner/inode, and the overlay bytes against the retained SHA-256. The caller needs only the saved Ash session UUID and its configured private data root; it does **not** copy provider credentials or trust the current contents as a new baseline. `claudeVerifiedArgsWithAshSessionSettings` recovers and verifies the pair **on each new Claude process launch**, then appends the documented argv pair without rewriting or overriding user-provided `--settings` flags. It is invoked by opt-in native E2E tests, not by the production launch path.

## Observations

- Disposable unit tests verify private receipt creation/permissions, unchanged provider workspace contents, sequential and simultaneous duplicate IDs, cross-root isolation, malformed/missing/wrong-session/tampered receipts, receipt symlinks and relaxed permissions, verified inode-matched receipt stage crash recovery versus unrelated hard-link denial, and both abandoned-settings and abandoned-receipt-stage publication states that must remain unavailable for recovery.
- The native Claude Code tests launch the real executable against a **loopback-only synthetic Messages API** and disposable provider homes, now using the recovered durable receipt to assemble argv for each separate initial/resumed process. Both foreign profile and Ash overlay `SessionStart`/`Stop` hooks still execute as previously proved; omitting `--settings` on resume still omits Ash's hooks.
- CI already includes the existing `ash-claude-session-settings.test.ts` unit file. Native executable cases remain explicitly opt-in and Linux-only, with the managed-settings host guard.

## Remaining gates

No automatic overlay cleanup on tab close, GUI exit, terminal exit, or runtime restart: those events cannot prove the user has deleted history or that no live process will resume. Do not add a `unlink`/expiry GC until the runtime can prove terminal incarnation termination, no outstanding uses (including after crashes), and explicit user-driven permanent session removal. The receipt is an integrity check within Ash's private account, **not a cryptographic defense against another process running as the same OS user that can edit both files**. Recovery from retained on-disk data (without the original in-memory record) is verified by tests and exercised for separate native Claude child launches, but a real Ash daemon crash/restart and GUI reattachment are **not** tested. The two-publication crash gap is modeled with disposable incomplete files; a real SIGKILL during publication is not yet part of this milestone. Provider-global write gate remains `false`; SEC-04 and AG-07 overall remain open.
