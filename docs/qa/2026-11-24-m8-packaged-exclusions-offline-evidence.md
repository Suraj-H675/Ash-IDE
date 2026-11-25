# M8 packaged exclusion inspection. Offline evidence

**Scope.** This receipt records a read-only reinspection of the Nov 22, 2026 <code>linux-unpacked/resources</code> tree for EX-01 through EX-10 and PK-08. It does not certify release acceptance. Gate names and requirements follow the authoritative mappings supplied for this QA task.

## Identity and verdict

- The original scan recorded its source <code>HEAD</code> and <code>main</code> at <code>ddf184dd3a330a3a96755dd615a37bd60178d1a6</code> on Nov 23. The follow-up scan started from branch <code>test/m8-ex09-native-network-evidence</code> at <code>641fd443615f195a32e8e48bb177a53bd448af73</code>, with <code>main</code> at <code>ddf184dd3a330a3a96755dd615a37bd60178d1a6</code>.
- <code>dist/ash-ide-linux.AppImage</code> is 219,426,734 bytes, has mtime <code>2026-11-22 19:04:37 +0530</code>, and SHA-256 <code>1ff3e72aab9f209a8aece47a118eba1ca2201777f18a45a16c3e91781ac27b57</code>.
- <code>dist/linux-unpacked/resources/app.asar</code> is 9,561,172 bytes, has mtime <code>2026-11-22 19:04:21 +0530</code>, and SHA-256 <code>748e9725d0ea8a67510f070c81e3a0489cf41cf2bca53a3ea35bcfc81a5af8a8</code>.
- The sidecar identifies a packaging-input snapshot for version <code>0.1.0</code> and architecture <code>x64</code>, but its <code>sourceCommit</code> is <code>null</code>. The ASAR and compiled CLI package JSON digests match the inspected bytes. The source commit cannot be established.
- <code>latest-linux.yml</code> is dated <code>2026-11-19T04:04:30.108Z</code> with mtime <code>2026-11-19 09:34 +0530</code>. It records the AppImage as 219,767,197 bytes with SHA-512 <code>cc7d370d…71cc6bb1</code>. The Nov 22 AppImage is 340,463 bytes smaller and has SHA-512 <code>8aedeb94…3838521f1</code>. The manifest does not identify or authenticate these AppImage bytes.
- <code>file</code> recognizes the AppImage runtime and ASAR. <code>bsdtar -tf</code> does not recognize the AppImage. <code>unsquashfs</code> is unavailable, so no outer AppImage extraction was run and its contents were not inspected or bound to <code>linux-unpacked</code>.
- The ASAR contains 4,658 files. The exact exclusion lists, excluded roots, excluded native resource roots, and unpacked-file accounting have no hits. All eight retained path controls are present. The package remains unbound to the expected source commit.
- Packaged <code>LICENSE</code> SHA-256 <code>ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3</code> matches the upstream Orca MIT license digest in <code>docs/provenance/ash-exclusions.json</code>. The ledger identifies Orca <code>1.4.214</code> at source commit <code>55697aec91390357540103f49991458f756b41cc</code>. This verifies the license bytes, not the full artifact provenance.

**Verdict.** PK-08 remains **NO-GO** for the requested source commit. The package is older than the QA branch and has no source commit. Its AppImage does not match the available release manifest. PK-05/06 and RT-15 were not evaluated or changed. EX-09 and EX-10 remain open, and no release acceptance is claimed.

## Exclusion gate observations

A path candidate is a shipped filename that matches a bounded category rule. It needs review. A candidate is not a confirmed forbidden artifact and does not prove that a UI, API, host, worker, or service can start. Literal import closure counts record only relative imports found from compiled Main, preload, CLI, or renderer HTML entrypoints.

