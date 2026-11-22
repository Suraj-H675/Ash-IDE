# RT-15 — hosted browser backend positive observation

**Disposition: candidate for QA-only acceptance; production update NO-GO.**

Ash's persistent `orcad` runtime may retain a headless Electron or Chromium
browser provider when every desktop window has closed, including a helper
whose shutdown or install-park cleanup is still unresolved. The existing RT-15
read-only updater diagnostic now receives a positive browser-backend
availability observation from the same authenticated local runtime RPC used
for native Chat, PTY and Store write evidence. No new socket, remote endpoint,
IPC permission, browser navigation, or updater activation is added.

`startOrcadBrowserProvider` registers a process-local, read-only availability
probe against the **actual resolved provider**. The probe does not start or
connect to a browser. On clean stop it is removed only after the provider's
asynchronous cleanup resolves. This includes a positive latch at the start
of shutdown because actual Chromium and Electron providers clear their
availability flags **before** waiting for child cleanup. Aborting command
admission cannot prematurely hide a helper that is still shutting down.
A replaced provider's cleanup cannot erase its successor's observation.
Failed cleanup retains the probe until a successor registers or the process
exits. If startup launches a helper but then fails before returning a provider,
unresolved startup cleanup also retains the positive lower bound. Failed reads
contribute no positive count but do not prove absence.

An installed Electron provider also supports a macOS bundle install-park,
which can stop or restart its helper without going through the outer
`orcad` shutdown. The actual provider's internal stop/start callbacks track
pending helper cleanup and a failed-cleanup uncertainty signal until the next
successful stop or restart. This is separate from command availability and
never launches browser work from the diagnostic.

The local-owner-only `runtime.providerActivity` snapshot samples provider
availability or unresolved helper cleanup before and after its bounded daemon
observation, retaining a positive across a startup/stop race. The response
includes only `browserBackends: {state: 'unknown',
reason: 'browser-backend-inventory-unavailable', lowerBound: 0|1}`; no page
IDs, URLs, tabs, cookies, host paths or process IDs are returned. Older servers
may omit the optional field. The desktop validates the schema, runtime identity
and strict two-second/eight-KiB socket budget; absent, unreachable or invalid
responses remain **unknown**, never a verified no-browser condition. Positive
evidence yields `busy` with an explicit blocker. The UI describes an observed
browser backend **or unfinished helper shutdown**, not a live tab, running
navigation or complete browser-process census.

**Test boundaries:** process-local registry tests cover false/exception reads,
available backend state, replacement ownership and cleanup. The real
`startOrcadBrowserProvider` control flow is tested against simulated resolved
providers, including pending asynchronous stop, failed cleanup, and unresolved
startup cleanup before a provider object is returned. A Linux opt-in integration
fixture starts the actual Chrome for Testing 156.0.8078.4 backend with
agent-browser 0.39.4 in a unique disposable profile under Xvfb. It pauses the
identified Chrome process with `SIGSTOP`, starts provider shutdown, verifies
shutdown remains pending and the positive lower bound stays set, resumes the
process, and verifies confirmed cleanup clears the signal. A second run injects
a nonzero `close` helper result after startup, confirms the real Chromium
process remains alive, and verifies the positive lower bound is retained even
though provider shutdown returns. The fixture is opt-in with
`ASH_RT15_CHROMIUM_EXECUTABLE` and `ASH_RT15_AGENT_BROWSER_BINARY`; without
both variables it is skipped. Each run owns and removes its unique temporary
profile and only targets processes whose arguments name that profile.

An additional integration fixture uses the **actual Electron provider
install-park stop/start callbacks** through the real startup/provider code,
substituting a mocked Electron child. It covers clearing availability before
awaited cleanup, failed stop, and successful restart. Existing separate-process
authenticated socket tests exercise the response and desktop merge using an
injected availability probe, **not a real Chromium/Electron child**. Additional
negative tests reject fabricated complete/invalid availability reports.
Regression checks cover React Settings copy, updater decisions, TypeScript,
provenance, source formatting, release JavaScript build and existing
startup/runtime-admission gates.

**Not established:** actual macOS installed-Electron child/install-park
lifetime, Wayland or production X11 display integration, complete browser
tab/download/session inventory, network activity, all persistence-worker
identities, global writer admission, update exclusive fencing, package signing
or data-compatible rollback. Availability is a **conservative positive
signal**, not proof that a user is actively browsing. `activationAvailable`
remains `false`; RT-15 production, PK-05 and PK-06 remain **NO-GO**.
