# RT-15 hosted browser backend positive observation

**Disposition: QA-only candidate; production update NO-GO.**

Ash's persistent `orcad` runtime can retain a headless Electron or Chromium
browser provider after desktop windows close. The existing local-owner-only
`runtime.providerActivity` diagnostic reports only a positive lower bound over
the authenticated local runtime RPC. It starts no browser work and returns no
page IDs, URLs, tabs, cookies, paths, or process IDs. Unknown or invalid reads
remain unknown. `activationAvailable` stays `false`.

Electron helper cleanup now follows the `ChildProcess` created by the provider.
It sends TERM, waits up to five seconds for the child exit event or state, then
sends KILL and waits another bounded five seconds. Signal errors do not count as
cleanup. If the owned process does not show exit, cleanup stays uncertain and
the profile and positive evidence are retained. Install-park stop/start uses
the same owner state and retries unresolved cleanup without an indefinite wait.

A restarted parent has no owned `ChildProcess` handle for a recorded orphan.
It does not signal that numeric PID. The profile is removed only when runtime
metadata identifies a process that is already absent. Missing or unusable
metadata, an unsafe profile, or a live process keeps the profile and fails
Electron startup closed. Normal in-process close, restart, and install-park
cleanup use the owned child handle.

The process-local observation registry keeps one active probe and a scalar
count of replaced registrations that observed a positive backend. A replaced
positive remains visible until that exact provider retires its registration
after confirmed cleanup. Retirement is identity-scoped and idempotent. The
registry does not retain a probe inventory; its public result remains only
`0 | 1` and is not a complete process census.

**Verification.** Targeted lifecycle, registry, provider, authenticated socket,
and updater regression checks passed: 12 test files passed, one file skipped,
106 tests passed, and two tests skipped. This includes the separate-process
authenticated local socket and updater gates. Electron child-stop tests use a
real disposable Node child and signal-failure fixtures. Orphan tests verify
that a live or unidentified process profile is preserved without signaling its
numeric PID.

The Linux real-Chromium integration fixture is opt-in. It observes the unique
fixture child's `/proc` start time and profile command-line arguments, sends no
PID signals, and uses provider-owned stop/retry for teardown. It retains the
temporary profile if the fixture child cannot be shown absent. Both integration
cases were skipped here because `ASH_RT15_CHROMIUM_EXECUTABLE`,
`ASH_RT15_AGENT_BROWSER_BINARY`, and `DISPLAY` were unset. The existing socket
test uses an injected probe, not an actual Chromium or Electron backend.
Typecheck, scoped lint, formatting, source provenance, and the release
JavaScript build passed.

Actual macOS Electron bundle/install-park behavior and production X11 or
Wayland display integration remain unverified. No native GUI acceptance is
claimed. Browser tabs, downloads, sessions, network activity, complete process
inventory, global writer admission, update fencing, signing, and rollback are
outside this proof. RT-15 production, PK-05, and PK-06 remain **NO-GO**.
