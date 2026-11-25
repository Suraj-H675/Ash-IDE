# Pinned native client source preparation

The RT-15 checkpoint prepares the reviewed `agent-browser` v0.39.4 source patch for a private Linux x64 build. It pins the Ash-owned Rust patch and original upstream license, and records its source provenance. The distribution gate remains blocked.

## Source patch attribution

The source patch is an Ash modification of agent-browser v0.39.4 by Vercel Inc., pinned to commit `04ba5264dade678062c3cdcce0f4f293e748249f`. The patch adds `cli/src/ash_owned.rs` and `cli/src/ash_owned_identity.rs` and modifies `cli/src/main.rs`, `cli/src/connection.rs` and `cli/src/native/browser.rs` to support the authenticated attach-only path, bounded correlated requests and explicit CDP target addressing. The exact upstream Apache-2.0 license, including its copyright notice, accompanies the patch as `config/scripts/native-build/agent-browser-owned-LICENSE.txt`. Preparation checks that copy against the upstream license hash. The upstream tree has no separate root NOTICE file; the existing axe-core notices are preserved in the reconstructed tree and hashed. This source attribution does not clear the separate compiled-binary and dashboard distribution gates.

## Source preparation

Use a clean Git checkout at the exact commit recorded in `agent-browser-owned-v0.39.4.provenance.json`. Preparation checks the commit and Git tree object, clean status, Git tree entry types, package and lockfile pins, original Rust file hashes, license and notice hashes, and patch digest and file set. All preparation Git invocations disable replacement objects. It extracts a Git archive into a mode-restricted temporary workspace, verifies a pinned complete pristine tree identity before applying the patch, and verifies the pinned complete patched tree plus individual file hashes afterward. The complete identity hashes sorted paths, directory/file types, Git executable modes and SHA-256 file bytes; it excludes only the extraction root itself and normalizes ordinary extraction umask differences. Subsequent phase snapshots retain exact filesystem modes.

```sh
node config/scripts/native-build/agent-browser-owned-source.mjs prepare \
  --reference /absolute/path/to/clean-agent-browser-checkout \
  --workspace-parent /absolute/path/to/private-temp-parent
```

The workspace parent must already exist, be a real directory, and sit outside the source checkout and shared package caches. The full ancestor chain is checked for identity, ownership and write modes. Group or world writable ancestors are accepted only with sticky protection and an owner trusted as the current user or the filesystem's OS root owner. An owner-writable ancestor owned by any other user is rejected. The default `/tmp` parent is accepted when its sticky bit protects entries. The workspace and its parent identities are rechecked at phase boundaries. Preparation retains the workspace when a check fails so the failure can be inspected.

## Private build boundary

The build command requires absolute canonical paths for `pnpm`, `rustc`, `cargo`, and `rustdoc`. It checks the pinned Node major, pnpm version, supplied exact Rust versions and host target, matching Rust toolchain directory, and installed target libraries before copying caches or building. The caller supplies Rust versions from the approved toolchain. System tools come only from `/usr/bin`, `/bin`, or `/usr/local/bin`; subprocesses receive a fixed PATH made of wrappers to those verified executables.

The subprocess environment is constructed from an explicit allowlist. It uses private HOME, temporary directories, Git/npm/Cargo configuration, Corepack state, Cargo target output, pnpm/npm caches, and private copies of the provided Cargo registry and pnpm store. Inherited credentials, proxy settings, user compiler flags, tool paths, and package-manager configuration are not passed through. Cache copies reject absolute, external, broken, directory-targeting, or cyclic symlinks. A relative symlink is accepted only when its resolved target is a regular file inside the cache being copied.

For example, after obtaining the approved tool paths and read-only cache paths, run:

```sh
node config/scripts/native-build/agent-browser-owned-source.mjs build \
  --reference /absolute/path/to/clean-agent-browser-checkout \
  --target x86_64-unknown-linux-gnu \
  --rustc-version "$RUSTC_VERSION" \
  --cargo-version "$CARGO_VERSION" \
  --rustc-executable /absolute/path/to/toolchain/bin/rustc \
  --cargo-executable /absolute/path/to/toolchain/bin/cargo \
  --rustdoc-executable /absolute/path/to/toolchain/bin/rustdoc \
  --pnpm-executable /absolute/path/to/pinned/pnpm \
  --cargo-registry /absolute/path/to/cargo/registry \
  --pnpm-store /absolute/path/to/pnpm/store \
  --workspace-parent /absolute/path/to/private-temp-parent
```

The invocation uses pnpm `--offline --frozen-lockfile` and Cargo `--locked --offline`, with one Cargo build job. Each executable is recorded with its canonical path, file type, mode, owner, device, inode and SHA-256. Its directory chain is checked for writable boundaries. Executable and wrapper identities are rechecked before and after every build phase. Owner-writable tools are identified as same-user mutable; hashing does not stop that user from replacing a tool between checks. The receipt does not claim externally enforced read-only protection for tools or source. Production trust requires those protections to be enforced outside this script.

These package-manager flags do not isolate operating-system networking. Build scripts execute with the caller's OS permissions and can access the network or paths those permissions allow unless the host separately applies OS-level isolation. The command does not claim to provide such a sandbox. It does not install or distribute the resulting binary.

The source snapshot records every original source path, entry type, permission mode and file digest, including empty directories. Only `node_modules` roots derived from pnpm lockfile importers and the dashboard `.next` and export `out` directories are excluded from that initial snapshot. Other added paths, including executables and configuration files, cause the source check to fail. Source paths are checked after package installation, after dashboard export and after Cargo. Generated dependency roots are separately snapshotted after installation; the dashboard `.next` and `out` trees are captured before Cargo. A complete pre-Cargo manifest binds those snapshots and is checked again after Cargo. Generated symlinks must be relative, resolve to a regular file or directory within the reconstructed source tree, and remain unchanged.

The source and tool hashes are snapshots, not an operating-system sandbox. A process running as the same user can race a check or replace owner-writable files after a check. The script makes no claim that hashes eliminate same-user TOCTOU. The receipt marks external read-only source and toolchain protection as unverified and production trust as blocked. Production use requires an independently enforced read-only or OS-isolated source and toolchain boundary.

After dashboard export, the build checks required public assets and parses local references in emitted HTML and CSS before Cargo can embed them. It covers standard HTML `src`, `href`, `srcset`, `poster`, `data` and inline `style` attributes, style blocks, CSS `url()` and quoted `@import`; local references resolve relative to the referring HTML or CSS file, with root routes checked against emitted files and common `.html` or `index.html` route forms. It also checks every emitted HTML and CSS file, whether or not another file links to it. This parser does not execute JavaScript, inspect URLs created at runtime, implement browser HTML parsing, or decode CSS escapes. Its coverage is limited to the forms it parses.

The private receipt records the source commit and pinned license, lockfile, patch, patched-file and notice hashes; the recipe manifest hash and each production script's path, mode and SHA-256; exact pnpm and Cargo executable paths and argument arrays; the full pre-Cargo input manifest hash; tool identities; dashboard and artifact digests; and the still-blocked distribution gate. Environment values and private credentials are not copied into the receipt. Binary determinism is not claimed.

## Focused checks

Run the source and build-environment regression suites with Node:

```sh
node config/scripts/native-build/agent-browser-owned-source.test.mjs
node config/scripts/native-build/agent-browser-owned-build-environment.test.mjs
```

The tests cover patch and pinned-input integrity, clean revision and archive gates, dashboard assets, source and generated-input snapshots, executable and workspace boundary changes, toolchain rejection, receipt completeness, malicious inherited environment variables, subprocess arguments, path traversal, cache symlink rejection, and preservation of shared cache contents. On hosts that permit nested processes, a disposable orchestrator integration uses fake pnpm and Cargo tools to prove the clean fixture reaches Cargo and a source mutation blocks Cargo. That fixture does not build or attest a real release binary.

## Host development verification (2026-11-24)

