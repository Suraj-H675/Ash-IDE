import assert from 'node:assert/strict'
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  withTempDirectory,
  writeDashboardFixture
} from './test-fixtures/agent-browser-owned-source.mjs'
import {
  assertDashboardAssets,
  assertCleanReferenceStatus,
  assertPinnedRevision,
  assertSupportedTarget,
  assertToolchainIdentity,
  createPrivateBuildReceipt,
  verifyPatchArtifact
} from './agent-browser-owned-source.mjs'
import {
  assertDistributionGateBlocked,
  assertSafeArchiveEntries,
  manifest,
  verifyPinnedFileSet
} from './agent-browser-owned-source-integrity.mjs'
import { sha256 } from './agent-browser-owned-source-files.mjs'
import { normalizeGeneratedDashboardModes } from './agent-browser-owned-dashboard-modes.mjs'
import { assertPinnedTreeIdentity } from './agent-browser-owned-source-tree-snapshot.mjs'
import {
  assertPreCargoInputSnapshotUnchanged,
  assertSourceInputSnapshotUnchanged,
  captureGeneratedInputs,
  createPreCargoInputSnapshot,
  createSourceInputSnapshot
} from './agent-browser-owned-source-integrity.mjs'
import {
  assertExecutableIdentityUnchanged,
  captureExecutableIdentity
} from './agent-browser-owned-process.mjs'
import {
  assertWorkspaceBoundary,
  assertSafeWorkspaceParent,
  captureWorkspaceBoundary
} from './agent-browser-owned-source-prepare.mjs'

const moduleDirectory = new URL('.', import.meta.url)
const patchBytes = readFileSync(new URL('./agent-browser-owned-v0.39.4.patch', moduleDirectory))

test('the patch digest and changed-file set match the reviewed source manifest', () => {
  assert.equal(verifyPatchArtifact(patchBytes), patchBytes.toString('utf8'))
  const tampered = Buffer.from(patchBytes)
  tampered[tampered.length - 1] ^= 1
  assert.throws(() => verifyPatchArtifact(tampered), /SHA-256 mismatch/)
})

test('source preparation rejects a different commit or a dirty checkout', () => {
  assert.throws(() => assertPinnedRevision('0'.repeat(40)), /revision mismatch/)
  assert.throws(
    () => assertCleanReferenceStatus(' M cli/src/main.rs'),
    /clean tracked and untracked/
  )
  assert.doesNotThrow(() => assertCleanReferenceStatus(''))
})

test('the pinned Git tree gate rejects symlinks, submodules and path traversal', () => {
  assert.doesNotThrow(() => assertSafeArchiveEntries('100644 blob abc123\tLICENSE\0'))
  assert.throws(
    () => assertSafeArchiveEntries('120000 blob abc123\tlinked-file\0'),
    /symlink or non-regular/
  )
  assert.throws(() => assertSafeArchiveEntries('100644 blob abc123\t../outside\0'), /unsafe path/)
  assert.throws(() => assertSafeArchiveEntries(''), /archive is empty/)
})

test('complete source identity rejects unpinned bytes, executable changes and extra entries', () => {
  withTempDirectory((root) => {
    mkdirSync(join(root, 'src'), { mode: 0o700 })
    const file = join(root, 'src', 'ordinary.rs')
    const contents = 'exact source bytes\n'
    writeFileSync(file, contents, { mode: 0o600 })
    const expected = {
      entryCount: 2,
      sha256: sha256(
        JSON.stringify([
          ['src', 'directory'],
          ['src/ordinary.rs', 'file', '100644', sha256(contents)]
        ])
      )
    }
    assert.deepEqual(assertPinnedTreeIdentity(root, expected, 'Fixture'), expected)
    writeFileSync(file, 'different ordinary source')
    assert.throws(
      () => assertPinnedTreeIdentity(root, expected, 'Fixture'),
      /complete tree identity/
    )
    writeFileSync(file, contents)
    chmodSync(file, 0o700)
    assert.throws(
      () => assertPinnedTreeIdentity(root, expected, 'Fixture'),
      /complete tree identity/
    )
    chmodSync(file, 0o600)
    mkdirSync(join(root, 'extra'), { mode: 0o700 })
    assert.throws(
      () => assertPinnedTreeIdentity(root, expected, 'Fixture'),
      /complete tree identity/
    )
    rmSync(join(root, 'extra'), { recursive: true })
    assert.deepEqual(assertPinnedTreeIdentity(root, expected, 'Fixture'), expected)
  })
})

