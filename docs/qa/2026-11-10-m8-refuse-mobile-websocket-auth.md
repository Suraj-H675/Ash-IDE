# M8 — refuse mobile-scoped WebSocket authentication and retain local runtime clients

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-refuse-mobile-ws-auth`, based on accepted `main` `d1ae1a081f7981409424714eda70f8c219e69063`.

**Classification:** Security hardening of the production localhost WebSocket/E2EE authentication boundary and local browser capability support. Not complete M8 or packaged release acceptance.

## Product and security boundary

- `MobileSocketWiring` now admits only registry entries whose saved device scope is **`runtime`**. This applies to both legacy bearer-token authentication and v2 signed device-key proof authentication. Mobile key lookups return the explicit `refused` verdict (not `unknown` or `device_revoked`) so rejected historical phone credentials are not implicitly deleted by clients.
- After authentication, every subsequent encrypted frame revalidates the registry principal **and its runtime scope**. A socket whose saved device switches to mobile closes with unauthorized status before invoking local RPC, binary handlers or client event listeners.
- No credential file, user repository, device registry record, provider configuration, or personal profile was deleted or migrated as part of this change. Separate internal mobile-offer source remains reachable programmatically but cannot authenticate on the production WebSocket; routine Orcad startup already mints no phone offer and desktop publishes no mobile pairing UI.
- Retained runtime-scoped local browser E2EE handshakes, device-key forks and replay protection, revocation cascades, session-tabs subscriptions, terminal streaming, and user-directed agent-launch replay. The WebSocket dispatcher now permits **authenticated runtime clients** to update only their own connection's capability set; upstream had limited that handler to mobile clients, which would break the retained browser's capability negotiation.
- Updated inherited Orca tests which expected successful mobile authentication to cover permitted runtime-scoped clients instead. The previously accepted `pairing.registerDeviceKey` RPC exclusion remains enforced; direct cryptographic device-key registration semantics stay tested in the isolated helper. Local runtime revocation tests no longer fabricate mobile relay and push registrations on runtime-scoped devices.

## Actual verification evidence

- Frozen-lockfile offline dependency installation: **PASS**.
- Real E2EE token and device-key authentication, permitted browser key/session pairing and durable agent-launch replay: **28/28 PASS** across four suites. Added mobile bearer and signed-key denial tests, saved-credential preservation and a scope-change-after-authentication rejection test.
- Expanded actual WebSocket server, binder, live terminal streaming, revocation, device-key dispatcher, local browser, legacy relay-denial and request-size regression matrix: **74/74 PASS** across twelve suites. A standalone production `OrcaRuntimeRpcServer` integration test additionally verified real localhost socket mobile-token rejection and runtime-browser `status.get` success: **1/1 PASS**, bringing the verified total to **75/75** across thirteen distinct suites.
- Full TypeScript project check, Oxfmt, native and type-aware Oxlint `--deny-warnings`: **PASS, zero warnings or errors**.
- Electron production source build, unmodified plain-Node daemon-entry guard and sandbox preload guard: **PASS**. Renderer graph: 255 chunks / 7,836.4 KB minified. Inherited ineffective dynamic-import warnings remain.
- Pinned Orca source provenance: **PASS**, 33,506 upstream file records, 341 current Ash source adaptations, 8,268 documented removals, original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.
- Native Linux/Wayland source Electron boot via isolated profile `/tmp/ash-m8-runtime-ws-wayland-5ljIN2/`: **PASS**. Read `document.title=Ash IDE`, DOM complete, preload available; mobile, automations and speech preload APIs absent, while PTY spawn, native chat and Settings were present. HOME/XDG/Codex/Claude/GH/Git global configuration were isolated, and test Electron plus three profile-matched helper processes were terminated.

## Legacy baseline and remaining gates

The previous accepted `main` still fails the old `runtime-rpc-mobile-method-allowlist.test.ts` suite (1/1) and the obsolete successful `pairing.registerDeviceKey` dispatcher tests (2 failures); this was verified **on that baseline before modification**. This branch corrects the device-key dispatcher suite by asserting Ash's actual `method_not_found` contract; the inherited mobile allowlist suite still requires a separate M8 removal or replacement because it exercises excluded product integrations directly rather than authenticated Ash clients. It is not presented as a newly passing suite and no checks were disabled to conceal it.

Packaged AppImage, standalone bundled Orcad listener/process-tree tests, Windows/macOS native smoke, complete mobile relay and pairing-source retirement, general IDE plugin deletion, and real provider-authenticated sessions remain unaccepted. Feature-tip and integrated-main GitHub CI are separately required before accepting this milestone.