The host reconstructed the exact pinned archive and reviewed four-file patch;
the reconstructed source tree SHA-256 was
`ba36d6e7c12e56287960cd9ed189b0a09a37ff8b562a4018a1bc0fea2264538b`.
The Rust patch SHA-256 remained unchanged. The two Node regression suites
passed 17/17 with no skips, including a real Git subprocess failure boundary;
Node syntax, repository lint and formatter checks passed. Two missing
subprocess imports and refactor lint failures were corrected in host review.
The full private release `build` command, actual dashboard export and final
binary have not been verified. The pinned dashboard export, transitive notices and redistribution
obligations remain independently unverified.
Source-only development evidence does not clear any binary distribution gate.

## RT-15 trust-checkpoint repair status (2026-11-24)

The repair now snapshots all reconstructed source inputs and rechecks them after each phase. It records package-manager and dashboard outputs separately, validates dashboard HTML and CSS references within the parser's documented scope, rechecks executable identities, checks the workspace ancestor boundary, and binds recipe scripts, commands and pre-Cargo inputs into the private receipt. Same-user race resistance and externally enforced read-only protections are explicitly not claimed. Distribution remains blocked pending a genuine pinned-source build and an independent license audit.

In the constrained development host, the source suite reports 14 passed and 2 subprocess tests skipped because nested process creation is denied; the build-environment suite passes 6/6. The disposable orchestrator integration is present but did not execute there. No full Cargo build or real dashboard export was run for this repair.

Host follow-up: the expanded Node suites initially failed the real subprocess
orchestrator fixture due to inconsistent logical linker versus wrapper identity
names. The repair normalizes linker and pkg-config keys before comparison.
The complete host test run then passed 22/22, zero skips, including clean
and deliberately mutated source subprocess paths. Real pinned Git archive
reconstruction again returned the same source-tree and four Rust patch hashes.
The test-file size and expanded production module decomposition remain open;
full genuine release build and notice gates remain blocked.

## RT-15 final cohesion and real-build preflight (2026-11-24)

The CLI commands and receipt fields remain unchanged. The work now separates
CLI options, toolchain selection, build phases, recipe receipts, pinned-source
checks, generated-input snapshots, and file-tree snapshots. The recipe lists
all 15 production modules. No production module exceeds 251 lines. The source
unit and subprocess tests are 422 and 191 lines. Their shared fixture helpers
live under `test-fixtures` and do not enter the production recipe.

The initial 15-file candidate fingerprint was
`a3aaee87c1f582374f154c993572713bf29b479b57d3392a14e7fb5735f3dd52`. A
read-only `sourceDigestRecord` check on the available prepared tree returned
`ba36d6e7c12e56287960cd9ed189b0a09a37ff8b562a4018a1bc0fea2264538b`. The
four-file Rust patch remains `8c17fdb610e548fc31370ee48ec5c3c71dceabfa6e1b0e5f9e81690b6d87cb26`.
The recipe capture matched all 15 implementation modules, and the public
`--help` output still lists the same `prepare` and `build` commands.

After the split, the source unit suite passed 14/14 and the build-environment
suite passed 6/6. The two subprocess tests reported skips because this shell
blocks child-process creation. The workspace host runner could not run them
because it required approval and this session has no approval route. The earlier
22/22 host result predates this split. The full build, dashboard export, and
Cargo build remain unverified.

Read-only inspection of the hash-verified upstream tree found the root package
pin `pnpm@11.1.3`, Node major 24, and a dashboard using Next.js 16.1.1 with
`next build` and static export. `packages/dashboard/src/app/layout.tsx` imports
Geist from `next/font/google`. No local Geist font file or font license appears
in the pinned dashboard tree. Resolve the exact font fetch or cache behavior,
pin the font bytes, and include its license in the notice review before a build
that needs external network isolation. The build's package-manager offline
flags do not block network access by themselves.

The manifest target is `x86_64-unknown-linux-gnu`. The host has Node 24.22.3,
and its Rust target library directory exists. The installed rustc, cargo, and
rustdoc report 1.97.0, but no accessible C-01/C-02 record approves that exact
toolchain. The pinned build needs one approved exact Rust version and matching
absolute paths for rustc, cargo, and rustdoc. The host repository pins pnpm
12.14.0; the available command fell back to 12.22.0 after it could not acquire
its package-manager store lock. Neither version matches the upstream 11.1.3
pin.

