# M8 RT-15 — positive native Chat provider-child evidence

**Scope: read-only diagnostic only; production updates remain disabled.**

The desktop's `updater:getPreflight` status path now reads the already-installed
Structured Chat host registry, without creating a provider or connecting to a
daemon. It counts only loaded sessions whose published status reports
`hostExecutionOwned === true`. A loaded but resting chat is not counted.
This count is a **positive lower bound on provider children hosted by this
process**, not a census of other Ash processes, providers, agents, or hosts.
Only the number is surfaced; session IDs, prompts, accounts and paths are not
included in the updater response.

The runtime census retains a positive observation sampled before and after
asynchronous authenticated daemon reads. An absent registry, unreadable status,
invalid count or observed zero leaves provider inventory **unknown**, never
`known: 0`. The preflight reports `busy` if a positive host-owned provider child
was observed, even if no window or PTY was observed. It still includes the
`provider-agent-inventory-unknown` blocker, and update activation remains
`false` unconditionally. The Settings diagnostic explains the limited
in-process evidence and does not offer install, download or stop actions.

The test path exercises real census collection and preflight assessment through
the desktop composition root using a simulated host registry, plus changed
observations during an authenticated PTY census, failure/invalid samples, and
the visible Settings result. **No real provider child or cross-host native Chat
session was started in this test.** The source-based host status contract,
compiled bundles and the full foundation CI lane are separate gates.

**Still NO-GO:** complete provider-native/PTY/browser/daemon writer admission,
authenticated host-wide census, signed release identity (PK-05) and complete
state rollback (PK-06) remain unproven. RT-15 production is **NO-GO**; this
report must not enable automatic updates or change the default disabled
updater state.
