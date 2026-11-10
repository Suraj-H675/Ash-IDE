# M8 — local-only headless Orcad startup and mobile push exclusion

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-orcad-local-only-no-mobile-push`, based on validated `main` `d78338a57c98d9eba34a6f083f00133167acef80`.

**Classification:** Scoped M8 headless-host and inherited serve CLI exclusion; **not** full M8, completed release packaging, or full native host end-to-end acceptance.

## Security and behavioral boundary

- Orcad's direct options API and command-line parser both reject wildcard, public, LAN, IPv4-mapped IPv6 and other non-loopback `--bind` addresses. Invalid direct startup options are rejected **before** the host adapters, data root and daemon are touched. Literal `127/8`, `::1` and `localhost` remain available; the inherited CLI launcher now defaults to `127.0.0.1`, not `0.0.0.0`.
- Orcad's default readiness no longer creates, publishes or advertises a client/mobile pairing offer. The existing readiness runtime ID, bound loopback endpoint and health-reporting shape remain; pairing explicitly reports `disabled_by_product`.
- The direct CLI and runtime options API reject mobile pairing, advertised pairing addresses and desktop-control grants. `--no-pairing` remains accepted solely for legacy launcher compatibility and does not enable pairing.
- Headless Orcad no longer imports, creates, starts or schedules `DesktopPushService`. This removes its former mobile gateway subscription, queued unregister upload and retry loop. Saved historical pairing/device data and vendor push registration records were **not deleted, migrated or contacted**.
- The normal Ash desktop RPC path already uses `enableWebSocket: false`. Orcad's retained local-only WebSocket and private Unix socket continue using the existing authenticated transport implementation; the mobile/pairing commands remain filtered by `ASH_RPC_METHODS`. No new unauthenticated transport was introduced.

## Verification

- Offline frozen dependency installation: **PASS**.
- Focused local-only Orcad/CLI/Ash RPC/serve-options suites: **25/25 PASS** (the initial test path typo was corrected and the suite rerun).
- Independent expanded Node Vitest forks with local-only admission, CLI, startup schedule exclusion, Ash RPC methods, 19 WebSocket bind-host assertions and retained manual Runs/worker recovery: **76/76 PASS across eight files**.
- Full project TypeScript check: **PASS**.
- Modified TypeScript Oxfmt plus native and type-aware Oxlint `--deny-warnings`: **PASS; zero warnings or errors**. Git diff whitespace check: **PASS**.
- Electron source build, unmodified daemon plain-Node entry smoke, sandbox preload verification: **PASS**. The existing ineffective dynamic-import warnings remain; renderer graph is 255 chunks / 7,836.4 KB minified.
- Pinned upstream source ledger: **PASS**, 33,506 upstream file records, 331 Ash adapted source hashes, 8,267 documented exclusions; original Orca MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.

## Remaining limits

This is source/boundary validation; it does not demonstrate a separately packaged Orcad/installer or a complete runtime listener/process-tree capture under disposable local data. The inherited headless local WebSocket implementation still contains legacy pairing handler code, while the published Ash RPC method table excludes pairing/mobile methods; complete vertical deletion of dormant mobile/remote services, vendor cloud, application plugins, and obsolete remote recipe paths remains an M8 task. The unused desktop-side push startup helper is still present in source and requires separate reachability verification before deletion. Browser extensions, manual orchestration, provider-native hooks/MCP, user repositories and credentials are retained. Feature-tip and post-integration GitHub CI and full Linux AppImage/Windows/macOS release acceptance are separate gates.