The existing read-only caches are `$HOME/.local/share/pnpm/store/v11` at 2.5G
and `$HOME/.cargo/registry` at 258M. The build copies them into its private
workspace, so the measured cache inputs alone need about 2.76G before source,
dashboard, and Cargo outputs. The disk-backed `/home` volume has 115G free.
`/tmp` has 3.4G free and already uses 4.3G, so keep the build workspace there
out of use. A suitable future parent is `$HOME/.cache/ash-agent-browser-owned-rt15`.
Its existing `$HOME/.cache` ancestor is user-owned and not group- or
world-writable. Create the parent with mode 0700 before use. Pass both cache
paths explicitly so the build only reads the shared caches and writes private
copies.

The available prepared source tree is under `/tmp` and is an extracted archive,
not a Git reference. The other inspected source checkout has a different HEAD
and local Rust changes, so it fails the clean pinned-reference gate. A clean
checkout at `04ba5264dade678062c3cdcce0f4f293e748249f`, the approved exact
toolchain, pnpm 11.1.3, and a verified font input are required for the next
real-build preflight. Keep the distribution gate blocked until both existing
notice blockers are cleared. RT-15 production and PK-05/PK-06 remain NO-GO.
This checkpoint does not establish release proof.

## Host verification after module consolidation

The complete host Node suite passed 22/22, no skips, including the real subprocess fixtures with disposable tools. Lint and formatting passed after removal of unused imports. The actual pinned Git reference was clean at the expected commit; preparation again reproduced the identical source tree, license, lockfile and Rust patch digests. Production modules are at most 251 lines. The real release build, dashboard output and distribution are still unverified; no binary was produced by this host verification.

## Complete pinned source identity (2026-11-25)

The pristine identity was independently derived from all 483 regular Git blobs at the pinned commit (each blob object ID was checked against its bytes), including all implied directories. The patched identity was independently derived using the four reviewed patch-file hashes and modes. The manifest pins 602 pristine entries at `0ee152293582113691202d4fc20179979dc514ab9ca48c9b740b34140d7401f0` and 604 patched entries at `150eb26de626003200888296b30cfd3411490d9bd123ddc57640508311ab57e0`. The actual clean reconstruction matched both pins and preserved the previous byte-only reconstruction digest. A disposable Git clone with a replacement blob produced the same reconstructed source; a local `info/attributes` export omission was rejected before patch application. The actual pinned reference was unchanged. This is a source reconstruction check, not proof of OS isolation, full Cargo registry inputs, a release executable, or redistribution eligibility.

The private build receipt explicitly scopes its pre-Cargo snapshot to the reconstructed source tree, installed package-manager inputs and dashboard output. The copied Cargo registry is not attested by that snapshot; neither a complete build-input attestation nor OS-level isolation is claimed. The CSS asset gate now skips quoted literal URL/import text while still checking actual local URL functions and quoted imports within its documented parser scope. The expanded real-host Node suites passed 24/24 with no skips.

## Explicit target addressing development proof (2026-11-25)

The five-file patch introduces the reserved `target:<hex>` namespace in the native tab resolver, with strict 16–64 hexadecimal character validation and unique, case-insensitive target matching. It retains bare legacy labels and stable daemon-local tab IDs for the native CLI, but Ash owned mapped switch and close always use the explicit namespace. Raw Ash tab mutation remains fenced. Owned commands accept the pinned native CLI’s recognized output-only leading boolean options (with optional literal true/false values); other options must follow the action, avoiding an unchecked action reinterpretation. The attach-only capability response must explicitly advertise target addressing; the executable remains SHA-256 pinned and previous live daemon generations are not silently upgraded or replaced.

