# M8 RT-15 — authenticated local runtime provider-child observation

**Disposition: QA-only progress, not host-wide update admission.**

The read-only `updater:getPreflight` path now combines two *positive* observations:
the desktop's own Structured Chat host and this profile's authenticated local
runtime RPC (`runtime.providerActivity`). Both use the same in-process
`hostExecutionOwned === true` published-status evidence. The receiver uses the
**maximum** observed count rather than adding counts that might refer to the
same provider child. It never treats zero as a complete inventory.

The runtime method is restricted to the local authenticated owner socket:
remote/paired clients are refused, it accepts no parameters, and returns only
its runtime ID and an unknown provider inventory with an optional positive
lower bound. It does not return session IDs, prompts, paths, or account data.
The desktop reads the existing runtime metadata (without starting a runtime),
uses the existing authenticated socket protocol with a two-second timeout and
an 8 KiB **cumulative** response cap, validates the result schema, and requires the returned
runtime identity to match the metadata. Missing, unavailable, malformed or
replaced runtime evidence contributes no positive count, **not** a known-zero
provider census. Pending writes and other inventory blockers remain intact.
The diagnostic opts into a strict socket budget: keepalive messages cannot
extend the absolute timeout, every received byte counts toward the cap, and
the client forcibly destroys the socket upon completion. Browser-sidecar RPC
requests retain their pre-existing idle timeout, buffered limit, and graceful
close policy. Three real-socket regressions first failed against the prior
behavior and now verify the strict timeout, cumulative cap, and client socket
destruction with a deliberately half-open peer.

**Integration proof:** A separate real Node process hosted the actual Ash RPC
server on a disposable Unix socket; the desktop-side client read the server's
published credentials and runtime ID, received one positive provider-child
count, checked the rejected wrong-token path, and passed the observation through
the actual read-only census/preflight as `busy` with activation unavailable.
The test installed a simulated Structured Chat status source inside that server;
it did **not** start a real external provider, test a cross-profile runtime
handoff, or establish complete provider/PTY/browser writer enumeration. Focused
tests cover malformed/mismatched replies, inactive/missing/failed status feeds,
the remote/paired exclusion and maximum-versus-sum behavior.

**Still NO-GO:** Exclusive authenticated host-wide writer admission,
cross-platform runtime takeover/rollback, complete pending-disk-write coverage,
and package trust/release rollback (PK-05/PK-06) remain unproven. RT-15
production activation is forbidden. The diagnostic neither stops sessions nor
exposes installation/download actions; update availability remains disabled.
