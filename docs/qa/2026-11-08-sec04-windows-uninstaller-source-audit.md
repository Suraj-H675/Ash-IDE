# SEC-04 / SEC-08: Ash Windows uninstall co-installation boundary (source audit)

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Basis:** Ash IDE `feat/sec04-windows-uninstall-isolation`, originally based on `08e219b4`; the exact accepted commit is in Git history.
- **Platform of executed checks:** Arch Linux / Node 24 / Vitest. No native Windows/NSIS compiler or disposable Windows + Orca co-installation test was available.
- **Result:** `PASS` for source-level Windows uninstall ownership checks; **SEC-04 and SEC-08 remain PARTIAL**, because native package execution and full provider hook ownership are not tested.

## Risk found in the pinned source adaptation

The original `config/nsis/orca-installer-hooks.nsh` was still selected by the **Ash** Electron builder. On uninstall it could terminate `orca-terminal-daemon.exe`, delete `$LOCALAPPDATA\Orca\daemon-host` and `daemon-host-profiles`, and invoke the inherited `--orca-uninstall-remove-agent-hooks` preflight. Electron startup honored that preflight, and Windows normal quit also invoked a provider-global Grok hook remover. These effects would violate Ash and Orca co-installation isolation.

## Containment implemented

1. The NSIS builder now selects **only** `config/nsis/ash-installer-hooks.nsh`. The new macros use Ash-owned `AshIDE.Markdown` and `AshIDE.Tabular` ProgIDs for additive *Open With* associations, avoiding replacement of defaults and Orca's ProgIDs. Uninstall unregisters these Ash IDs and removes only the exact `$INSTDIR\resources\bin` CLI PATH entry. It does **not** remove user data, daemon profiles, or provider hooks, or issue process termination commands.
2. Electron's active startup path does not call either inherited Orca uninstall preflight. The original modules remain unreferenced for provenance/legacy test purposes and must not be wired back into Ash release startup.
3. Windows GUI teardown no longer deletes provider-global Grok hooks. The standard hook-disabled preference safeguard is covered separately by `ash-shared-hook-disable.test.ts`.
4. The existing exact-path PATH cleanup helper was adapted into `config/nsis/ash-user-path-cleanup.nsh` with the pinned MIT source attribution and renamed local constants/macros. The source logic preserves other PATH entries and retains the original registry value type when possible.

## Executed validation and limits

- Five new **static** NSIS/source guard tests were first run on the old version and all failed, exposing the inherited installer file, both uninstall preflights, Grok shutdown cleanup, and missing Ash-only scripts. The corrected tests passed.
- Additional focused tests cover the existing uninstall-remover helper (still available as unused legacy source), normal quit behavior, and disabled-hook preservation. The existing test helper's ability to remove hooks **does not mean Ash calls it**.
- Full typecheck and Electron/CLI source builds are required before integration. The source-provenance ledger is regenerated after adapted upstream changes.
- **No NSIS package was compiled or installed on Windows.** This audit does not prove a Windows installer script compiles, that Windows registry changes are reversible in a live host, or that the built uninstaller behaves correctly. Those require Windows build/VM E2E evidence before PK/SEC release acceptance.
- This slice does not implement the planned Ash-owned, reversible provider-hook ownership ledger. Until that exists, shared provider hook removal must remain disconnected from Ash's automatic settings, quit, and uninstall paths.
