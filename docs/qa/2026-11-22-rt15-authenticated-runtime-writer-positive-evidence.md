# RT-15 — persistent runtime writer-positive observation

**Disposition: QA-only progress, production update NO-GO.**

The same authenticated local `runtime.providerActivity` RPC and strict
2-second/8-KiB socket budget from the earlier RT-15 diagnostic now also
reports optional **pending local Store writes**, **connected PTY sessions**,
and **PTY agent-owner claims** from the separately running local Ash host.
The method remains local-owner-only, has no input parameters, and returns no
session IDs, executable paths, prompts, account data, process environment,
tokens or transport secrets. An older host omitting these new fields remains
fully compatible and **unknown**, never an idle writer proof.
If the desktop's own daemon reports a complete zero, an absent or unverifiable
second runtime still forces the **combined** PTY and agent-owner inventories to
unknown. A regression covers both an older reply and a refused runtime socket.

The pending-write source is the real attached runtime Store's
`hasObservedPendingLocalWrite` observation. A paused real SQLite Store
write was observed through `RpcDispatcher` while uncommitted; after the write
settled, the observation returned zero without claiming complete coverage.
The desktop updater merges the two Store-positive signals with logical OR.

PTY observations read only the **already-connected** daemon adapters via
`listSessionsIfAlreadyConnected`, verify authenticated process incarnation
before and after the reply, deduplicate session IDs and agent identity digests,
and include bounded in-process fallback sessions when available. A 900-ms
budget bounds each already-connected read. A disconnected/malformed/replaced
generation contributes no positive count and does not imply no live PTYs.
Read-only tests cover multiple generations, duplicates, connected-identity
replacement, an indefinitely pending adapter, degraded fallback and retained
positive claims despite another generation's failure. The desktop takes the
maximum of its own and the separate runtime's positive PTY counts to avoid
double counting. Any positive cross-process observation is presented as
**incomplete/unknown with a positive lower bound**.

The actual separate-process authenticated Ash socket test verifies the RPC
and desktop preflight route; its provider/Store signal in the child is
**injected**, not a real external provider or actual child SQLite writer.
The separate real SQLite-backed Store test establishes the Store observation
on the runtime handler in-process, and connected-daemon inventories in unit
tests are authenticated-identity fixtures, **not live provider PTYs**. Do not
claim native AppImage, Wayland/X11, macOS/Windows, provider-native child
execution, browser-process enumeration or all persistence workers verified.

**Invariants:** No runtime or daemon process is launched or stopped by the
diagnostic. An unknown owner/PTY/provider/Store inventory remains unknown;
host-wide writer admission and an exclusive maintenance fence are not
implemented. Candidate signing and safe previous-version/settings rollback
remain unavailable. RT-15 production, PK-05 and PK-06 remain **NO-GO**;
`activationAvailable` remains `false`, and no install/download command is
exposed. A positive observation can block a future update, not authorize one.
