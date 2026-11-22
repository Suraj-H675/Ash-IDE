# M8 RT-15 — authenticated quiet-runtime recheck

**Scope:** read-only updater preflight observation, not update admission. The
production updater remains unavailable; release signing, an exclusive
maintenance fence, complete rollback, host ownership, provider-native agent
inventory, and pending-write inventory are still unresolved.

An authenticated daemon can acquire a new PTY after the initial
`listSessionsIfAlreadyConnected` result. Only for a census with **two
confirmed zero-window observations** and complete, apparently empty
daemon/PTY/agent-owner and fallback enumeration does Ash now make
one additional bounded connected-only census call to each authenticated
daemon generation, followed by a second degraded fallback read when
applicable. It does **not** connect a disconnected daemon, spawn a process, stop
sessions, acquire a release lease, or mutate user storage.

When either follow-up reports a live PTY, an associated claimed agent owner,
a changed daemon incarnation/provider, an incomplete inventory, or a timeout,
preflight returns **unknown** with any verified positive lower bound retained.
Positive PTYs from a replacement daemon are counted only when its new
incarnation matches the adapter's current authenticated identity.
In particular, a PTY started between reads produces `decision: busy`, not
a known zero. A previously observed active PTY or a busy/unknown window count
skips the extra reads because the first observation already requires deferral.
Similarly, if window counts
change between the first and final observations, their positive maximum is
retained as a busy lower bound, rather than being discarded.

Evidence is exercised at two levels: deterministic race/timeout/fallback/
restart fixtures and a real socket-backed, authenticated daemon-server harness
with a **mocked PTY subprocess** whose session appears between the two
read-only RPCs. This validates actual daemon IPC, not a live provider agent or
OS-level PTY child. Both sources are explicitly bounded.
This **narrows a time-of-check/time-of-use gap**. It never proves there are no
new processes, native provider sessions, active disk writers, or other
windows after the last observation. Only a complete, exclusive cross-process
maintenance and writer-admission protocol could do that.

**Acceptance boundaries:** RT-15 remains production **NO-GO**.
`hostOwnership`, `providerAgentSessions`, and `pendingDiskWrites` stay
unknown, and `activationAvailable` stays false. A quiet result continues
to be `decision: defer`, not approval or permission to terminate any runtime.