test('pinned input verification catches lockfile changes', () => {
  withTempDirectory((root) => {
    const lockfile = join(root, 'pnpm-lock.yaml')
    const pinned = Buffer.from('reviewed lock contents')
    writeFileSync(lockfile, pinned)
    assert.doesNotThrow(() =>
      verifyPinnedFileSet(root, [{ path: 'pnpm-lock.yaml', sha256: sha256(pinned) }])
    )
    writeFileSync(lockfile, 'changed lock contents')
    assert.throws(
      () => verifyPinnedFileSet(root, [{ path: 'pnpm-lock.yaml', sha256: sha256(pinned) }]),
      /hash mismatch/
    )
  })
})

test('only the pinned Linux x64 release target is accepted', () => {
  if (process.platform === 'linux' && process.arch === 'x64') {
    assert.equal(assertSupportedTarget('x86_64-unknown-linux-gnu'), 'x86_64-unknown-linux-gnu')
  } else {
    assert.throws(() => assertSupportedTarget('x86_64-unknown-linux-gnu'), /Linux host/)
  }
  assert.throws(() => assertSupportedTarget('aarch64-unknown-linux-gnu'), /Unsupported target/)
})

test('dashboard validation resolves relative and root routes plus srcset and CSS references', () => {
  withTempDirectory((root) => {
    writeDashboardFixture(root)
    assert.match(assertDashboardAssets(root), /^[a-f0-9]{64}$/)
  })
})

test('dashboard output mode normalization tightens only private regular files and rejects links', () => {
  withTempDirectory((root) => {
    writeDashboardFixture(root)
    const out = join(root, manifest.inputs.dashboard.outputPath)
    const file = join(out, '_next/static/chunks/app.js')
    chmodSync(file, 0o664)
    normalizeGeneratedDashboardModes(root)
    assert.equal(lstatSync(file).mode & 0o777, 0o644)
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'outside')
    chmodSync(outside, 0o660)
    const hardlink = join(out, 'shared')
    linkSync(outside, hardlink)
    assert.throws(() => normalizeGeneratedDashboardModes(root), /Unsafe generated dashboard entry/)
    assert.equal(lstatSync(outside).mode & 0o777, 0o660)
    rmSync(hardlink)
    const symlink = join(out, 'symlink')
    symlinkSync(outside, symlink)
    assert.throws(() => normalizeGeneratedDashboardModes(root), /Unsafe generated dashboard entry/)
  })
})

test('dashboard export verifies exact local font and copied public assets', () => {
  withTempDirectory((root) => {
    writeDashboardFixture(root)
    const out = join(root, manifest.inputs.dashboard.outputPath)
    const font = join(out, '_next/static/media/Geist-Variable.woff2')
    assert.match(assertDashboardAssets(root), /^[a-f0-9]{64}$/)
    writeFileSync(font, 'wrong font')
    assert.throws(() => assertDashboardAssets(root), /exact local Geist font/)
    writeFileSync(font, 'fixture font')
    writeFileSync(join(out, 'licenses/Geist-OFL-1.1.txt'), 'changed notice')
    assert.throws(() => assertDashboardAssets(root), /changed public asset/)
  })
})

test('dashboard CSS ignores quoted literal URL and import text without ignoring real references', () => {
  withTempDirectory((root) => {
    writeDashboardFixture(root)
    const css = join(root, manifest.inputs.dashboard.outputPath, '_next/static/css/app.css')
    const original = readFileSync(css, 'utf8')
    const literal = ` .example::before { content: "url('/not-an-asset.svg') @import '/not-a-style.css'"; }`
    writeFileSync(css, original + literal)
    assert.match(assertDashboardAssets(root), /^[a-f0-9]{64}$/)
    writeFileSync(css, `${original}${literal} .missing { background: url("/missing-asset.svg") }`)
    assert.throws(() => assertDashboardAssets(root), /missing emitted file.*missing-asset/)
    writeFileSync(css, `${original}${literal} @import "/missing-style.css";`)
    assert.throws(() => assertDashboardAssets(root), /missing emitted file.*missing-style/)
  })
})

test('dashboard validation rejects missing relative, root, srcset, CSS, and linked files', () => {
  for (const missingReference of [
    'images/local.svg',
    'images/root.svg',
    'images/two.png',
    'images/background.svg',
    'images/font.woff2',
    '_next/static/css/theme.css',
    'guide/index.html'
  ]) {
    withTempDirectory((root) => {
      writeDashboardFixture(root, { missingReference })
      assert.throws(() => assertDashboardAssets(root), /missing emitted file/)
    })
  }
})