New patch SHA-256: `3758fe21a31e8f1c0020373fbd17a6822f34d8635c8ef88cb1ec8ddcd4a49d8c`. Complete patched tree SHA-256: `0120ec2ee5deb8013d55001f4641a145f1c2ae7629d45720f090c7b7326f9391` (604 entries). The unchanged pinned pristine tree was checked independently. The actual locked offline Linux development build succeeded and produced SHA-256 `f4f28fc8d350ce0ac1658c91961dfef1d745c39cf214c3113097460f97c75e05`. Two native exact-target tests, nine legacy tab-reference tests, twenty native ownership tests, and twenty-four source-tooling tests passed. The real Chromium label-collision test now switches and closes the intended mapped page and proves that a shadowing foreign tab retains its target, URL and page content. Stale explicit targets fail without falling back to its label. The full 17-file Ash regression run passed 73 tests, zero skips; scoped typecheck passed.

This is development-only proof with the placeholder dashboard. The release binary, real dashboard export, Cargo registry input attestation, independent final acceptance and third-party redistribution notices remain gated. Do not replace a running older development daemon or distribute this binary.

An independent architecture review found the initial leading-option guard unnecessarily rejected harmless CLI output prefixes. The focused repair preserves those prefixes while checking the actual tab action and requiring canonical durable creation intent. Four final focused tests passed, including real prefixed title/list commands and rejection of a prefixed raw tab mutation. The broader 73-test and scoped typecheck receipts predate that small final adjustment; a fresh security review timed out and final independent acceptance is pending.

## Actual pinned dashboard and pre-Cargo proof (2026-11-25)

The native patch now also pins the dashboard local Geist 1.4.2 font bytes, its unchanged OFL-1.1 notice, the local font loader, and the exact Next 16.1.1 generated declaration. The dashboard uses local existing marks or generic initials/dots instead of unsolicited remote browser-logo and favicon requests. The full patched tree has 608 entries at SHA-256 `00cbd3b5f4656f0de9603f3d8b9af6d1d601d44933f4aef67bd5b2b05499df80`; the patch SHA-256 is `b30122e216ccc42ed90cf4fbdf263a0e71c5e9a2d64e9ca8cec18e5282bec60a`. Original native Rust file pins, Apache license, and pristine upstream identity are unchanged from the explicit-target candidate.

Pinned pnpm 11.1.3 verified the exact lockfile against its supply-chain policy and installed 704 packages in a private staging store. The final recipe explicitly disables lifecycle scripts (the upstream root postinstall otherwise tries to download an unpatched binary). A genuine pnpm lockfile-policy cache may be provided using `--pnpm-policy-cache`; it is copied into the isolated build environment and interpreted by the pinned pnpm implementation, not manufactured or treated as a substitute for source/lock verification. The final install reused all 704 packages with zero downloads. Offline flags and cache receipts are not OS-level network isolation or proof against an untrusted same-UID writer.

The real Next production static export compiled and typechecked. A pinned generated declaration avoids exempting arbitrary source writes. The generated dashboard mode normalizer only tightens private regular single-link files, rejects links and unsafe directories, and preserves the strict snapshot permission gate. The actual output includes the exact Geist font and OFL notice; the asset gate compares required public bytes and the emitted font against source. The four identified external asset URL prefixes were absent from emitted JS/HTML/CSS. This does not attest all potential runtime network calls. Next warns that its development rewrites are not applied to static exports; the native serving/API route still needs an actual runtime witness.

The private Cargo seed was independently compared to the pinned lock: 306 cached archives matched locked checksums and 263 extracted target-resolved crate trees matched their archives (10,162 regular files). Unrelated cache archives were excluded. The build recipe now includes the private registry in the full pre-Cargo input snapshot and checks it again after Cargo, while keeping production trust blocked. Actual build inputs were recorded; the final release-profile Cargo compilation had started but had not yet produced a verified final artifact at this checkpoint. Source/build tooling passed 26 tests with no skips.

Licensing review remains blocked: the isolated dashboard installation contains 704 distinct package versions, with 22 lacking an obvious root-level notice; Cargo metadata resolves 263 third-party versions, with eight lacking root notices. These are conservative candidate dependency inventories, not the actual shipped-module list. Exact commit-based license retrieval resolved source candidates for profiling/profiling-procmacros and the three zune crates; applicability and license choices remain to be reviewed. Fax/fax_derive and simd_helpers still need exact notices. Other special-license components, static marks/assets, native binary and final packaged output require separate review. No release or redistribution approval is claimed.

