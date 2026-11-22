# RT-15 hosted browser backend positive observation

**Updated 2026-11-23. Disposition: QA-only candidate; production update NO-GO.**

Ash's persistent `orcad` runtime can retain a headless Electron or Chromium
browser provider after desktop windows close. The local-owner-only
`runtime.providerActivity` diagnostic reports a positive lower bound over the
authenticated local runtime RPC. It starts no browser work and returns no page
IDs, URLs, tabs, cookies, paths, or process IDs. Unknown or invalid reads remain
unknown. `activationAvailable` remains hard-coded `false`.

## Recovery and profile ownership

A disposable Linux fixture first reproduced the destructive false-absence case:
a live child held an open file under its profile while the profile path was
absent from a complete `ps` command-line snapshot. The former classifier called
that snapshot `absent`, and cleanup deleted the profile while the child could
still read its open file. The regression test now preserves the same markerless
profile after the owner loses its child handle. Process scans are veto-only:
a positive profile-path match blocks cleanup, while `absent`, `unknown`, or
`unavailable` never proves that an ownerless profile is safe to delete. An
ownerless profile therefore remains preserved and startup reports a
user-mediated recovery block instead of silently starting a duplicate session.
No PID from an orphan process listing is signaled.

In-process cleanup uses only the provider's `ChildProcess` handle. It requests
the helper's IPC disconnect when connected and otherwise stops the owned child
or process tree, requiring observable exit confirmation. Unresolved stop keeps
the ownership state and profile, so a later start cannot silently duplicate an
uncertain live session. Profiles that were allocated but never passed to a
child can be cleaned through their durable owner record. Confirmed cleanup
publishes a durable private GC intent, moves the profile into an identity-bound
quarantine, rechecks record and directory identity around the rename and
removal, and retries from the intent after a deletion failure. Malformed owner
or GC records, profile replacement races, and failed removal preserve data and
block cleanup. A failed Windows secure-record publication does not replace the
prior owner record; retry can proceed from the prior record.

Windows CIM snapshots with unreadable command lines are `unknown`, including
unrecognized executable names. A failed scan returns `unavailable` and may be
retried; it does not become false absence. These rules remove the scan-failure
lockout for owned-child cleanup while retaining a deliberate recovery block for
an ownerless profile whose liveness cannot be established safely.

## Verification

The focused configured Vitest run passed **9 files and 56 tests**. It includes
the markerless open-file regression, malformed metadata, never-launched profile
cleanup, profile/quarantine race and retry cases, simulated secure-writer
failure, Windows scan failure and retry, a real subprocess IPC-disconnect and
relaunch fixture, and the authenticated local `runtime.providerActivity` socket
checks. The separate baseline reproduction demonstrated the prior false
absence and deletion behavior. A genuine installed Linux Chromium was also run
through the opt-in agent-browser integration under a private Xvfb display:
**2 real-browser lifetime cases passed**. That result is separate from the
fake-sidecar subprocess and authenticated socket fixtures.

Node typecheck, targeted lint, formatting, provenance verification, and the
release JavaScript build passed. Repository-wide lint did not pass: its run
reported unrelated findings across the existing checkout, including 25 of 39
lint steps failing, missing mobile checkout inputs, and unrelated process-host
boundary findings. The changed files passed their scoped lint checks.

Windows secure ACL behavior was not exercised on native Windows; its failure
path was simulated on Linux. No native Windows or macOS validation is claimed.
Production RT-15, PK-05, and PK-06 remain **NO-GO**. No activation, install,
release, or public push is authorized by this receipt. ChatGPT owns final
independent acceptance and the GitHub CI decision.

Browser tabs, downloads, sessions, network activity, complete process inventory,
global writer admission, update fencing, signing, and rollback remain outside
this proof. Chromium shutdown queue backlog remains a separate defect.