| Gate                                            | Nov 22 offline observation                                                                                                                                                                                                                                     | Evidence status                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EX-01 mobile pairing, app, push, and relay      | 28 filename candidates, with 15 in the CLI literal-import closure. Examples include <code>runtime-remote-pairing.js</code> and mobile relay contracts.                                                                                                         | Review needed. The scan does not establish absence of UI or API paths, a started host, or a shipped mobile bundle.                                          |
| EX-02 remote SSH host management and deployment | 32 filename candidates, with 2 in the Main closure and 15 in the CLI closure. Candidates include remote execution and install chunks and remote server UI assets.                                                                                              | Review needed. Host registration, reconnection, and deployment controls were not exercised. Ordinary SSH and Git behavior were not exercised.               |
| EX-03 general IDE plugins                       | Three unreferenced shared compatibility files have legacy plugin settings or theme names. No exact excluded plugin executable, root, or native resource was found.                                                                                             | Review needed. This scan does not establish that install RPCs, workers, or marketplace UI are absent. Browser extension preload and host paths are present. |
| EX-04 scheduled Runs                            | Six filename candidates remain, with two in the CLI closure. Schedule parsing and model files appear in that closure.                                                                                                                                          | Review needed. No scheduler was started. Manual Runs were not exercised.                                                                                    |
| EX-05 Ash-managed skills and MCP marketplace    | No marketplace, catalog, or installer filename candidates were found. The provider-native <code>resources/skills/current-manifest.json</code> path is present.                                                                                                 | Not observed by these path rules. Ash-managed installation and listing endpoints were not tested. Provider-native skills remain present.                    |
| EX-06 vendor cloud accounts and relay services  | Eight filename candidates remain, with one in the CLI closure. The closure match is a mobile desktop relay contract. The WSL provider-hook relay bundle path remains present and is not counted as an Ash cloud relay candidate.                               | Review needed. No Ash sign-in or cloud service was started.                                                                                                 |
| EX-07 Jira and Linear app connectors            | 43 filename candidates remain, with 9 in the CLI closure and 1 renderer asset in the renderer closure. <code>jira-target.js</code> is in the CLI closure. <code>@linear/sdk</code> appears in package dependency metadata but is not installed in the package. | Review needed. Integration screens, APIs, and credential capture were not tested.                                                                           |
| EX-08 voice and dictation                       | Five shared speech or dictation helpers remain, with one in the CLI closure. No <code>stt-worker</code> entry or <code>sherpa-onnx</code> native package was found.                                                                                            | Review needed. No speech service was started.                                                                                                               |
| EX-09 product telemetry                         | 32 telemetry or analytics filename candidates remain, with 1 in the Main closure and 25 in the CLI closure.                                                                                                                                                    | Not tested. No native network capture was run, so this scan makes no claim about analytics transmissions.                                                   |
| EX-10 dead UI, scripts, and command names       | 149 distinct filename candidates match obsolete Orca names or EX-01 through EX-08 path rules. The groups overlap.                                                                                                                                              | Review needed. Filenames do not establish that obsolete controls or execution paths remain active in the normal Ash app.                                    |
| PK-08 package inspection                        | Exact artifact and root checks have no hits. There are no unlisted, missing, or size-mismatched unpacked files. All retained path controls are present. The sidecar source commit is unknown.                                                                  | **NO-GO.** The identity mismatch blocks acceptance. Runtime listeners were not inspected.                                                                   |

The scan found no installed <code>@linear/sdk</code>, PostHog SDK, or other listed vendor module. It found no exact exclusion hit. The <code>@linear/sdk</code> dependency declaration is metadata, not an installed package. Positive path controls cover the browser extension preload and host, local browser automation, local CLI and daemon entrypoints, WSL provider-hook relay, provider-native skills, and absent Ash update configuration. These checks inspect paths only. They do not test provider, browser, update, SSH, Git, or other runtime traffic.

## Reproduction and checks

The inspector reuses the hardened package-input identity helper and <code>@electron/asar</code> reader. It copies <code>app.asar</code> to a private snapshot, checks the copy's digest before and after inspection, and rejects malformed paths, linked entries, invalid offsets, oversized inputs, and changed package identity files. Unpacked paths are checked for symlinks, non-regular files, size limits, missing entries, unlisted files, and size mismatches. The archive, sidecar, CLI metadata, and observed resource paths are checked for changes during inspection. The reader opens its temporary ASAR copy by path, so a transient same-UID path swap between integrity checks cannot be ruled out. Directory traversal does not pin directory file descriptors with <code>openat</code>, so a transient parent-directory swap cannot be ruled out.

It reports a non-accepting result and exits with status <code>1</code> when source identity is missing, even if hashes match. It also exits nonzero when the report has only review candidates or untested runtime gates.

    node \
      config/scripts/desktop-distribution/runtime-verification/inspect-m8-packaged-exclusions.cjs \
      --resources-dir dist/linux-unpacked/resources \
      --expected-source-commit ddf184dd3a330a3a96755dd615a37bd60178d1a6