The subsequent Cargo attempt reached native compilation but stopped when GCC could not locate the assembler in the restricted PATH. The registry snapshot independently rejected exactly one new file, Cargo’s standard `CACHEDIR.TAG`; no crate source or archive bytes changed. The focused repair adds an explicitly resolved and hash-checked assembler wrapper and initializes that exact marker before taking input snapshots. The receipt now records the actual private policy-cache seed digest and entry count. The 26 tooling tests passed again, as did a real C/assembler compile in the restricted environment. Final post-Cargo and production trust remain unverified.

Fresh architecture and security reviews returned NO-GO on the earlier source/build packet. The generated permission blocker has since been fixed and the policy-cache seed digest added, but full final-diff review, runtime dashboard/API serving, final policy-cache admission, and completed release proof remain outstanding. The security reviewer also raised implicit active-tab dispatch. Actual public dispatch resolves a registry-mapped page and selects its exact native ID before running page actions; a select-then-action race still requires a dedicated negative integration witness. The local favicon fallback intentionally trades per-site icon distinction for privacy.

## Release-profile artifact and strict-binding defect (2026-11-25)

The first complete corrected release-profile build passed every build gate, including unchanged post-Cargo registry inputs. Its private Linux x86-64 executable was 18802136 bytes, SHA-256 `90deb91a47e46d8a7634059cac9ef93024b539a40ac6409468d7c096a8abf0d8`. The isolated native dashboard served all 45 emitted files byte-for-byte, bound only loopback, served an empty isolated sessions list, and rejected cross-origin API/exec requests and an unregistered session proxy. Seven focused Ash tests passed against that executable with a temporary test hash pin, subsequently restored. These results apply only to that artifact.

A separate actual Chromium reproduction exposed a page-binding defect: after an out-of-band closure of the exact selected page, an unpinned action navigated a different mapped worktree tab. Explicitly enabling the native pin policy on an already live browser prevented that mutation. Simply setting the initial environment policy failed because the two upstream local BrowserManager launch paths did not propagate the daemon policy to the manager.

The new source candidate sets strict binding in both local launch paths, requires it in attach-only client mode, rejects native explicit disable, advertises strictTabBinding, and enables the policy in the Ash daemon/helper environment. Raw CLI attempts to disable it are fenced without rejecting typed batch literal text. Negative capability and real selected-target closure/discovery tests are added. The new pinned tree is `bee89d7a9ae34da72076337c9ec463447d09262157767c276d63e9bc2a1c2767` (608 entries), patch SHA-256 `3eda1de501f3058fae43a598cdba3e411260b104c1a78169dcf32b32538f26c4`. It reconstructs and passes 26 tooling tests. The new native executable and the real repaired regression are not verified yet. The earlier executable is retained unchanged, not promoted; distribution, final review, broader runtime binding behavior and legal acceptance remain blocked.

## Corrected strict-binding private artifact verification (2026-11-25)

The corrected complete build finished successfully, including all before/after Cargo registry and other input gates. Its private Linux x86-64 executable is 18822616 bytes, SHA-256 `82586953561c2d0ba328ec97264d80e73cd945c52f4a44366004afa1d4d10641`. The actual executable served all 45 embedded dashboard assets byte-for-byte and passed isolated loopback and API denial smoke tests. It advertises strictTabBinding. The full real-Chromium 17-file suite passed 77/77 with zero skips using the exact artifact pin. The real regression covers unexpected discovered tabs, external selected-target closure, rejected implicit retargeting, and recovery by explicit mapped selection. Scoped TypeScript passed across 76 changed paths. The development test pin now records the same verified artifact hash; owned runtime selection remains test-injection only. The previous executable remains unchanged.

This is a private build and real Xvfb/Chromium runtime proof, not production resolver, shipped license, AppImage, Wayland, RT-15 active-updater, or final security acceptance. A fresh review of the final relevant diff is required before integration of the owned runtime.
