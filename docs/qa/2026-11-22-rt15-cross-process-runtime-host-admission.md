# RT-15 — cross-process desktop and serve host admission (QA evidence)

**Scope: fail-closed, cooperating Ash host ownership. Not update activation.**

Ash desktop and `orcad` already share the `orcad.lock` process-incarnation
record. A removed or replaced pathname can leave that record unobservable until
the next heartbeat, which is insufficient by itself to exclude another writer.
On Linux, both host startup paths now also acquire an independently published exclusive
`.profile-state-access/runtime-host` owner before runtime profile admission.
That owner uses the existing PID, boot, machine and process-start identity
checks for stale-owner recovery, and refuses unverifiable live owners. CLI
readers remain non-exclusive profile participants; profile maintenance has a
separate exclusion fence. This is not an OS-level lock against arbitrary
external writers or older software that does not participate in the protocol.

**Cross-platform limit:** The additional runtime-host claim is only activated
for Linux desktop and server startups. macOS and Windows retain the existing
shared instance-lock behavior; this milestone does not claim that removing
that lock file on either platform is safe. A second cloned Windows host may
share its hostname and MachineGuid, while a macOS clone may share hostname and
IOPlatformUUID but not its boot session. Automatic recovery of the new owner
has not been proven safe on those platforms. Its public acquisition entrypoint
refuses non-Linux callers. The internal owner-reclaim guard also refuses
macOS runtime-host records with missing or mismatched boot/machine identity,
including when their file timestamps appear old. Never delete an ambiguous
owner record without independently verifying that the prior owner has exited.

Desktop startup requires the shared and independent owners or exits before
opening profile state. The packaged macOS diagnostic bypass applies only to
Electron's singleton check, not the Ash profile writer lock; the pre-existing
disposable E2E bypass remains restricted to that test path. The `orcad.lock`
reader requires a regular file and uses nonblocking open to refuse a FIFO
instead of hanging. Both desktop and serve retain the independent owner until
process death if their shared lock is displaced. Desktop attempts a native
notification and terminates immediately without an unsafe final write; OS
notification delivery is best-effort, not guaranteed.

The real-process Linux regression uses disposable user-data directories and
verifies desktop/server contention in both directions, displaced shared lock
paths, a substituted FIFO, orphaned-owner recovery after `SIGKILL`, and normal
readmission after safe release. Unit checks verify startup refusal before
profile reads, the diagnostic-bypass boundary, notification invocation and
emergency exit even if notification fails. A Linux CI regression simulates
the macOS identity branch with an aged cloned-host owner record and confirms
both mismatched and missing boot IDs are refused, plus direct non-Linux
host-admission refusal; these are not native macOS or Windows tests. The existing SQLite pending-write
preflight remains unknown/defer when all observable local writes are quiet.

**Linux cloned-host recovery boundary:** When deciding whether an existing
runtime-host owner can be reclaimed, Ash checks the filesystem containing the
actual owner directory using the existing local-storage classifier. If the
storage is shared, foreign, or unrecognized, the claim is not automatically
reclaimed even if its timestamp predates this boot or its PID is absent here.
A locally classified directory retains normal stale-owner reclamation after
an exited host or reboot. A classifier result is not cryptographic proof of
exclusive physical storage: unusual shared block devices or stacked filesystems
remain outside this QA proof and must not be treated as production admission.
Shared-profile crash recovery may require explicit independent verification
and manual intervention; never blindly delete a disputed owner entry.

**Acceptance limit:** RT-15 is QA-only. This work does not establish complete
cross-process daemon, browser, agent or provider-native writer coverage; it
does not grant global maintenance admission or transaction rollback authority.
Neither a clean observation nor possession of this host owner may enable
automatic updates. RT-15 production, PK-05 and PK-06 remain **NO-GO**.