The Nov 22 ASAR run exited <code>1</code>. The report records <code>result: "non-accepting"</code>, <code>staticFindings.status: "hard-findings"</code>, and the source-commit mismatch. It records 32 EX-09 filename candidates and 149 EX-10 candidates. It reports no exact exclusion hits, no unpacked-file discrepancies, and all retained controls present. The report marks the outer AppImage uninspected, package files unexecuted, runtime listeners unobserved, and native network capture untested.

The command <code>strace</code> is unavailable in this environment. The existing network audit's loopback positive control and disposable AppImage lifecycle were not run. No syscall capture or native packaged network capture was made. No AppImage extraction was attempted because <code>unsquashfs</code> is unavailable and <code>bsdtar -tf</code> does not recognize the image.

The scanner tests now use the repository's Vitest runner and disposable ASAR and sidecar fixtures:

    node node_modules/vitest/vitest.mjs run \
      --config config/vitest.config.ts --pool=forks --maxWorkers=1 --no-file-parallelism \
      config/scripts/desktop-distribution/runtime-verification/inspect-m8-packaged-exclusions.test.mjs

The initial standalone suite passed eleven cases. It covers a matching fixture, exact findings, mobile versus vendor relay mapping, candidate-only review, EX-09 and EX-10 separation including an exact PostHog module, invalid identities and hashes, missing retained controls, unlisted and malformed unpacked files, archive and resource symlinks, malformed archives, and source, sidecar, CLI metadata, and temporary ASAR copy races. The final 14-case suite also passes under Vitest. The foundation workflow explicitly selects the scanner, package-input identity and embedded-identity fixtures. A local combined run including the runner-audit regression suite passed 49 tests with five skipped; the full collection audit reported 162 hosted test entries and 2,236 additional local entries, with every checked-in test having a collection path. Hosted CI itself has not run for this checkpoint.

No package files were executed. No package manager, build, GUI, installed Orca, provider account, user profile, or user process was touched. The named <code>11_ACCEPTANCE_AND_TEST_EVIDENCE.md</code> source was not available in the worktree or connected document search, so this receipt uses the authoritative gate mapping supplied with the task.

## Next evidence required

Direct host-side follow-up: a deterministic regression reproduced publication
of a stale package identity when the source ASAR changed during the final
asynchronous inspection-copy hash. The repair performs that asynchronous
verification before the final synchronous source identity checks and rename.
Snapshot inspection likewise checks the original inputs after hashing the copy.
The new regression failed before the repair and passed afterward; the full
package-input identity suite passed 10/10 and scanner fixtures passed 11/11.
Scoped lint and the official source-ledger verifier passed (33,506 upstream
records, 805 Ash modifications, 9,316 documented removals, unchanged MIT hash).
This closes the demonstrated intra-process ordering gap; it does not establish
atomic protection against arbitrary concurrent external filesystem mutation.
The independent review confirmed that ordering repair and identified stale
compiled CLI commit evidence, unbounded cumulative import reads, retained
ASAR parser cache entries, and misleading inspection-error classification.
The direct follow-up addresses all four: a known claim must match the CLI
commit, unsupported identity metadata is not verified, a shared 128 MiB
literal import read budget reports incomplete analysis, private ASAR copies
are uncached on cleanup, and failed inspection is distinct from observed
hard findings. Unknown-source development claims remain unbound. The new
host-side scanner run passed 14/14 cases; the package-input identity suite
passed 11/11 and the embedded AppImage identity fixture suite passed 8 cases
with 5 skipped. These fixtures do not constitute a real AppImage run. Scoped
lint/format, diff check and official provenance verification passed.
The historical package rerun read 25,527,815 bytes within the 134,217,728-byte
analysis budget without exhaustion or oversized entries; candidate counts
were unchanged. Its compiled CLI metadata reports
`0d7cab58d948956c6fc1d50e08e64424c45d681f`, but its sidecar source commit is
null. It remains non-accepting (exit 1). A fresh independent review of the
committed repaired delta found no remaining consequential issue for this
offline QA tool. The subsequent runner wiring was locally verified; actual
hosted CI and integration evidence remain required. This is only a local QA
checkpoint.

Create a fresh writable QA package from the exact integrated source commit being evaluated. Verify its source identity and release manifest against the actual AppImage and ASAR, then rerun this content gate. For EX-09, use a locally verified <code>strace</code> only after its loopback positive control passes, then capture only a test-owned packaged lifecycle. Repeat native behavior checks for other supported platforms. Keep PK-05/06, EX-09/10, RT-15, PK-08, and release NO-GO in place until independent review accepts the required evidence.
