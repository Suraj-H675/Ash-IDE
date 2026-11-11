# M8 — retire unreachable Orca vendor organization-member administration

**Date:** 2026-11-11 (Asia/Kolkata).

**Workflow:** One writer directly on the existing canonical `main` checkout `/home/suraj/projects/Ash-IDE`, starting from accepted SHA `d7e93ed62acf3b0cce6bb43c05adbff88fedc91b`. No new Git branch, worktree, repository, history rewrite or worktree deletion.

**Classification:** Scoped M8 cloud-account exclusion, **not** complete vendor-cloud elimination, full M8, or packaged release acceptance.

## Reachability review and implementation

- Verified the desktop startup's production IPC registration path does **not** call `registerOrcaProfileHandlers`, the inherited profile IPC module that once installed cloud sign-in and organization-member administration. The old `registerOrcaProfileOrgMemberHandlers` hook was only referenced from that unregistered module. This means its source definitions were dormant, not evidence of an active network endpoint. No change to the existing local profile startup/index storage was necessary.
- Removed four pinned Orca source modules: `src/main/ipc/profiles/orca-profile-org-members-handlers.ts`, `src/main/orca-profiles/profile-cloud-org-members-service.ts`, `profile-cloud-org-members-client.ts`, and `profile-cloud-dev-org-members.ts`. They implemented cloud membership roster, invitations, invite revocation, member role changes and member removals.
- Removed the organization-admin handler import and registration from the dormant `orca-profiles.ts` handler. Removed the five deprecated organization-admin methods from `src/preload/api/orca-profile-api.ts`, its desktop IPC bridge and the browser fallback API.
- Preserved the underlying local profile model, browser session partitions, profile index/storage paths, project transfer state and recovery, `list`, `createLocal`, `switchProfile` and `transferProject` method definitions. Other legacy Orca Cloud sign-in/auth/session/organization-selection source remains **outside this slice** and must be audited independently; its retained source is not an approved Ash vendor account service.
- Added `src/main/ipc/profiles/ash-excluded-cloud-org-admin.test.ts` to verify all four removed files are absent, the five organization-admin methods do not appear in desktop/web preload contracts, the main handler no longer references their registration, and actual browser-fallback local profile listing/creation and switching remain functional. Registered this test in the retained GitHub foundation IPC job.
- Added four original Orca pinned `sourceSha256` records to `docs/provenance/ash-exclusions.json`, preserved other exclusion entries and original MIT license attribution; updated current adapted source hash ledger. No user repository, app profile, provider account/credentials, browser partition, historical device record or unrelated application data was modified/migrated. All native GUI tests used a disposable private profile.

## Observed local evidence

- New exclusion and local profile fallback plus retained renderer/locale tests: **9/9 PASS across 3 suites**.
- Expanded local profile state recovery/write-failure, encrypted browser E2EE, device-key/WebSocket scope checks, native PTY/terminal, agent launch/replay, historical revocation, renderer/preload gate and cloud exclusion matrix: **274/274 PASS across 36 suites**. Existing inherited test fixture warnings about stale terminal handles and optional mobile tab selection were nonfatal.
- Full TypeScript project check, Oxfmt, native and type-aware Oxlint with `--deny-warnings`: **PASS**, zero lint warnings/errors.
- Pinned Orca source provenance **PASS**: 33,506 upstream file records, **373 adapted Ash source hashes, 8,395 documented removals** and unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded Electron source build: **PASS**, plain-Node daemon entry and sandbox preload guard; renderer graph 255 chunks, 7,836.4 KB minified. Inherited ineffective dynamic-import warnings remain.
- Real Linux Wayland source-app Electron smoke with disposable private profile `/tmp/ash-m8-no-cloud-org-admin-wayland-o8B8Gy`: **PASS**. Actual `Ash IDE` renderer DOM complete, preload present, `pty.spawn`, native chat, Settings and `orcaProfiles.list`/`createLocal` bridge functions present; all five retired cloud-org member methods, excluded `mobile`, `speech` and `automations` keys absent. The test-owned Electron and three matching helpers were stopped. The smoke validates **preload presence**, not actual native profile IPC invocation; the inherited profile handler remains unregistered in current startup.
- Hosted `main` CI remains a **separate required gate** for the exact pushed commit; do not claim it passed before observing GitHub's conclusion.

## Remaining M8 and release gates

The inherited cloud sign-in/session and associated artifact/cloud-connector, general application-plugin and managed remote sources require separate reachability audits. Retain local browser authentication, provider-native sign-ins/hooks/skills/MCP, original-folder-first workspaces, browser extensions, native PTY, local profile data and historical-device cleanup. This change is not evidence of full vendor-cloud removal.

Existing localization catalog drift remains open from earlier M8 work. Packaged AppImage standalone daemon/network-listener and bundle inspection, X11, Windows/macOS, live provider-authenticated end-to-end tests and full M8 acceptance remain **unverified**.

Integrate as one reviewed direct-to-`main` commit and push normally without force. Report hosted CI result for the exact SHA; avoid creating worktrees or cleanup branches for this single-writer milestone.