test('source input snapshots reject changed modes, content, and unexpected source files', () => {
  withTempDirectory((root) => {
    const source = join(root, 'source')
    const dashboard = join(source, manifest.inputs.dashboard.packagePath)
    mkdirSync(dashboard, { recursive: true })
    writeFileSync(join(source, 'package.json'), '{}\n')
    writeFileSync(join(source, 'pnpm-lock.yaml'), 'importers:\n  .: {}\n  packages/dashboard: {}\n')
    writeFileSync(join(dashboard, 'package.json'), '{}\n')
    writeFileSync(join(source, 'README.md'), 'pinned source')

    const snapshot = createSourceInputSnapshot(source)
    assertSourceInputSnapshotUnchanged(source, snapshot)
    assert.equal(snapshot.generatedDirectories.packageManager.includes('node_modules'), true)
    assert.equal(snapshot.generatedDirectories.dashboard.includes('packages/dashboard/out'), true)

    writeFileSync(join(source, 'README.md'), 'changed source')
    assert.throws(
      () => assertSourceInputSnapshotUnchanged(source, snapshot),
      /source input tree changed/
    )
    writeFileSync(join(source, 'README.md'), 'pinned source')
    chmodSync(join(source, 'README.md'), 0o755)
    assert.throws(
      () => assertSourceInputSnapshotUnchanged(source, snapshot),
      /source input tree changed/
    )
    chmodSync(join(source, 'README.md'), 0o644)
    writeFileSync(join(source, 'unexpected.mjs'), 'process.exit(1)\n', { mode: 0o700 })
    assert.throws(
      () => assertSourceInputSnapshotUnchanged(source, snapshot),
      /source input tree changed/
    )
  })
})

test('pre-Cargo snapshots include generated inputs and reject unsafe generated links', () => {
  withTempDirectory((root) => {
    const source = join(root, 'source')
    const dashboard = join(source, manifest.inputs.dashboard.packagePath)
    mkdirSync(dashboard, { recursive: true })
    writeFileSync(join(source, 'package.json'), '{}\n')
    writeFileSync(join(source, 'pnpm-lock.yaml'), 'importers:\n  .: {}\n  packages/dashboard: {}\n')
    writeFileSync(join(dashboard, 'package.json'), '{}\n')
    writeFileSync(join(source, 'README.md'), 'pinned source')
    const sourceSnapshot = createSourceInputSnapshot(source)
    mkdirSync(join(source, 'node_modules'), { recursive: true })
    writeFileSync(join(source, 'node_modules', 'dependency.js'), 'module.exports = 1\n')
    mkdirSync(join(source, manifest.inputs.dashboard.outputPath), { recursive: true })
    writeFileSync(join(source, manifest.inputs.dashboard.outputPath, 'index.html'), 'compiled')
    const dependenciesSnapshot = captureGeneratedInputs(
      source,
      sourceSnapshot.generatedDirectories.packageManager
    )
    const registry = join(root, 'cargo-registry')
    mkdirSync(registry)
    const crate = join(registry, 'crate.rs')
    writeFileSync(crate, 'locked crate')
    const preCargoSnapshot = createPreCargoInputSnapshot(
      source,
      sourceSnapshot,
      dependenciesSnapshot,
      registry
    )
    assertPreCargoInputSnapshotUnchanged(source, preCargoSnapshot, registry)
    writeFileSync(crate, 'changed crate')
    assert.throws(
      () => assertPreCargoInputSnapshotUnchanged(source, preCargoSnapshot, registry),
      /Cargo registry input tree changed/
    )
    writeFileSync(crate, 'locked crate')

    writeFileSync(join(source, 'node_modules', 'dependency.js'), 'changed dependency')
    assert.throws(
      () => assertPreCargoInputSnapshotUnchanged(source, preCargoSnapshot, registry),
      /pre-Cargo input tree changed/
    )
    writeFileSync(join(source, 'node_modules', 'dependency.js'), 'module.exports = 1\n')
    writeFileSync(join(root, 'outside.txt'), 'outside')
    symlinkSync(join(root, 'outside.txt'), join(source, 'node_modules', 'outside-link'))
    assert.throws(
      () => captureGeneratedInputs(source, sourceSnapshot.generatedDirectories.packageManager),
      /symlink/
    )
  })
})

