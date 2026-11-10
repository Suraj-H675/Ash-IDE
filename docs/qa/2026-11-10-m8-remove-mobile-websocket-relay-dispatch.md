# M8 — remove mobile WebSocket relay dispatch and fail closed at RPC admission

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-local-ws-no-mobile-forward`, based on accepted `main` `93b1706191a19538db4a47c948fccf7545a58f48`.

**Classification:** Scoped M8 mobile and remote-execution exclusion. Not full M8, packaging acceptance, or comprehensive deletion of dormant upstream relay modules.

## Product and security boundary

- `RuntimeRpcWebSocketDispatch` has no `relayMobileRequest`, `MOBILE_RPC_METHOD_ROUTES`, `MOBILE_RPC_METHOD_ALLOWLIST`, or mobile-to-remote `mobileDesktopRelay.forward` / `forwardClientCapabilities` branch. Its remote execution-host selection, relay-local request rewriting and remote-forward fallback are removed from this active dispatch path.
- Independently of the encrypted E2EE handshake's mobile rejection established in the previous milestone, `handleWebSocketMessage` now refuses *any* registry entry whose scope is not `runtime`, before caller permission evaluation, RPC method lookup, dispatcher dispatch or any remote-forwarding decision. This also rejects callers that reach the internal method directly using a historically saved mobile token.
- Removed the excluded mobile relay pairing context and relay-host catalog injection from the live dispatch context. Kept local `deviceSelf`, runtime browser peer-client declaration, local binary stream dispatch, existing authenticated session capabilities, and existing runtime-scoped local session behavior.
- Replaced the 804-line inherited phone-allowlist integration test, which was already failing on accepted `main` due to explicitly excluded Ash features, with four Ash-specific negative/positive tests: historical phone denial without revealing method existence, no method execution, no remote-forwarding calls even with hostile `executionHost` metadata, local runtime browser `status.get`, and revocation of local runtime credentials. Updated the old scope and non-E2EE refusal tests to expect the stronger `unauthorized` boundary rather than legacy phone-specific routing results. Updated an excluded `pairing.registerDeviceKey` test to distinguish mobile `unauthorized` from runtime `method_not_found`.
- **No data migration, device revocation, registry cleanup, provider-account mutation, user-repository edit, vendor upload or remote connection** is performed by the implementation. Historical mobile credentials may remain on disk, but are unusable through Ash's live WebSocket and dispatcher.
- Retained local authenticated runtime WebSocket use where explicitly opted in, local PTY/terminal streaming, local browser sessions, developer-facing Git/SSH, native provider integrations and manually requested agent Runs.

## Evidence

- Offline frozen-lockfile dependencies: **PASS**.
- Focused mobile RPC, real mobile WebSocket rejection, local browser, E2EE wiring and device-key dispatcher: **25/25 PASS across six suites**.
- Expanded local browser, crypto/device-key, terminal streaming, revocation, WebSocket bound-host and reply-size, agent-launch replay, negative mobile admission and routing tests: **79/79 PASS across fourteen suites**. The prior baseline's obsolete allowlist test no longer asserts that unsupported mobile phone product RPC is usable.
- Full TypeScript project check: **PASS**.
- Targeted Oxfmt, native Oxlint and type-aware Oxlint `--deny-warnings`: **PASS**, zero warnings and zero errors.
- Pinned source provenance: **PASS**, 33,506 upstream Orca records, 344 adapted Ash source hashes, 8,268 documented exclusions and unchanged original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded Electron source build: **PASS**, built plain-Node daemon entry, sandbox preload verified, 255 renderer chunks / 7,836.4 KB minified. Inherited ineffective dynamic-import warnings remain. This is not a packaged AppImage runtime claim.
- Native Linux Wayland Electron source-app smoke using disposable profile `/tmp/ash-m8-no-mobile-forward-wayland-Z8vIFI`: **PASS**. Actual renderer title `Ash IDE`, DOM complete, preload present; `mobile`, `automations` and `speech` preload API surfaces absent, local `pty.spawn`, `nativeChat`, `settings` retained. HOME/XDG/Codex/Claude/GH/Git global config were redirected to the test profile. Test Electron and its three profile-matched helpers were stopped.

## Open items / bounded exclusions

The historical `runtime-rpc-mobile-method-routing.ts`, `runtime-rpc-mobile-method-allowlist.ts`, mobile scope policy in `rpc-caller-scope.ts` and agent launch authorization, `MobileDesktopRelay` class, relay/provider setter, saved device registry and outboxes remain as **dormant source**. They are no longer imported into the live WebSocket dispatch path but still have other callers and legacy tests. Their complete removal must be a distinct traceable change; this slice does not claim complete mobile subsystem elimination or that no mobile code is packaged.

Packaged AppImage, X11, macOS/Windows, authenticated real-provider agents, and comprehensive M8 asset/source exclusions are still unaccepted. Feature-branch and post-integration `main` CI are independent acceptance gates.
