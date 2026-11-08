# SEC-04 — native Claude `Stop` coexistence and explicit resume transport

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Branch:** `feat/sec04-claude-stop-resume-native-e2e`
- **Test source:** `src/main/agent-hooks/session/ash-claude-native-stop-resume.e2e.test.ts`
- **Execution:** real installed Claude Code **2.1.286** on Linux, using disposable configuration only.
- **Production global-provider hook-write gate:** **closed**; no live launch callsite or global settings modification.

## Isolated test boundary

The opt-in tests spawn the installed Claude executable using their own private temporary `HOME`, `CLAUDE_CONFIG_DIR`, XDG cache and working directory, plus a separate private Ash `userData`. A generated provider `settings.json` supplies two foreign hooks, and an Ash-owned session `--settings` file supplies two more. Hook scripts intentionally have filenames containing spaces and apostrophes to exercise shell-argument quoting. Hook scripts record only synthetic event metadata to the temporary JSONL file; after each case, all fixture state is removed.

The Anthropic key is a fake literal. `ANTHROPIC_BASE_URL` is an ephemeral `127.0.0.1` HTTP server in the test process. That server provides a **synthetic** successful `/v1/messages` streaming response (`OK`) in the documented Anthropic Messages SSE format. No genuine Claude inference, account authentication, provider endpoint call, provider credential, or user workspace is involved. CLI auto-updates and nonessential traffic are disabled. To avoid managed policy overriding the synthetic endpoint, the test is **Linux-only** and refuses to launch a CLI child whenever the system-managed Claude settings root `/etc/claude-code` exists or cannot be inspected (according to the [Claude settings documentation](https://code.claude.com/docs/en/settings)). This is a conservative host preflight, not a network-namespace firewall or a claim about adversarial root-level policy changes after launch. A separate bounded CLI child is started and awaited for every turn; cleanup targets only that child.

Run locally only if an already installed native executable is present:

```bash
ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/absolute/path/to/claude \
  CI=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run \
  --config config/vitest.config.ts --pool=threads --maxWorkers=1 \
  --no-file-parallelism \
  src/main/agent-hooks/session/ash-claude-native-stop-resume.e2e.test.ts
```

Ordinary CI does not invoke this opt-in file. The existing `SessionStart` test remains separately opt-in.

## Observed native outcomes

| Native case | Observed behavior | Result |
| --- | --- | --- |
| Completed synthetic CLI turn | Both isolated user-profile and Ash overlay hooks execute for **`SessionStart`** and **`Stop`**, once each; CLI prints `OK` and exits zero | PASS |
| `--resume <session-id>` with the **same** Ash `--settings <overlay-path>` argument | Both sources execute both hook events again; the assertion checks the **new events from the resumed process**, not just the cumulative log. The JSON hook input identifies `source: resume` on its `SessionStart` pair | PASS |
| `--resume <session-id>` **without** Ash's `--settings` argument | After proving all four hooks in the first turn, only the foreign profile's `SessionStart` and `Stop` hooks appear in the resumed-turn **log delta**; no additional Ash hook runs | PASS |

The three tests each use synthetic messages and verify the Ash overlay's SHA-256 against its recorded content; the foreign settings remain byte-identical. Every observed hook JSON event also retains the expected Claude session UUID, including the resumed process. All three independent reviewer findings (managed-policy override risk, aggregate-event false positive, and foreign-hook shell path escaping) were corrected in a follow-up verification commit. The native processes complete rather than being terminated before the `Stop` event. The tested overlay was prepared with `createAshClaudeSessionSettings`, not handwritten command flags.

**Verification at this milestone:** all **3/3 new native tests passed in three additional independent runs** after the initial pass. The combined original `SessionStart` plus new Stop/resume opt-in suite passed **5/5**, existing session-overlay unit tests passed **11/11**, lint/format checks reported no errors, and the repository TypeScript project check exited zero. The native cases do not run on ordinary CI runners without the explicit executable opt-in.

**Architecture finding:** a prepared Ash overlay is **not implicitly inherited by a new Claude process on `--resume`**. Any future production launcher supporting an Ash-scoped Claude overlay **must explicitly re-supply its verified `--settings` argv pair on each resumed process**. Do not infer session attachment from a file's mere existence or from the provider's conversation history.

## Deliberately unaccepted

This is a fake-model **protocol fixture** proving native hook dispatch and process/restart argument behavior. It is **not** authenticated inference or a live-provider compatibility guarantee. It does not prove managed policy precedence, other hook event types, status projection accuracy, account identity, PTY/runtime/GUI recovery, real token accounting, Windows command quoting, or safe overlay garbage collection while another session may still use the file.

**Verdict:** native `SessionStart` and `Stop` hook coexistence and explicit same-overlay `--resume` are verified on this Linux/Claude build. SEC-04 and AG-07 remain **open**. `canAshWriteProviderGlobalHooks()` stays `false`; production launch attachment is not enabled.