test('toolchain executable rechecks detect changed identity and report same-user writes', () => {
  withTempDirectory((root) => {
    const bin = join(root, 'bin')
    mkdirSync(bin, { mode: 0o700 })
    const tool = join(bin, 'fake-tool')
    writeFileSync(tool, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    const identity = captureExecutableIdentity(tool, 'fake tool')
    assert.equal(identity.currentUserWritable, true)
    assert.doesNotThrow(() => assertExecutableIdentityUnchanged(identity))
    writeFileSync(tool, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    assert.throws(() => assertExecutableIdentityUnchanged(identity), /Toolchain executable changed/)
  })
})

test('workspace boundaries allow sticky /tmp and detect unsafe or replaced directories', () => {
  withTempDirectory((root) => {
    assert.doesNotThrow(() => assertSafeWorkspaceParent(tmpdir()))
    const unsafe = join(root, 'unsafe-parent')
    mkdirSync(unsafe, { mode: 0o700 })
    chmodSync(unsafe, 0o777)
    assert.throws(
      () => assertSafeWorkspaceParent(unsafe),
      /writable by other users without sticky protection/
    )

    const workspace = join(root, 'workspace')
    mkdirSync(workspace, { mode: 0o700 })
    const boundary = captureWorkspaceBoundary(workspace)
    assert.doesNotThrow(() => assertWorkspaceBoundary(boundary))
    chmodSync(root, 0o710)
    assert.throws(() => assertWorkspaceBoundary(boundary), /directory boundary changed/)
    chmodSync(root, 0o700)
    chmodSync(workspace, 0o710)
    assert.throws(() => assertWorkspaceBoundary(boundary), /directory boundary changed/)
  })
})

test('placeholder or incomplete dashboard exports fail before Cargo can embed them', () => {
  withTempDirectory((root) => {
    writeDashboardFixture(root, { placeholder: true })
    assert.throws(() => assertDashboardAssets(root), /placeholder/)
  })
  withTempDirectory((root) => {
    writeDashboardFixture(root, { missingOutputAsset: true })
    assert.throws(() => assertDashboardAssets(root), /missing public asset/)
  })
})

test('toolchain gates accept only the requested Node, pnpm, Rust versions and target', () => {
  const actual = {
    nodeVersion: 'v24.22.3',
    pnpmVersion: manifest.inputs.pnpmVersion,
    rustc: {
      version: '1.86.0',
      release: '1.86.0',
      host: manifest.inputs.cargoBuild.target
    },
    cargo: {
      version: '1.86.0',
      release: '1.86.0',
      host: manifest.inputs.cargoBuild.target
    },
    rustdoc: {
      version: '1.86.0',
      release: '1.86.0',
      host: manifest.inputs.cargoBuild.target
    }
  }
  const expected = {
    nodeMajor: manifest.inputs.nodeMajor,
    pnpmVersion: manifest.inputs.pnpmVersion,
    rustcVersion: '1.86.0',
    cargoVersion: '1.86.0',
    target: manifest.inputs.cargoBuild.target
  }
  assert.doesNotThrow(() => assertToolchainIdentity(actual, expected))
  assert.throws(
    () => assertToolchainIdentity({ ...actual, nodeVersion: 'v23.9.0' }, expected),
    /Node 24 is required/
  )
  assert.throws(
    () => assertToolchainIdentity({ ...actual, pnpmVersion: '11.17.0' }, expected),
    /pnpm version mismatch/
  )
  assert.throws(
    () =>
      assertToolchainIdentity(
        { ...actual, rustc: { ...actual.rustc, version: '1.87.0' } },
        expected
      ),
    /rustc version mismatch/
  )
  assert.throws(
    () =>
      assertToolchainIdentity(
        { ...actual, cargo: { ...actual.cargo, host: 'aarch64-unknown-linux-gnu' } },
        expected
      ),
    /Rust tools do not match/
  )
  assert.throws(
    () =>
      assertToolchainIdentity(
        { ...actual, rustdoc: { ...actual.rustdoc, host: 'aarch64-unknown-linux-gnu' } },
        expected
      ),
    /Rust tools do not match/
  )
})

test('the private build receipt retains lock, source, toolchain, notice and distribution gates', () => {
  const digest = 'a'.repeat(64)
  const sourceDigests = {
    reconstructedTreeSha256: digest,
    licenseSha256: digest,
    cargoLockSha256: digest,
    pnpmLockSha256: manifest.inputs.pnpmLock.sha256,
    patchSha256: manifest.patch.sha256,
    patchedFiles: manifest.patch.files.map((entry) => ({
      path: entry.path,
      sha256: entry.patchedSha256
    })),
    notices: manifest.preservedNotices.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256
    }))
  }
  const toolchain = {
    executableIdentities: {
      cargo: { path: '/opt/cargo', sha256: digest, mode: 0o755, currentUserWritable: false }
    },
    node: { version: 'v24.22.3', executable: '/usr/bin/node', executableSha256: digest },
    pnpm: {
      version: manifest.inputs.pnpmVersion,
      executable: '/opt/pnpm',
      executableSha256: digest
    },
    rustc: { version: '1.86.0', executable: '/opt/rustc', executableSha256: digest },
    cargo: { version: '1.86.0', executable: '/opt/cargo', executableSha256: digest },
    rustdoc: { version: '1.86.0', executable: '/opt/rustdoc', executableSha256: digest },
    nativeTools: {
      cc: { version: 'cc 1', executable: '/usr/bin/cc', executableSha256: digest },
      git: { executable: '/usr/bin/git', executableSha256: digest },
      tar: { executable: '/usr/bin/tar', executableSha256: digest },
      sh: { executable: '/usr/bin/sh', executableSha256: digest },
      env: { executable: '/usr/bin/env', executableSha256: digest }
    }
  }
  const recipe = {
    manifestSha256: digest,
    scripts: [
      {
        path: 'config/scripts/native-build/agent-browser-owned-source.mjs',
        mode: 0o600,
        sha256: digest
      }
    ],
    commands: {
      pnpmInstall: {
        executable: '/opt/pnpm',
        arguments: ['install', '--offline', '--frozen-lockfile']
      },
      dashboardBuild: {
        executable: '/opt/pnpm',
        arguments: ['--filter', 'dashboard', 'run', 'build']
      },
      cargoBuild: { executable: '/opt/cargo', arguments: manifest.inputs.cargoBuild.arguments }
    }
  }
  const preCargoInput = {
    schemaVersion: 2,
    source: { entries: [], entryCount: 0, sha256: digest },
    packageManager: { entries: [], entryCount: 0, sha256: digest },
    dashboard: { entries: [], entryCount: 0, sha256: digest },
    cargoRegistry: { entries: [], entryCount: 0, sha256: digest },
    generatedDirectories: {
      packageManager: ['node_modules'],
      dashboard: ['packages/dashboard/out']
    },
    sha256: digest
  }
  const receipt = createPrivateBuildReceipt({
    sourceDigests,
    dashboardAssetsSha256: digest,
    target: manifest.inputs.cargoBuild.target,
    toolchain,
    artifactSha256: digest,
    recipe,
    inputManifestSha256: digest,
    preCargoInput
  })
  assert.equal(receipt.schemaVersion, 3)
  assert.equal(receipt.source.inputSnapshot.cargoRegistrySha256, digest)
  assert.equal(receipt.source.pnpmLockSha256, manifest.inputs.pnpmLock.sha256)
  assert.equal(receipt.source.reconstructedTreeSha256, digest)
  assert.equal(receipt.source.cargoLockSha256, digest)
  assert.equal(receipt.source.patchSha256, manifest.patch.sha256)
  assert.deepEqual(
    receipt.source.patchedFiles.map(({ path, sha256 }) => ({ path, sha256 })),
    manifest.patch.files.map(({ path, patchedSha256 }) => ({ path, sha256: patchedSha256 }))
  )
  assert.equal(receipt.source.notices.length, manifest.preservedNotices.length)
  assert.equal(receipt.source.dashboardAssetsSha256, digest)
  assert.equal(receipt.artifact.sha256, digest)
  assert.equal(receipt.build.pnpm.version, manifest.inputs.pnpmVersion)
  assert.equal(receipt.build.rustc.executable, '/opt/rustc')
  assert.deepEqual(receipt.build.nativeTools, toolchain.nativeTools)
  assert.deepEqual(receipt.build.recipe, recipe)
  assert.equal(receipt.build.inputManifest.sha256, digest)
  assert.equal(receipt.build.inputManifest.snapshotSha256, digest)
  assert.equal(receipt.source.inputSnapshot.preCargoSha256, digest)
  assert.deepEqual(receipt.distributionGate, assertDistributionGateBlocked())
  assert.equal(receipt.claims.buildInputCoverage, 'source-package-manager-dashboard-cargo-registry')
  assert.equal(receipt.claims.cargoRegistrySnapshot, 'verified-before-and-after-cargo')
  assert.equal(receipt.claims.distributionEligibility, 'blocked')
  assert.equal(receipt.claims.sameUidRaceProtection, 'not-provided-by-hashing')
  assert.equal(receipt.claims.productionTrust, 'blocked')
  assert.equal(JSON.stringify(receipt).includes('credential-sentinel'), false)
})
