# M8 RT-15 — positive local Store write observation

**Scope: a real persistence safety signal in the desktop's read-only update
preflight, not production update admission.** The desktop Store owns
asynchronous SQLite profile state and locally scheduled saves. A prior
preflight could report no active windows or PTYs while a real SQLite writer was
still working. The Store now offers a synchronous, read-only boolean
observation of its own pending/dirty persistence state, including scheduled
profile writes, current queued writes, snapshot work, in-flight profile
flushes/maintenance, profile database backup rotation, GitHub cache writes,
pending automation runs and active-view preference writes.

The trusted updater IPC handler receives the actual startup Store, not a
file path or arbitrary client-supplied identifier. The census samples its
write observation before and after the bounded daemon inventory and retains
any positive sighting. An observed local write reports an unknown
pendingDiskWrites census with lowerBound 1, adds the
pending-disk-writes-observed blocker and returns **busy** even with no
windows or PTYs. That lower bound represents at least one **local
persistence-activity signal**, not the exact number of pending transactions.
The Settings diagnostic labels this as local Store write activity instead of
counting disk transactions.
The IPC response contains no profile IDs, file paths, SQL rows, credentials or
state values.

If the local Store is quiet, missing or its observer throws, the result
remains **unknown**, with a lower bound of zero, not a known-zero count.
The desktop Store does not own all writes in the authenticated daemon,
browser profiles, provider-native processes, external editors or other host
processes. Sampling cannot prevent a new write after the final observation.
No observation admits a file migration, locks a writer, stops an agent or
activates the updater.

Integration evidence uses an actual disposable SQLite-backed Store and a
delayed write authority to hold an admitted profile update in flight. The
real Store-to-census-to-preflight path reports **busy** while that write is
held, confirms the setting was persisted after completion, and then returns
**defer** while the missing host-wide inventory remains unknown. Tests also
cover a transient signal, an observer throwing, an active-view preference
sidecar, a held background backup after the primary queue drains,
trusted/untrusted IPC access and initial Store registration.

**Still NO-GO:** RT-15 requires exclusive authenticated maintenance
admission, a complete provider and runtime-owner inventory, and a
cross-process writer fence; PK-05 needs approved Ash-only signed release
metadata, and PK-06 needs full state migration/restore compatibility and
tested binary-and-data rollback. Production activation remains false.
