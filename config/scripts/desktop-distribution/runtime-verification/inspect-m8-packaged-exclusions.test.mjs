import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'vitest'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const scanner = require('./inspect-m8-packaged-exclusions.cjs')
const identity = require('../release/ash-package-input-identity.cjs')
const REPO_ROOT = resolve(import.meta.dirname, '../../../..')

const EXPECTED_COMMIT = 'a'.repeat(40)
const VERSION = '1.2.3'
const SOURCE_COMMIT = EXPECTED_COMMIT
const roots = []

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function retainedFiles() {
  return {
    'out/main/index.js': "require('./browser-extension-preload.js')\n",
    'out/main/browser-extension-preload.js': 'module.exports = true\n',
    'out/main/browser-extension-native-host-supervisor-entry.js': 'module.exports = true\n',
    'out/main/daemon-entry.js': 'module.exports = true\n',
    'out/main/chunks/relay-bundle-paths-fixture.js': 'module.exports = true\n',
    'out/preload/index.js': 'module.exports = true\n',
    'out/shared/browser/client-hosting/browser-client-automation-protocol.js':
      'module.exports = true\n',
    'out/cli/index.js': '#!/usr/bin/env node\n',
    'out/renderer/index.html': '<script src="./assets/runtime.js"></script>\n',
    'out/renderer/assets/runtime.js': 'window.fixture = true\n',
    'resources/skills/current-manifest.json': '{}\n'
  }
}

async function makeFixture({
  sourceCommit = SOURCE_COMMIT,
  cliCommit = SOURCE_COMMIT,
  version = VERSION,
  architecture = 'x64',
  files = {},
  missingRetained = [],
  unpackPattern = 'out'
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ash-m8-exclusions-test-'))
  roots.push(root)
  const resourcesDir = join(root, 'resources')
  const sourceDir = join(root, 'asar-source')
  await mkdir(sourceDir, { recursive: true })
  await mkdir(join(resourcesDir, 'app.asar.unpacked'), { recursive: true })

  const archiveFiles = {
    LICENSE: await readFile(join(REPO_ROOT, 'LICENSE')),
    ...retainedFiles(),
    ...files,
    'package.json': JSON.stringify({ name: 'ash-ide', version }),
    'out/package.json': JSON.stringify({
      name: 'ash-ide-compiled-output',
      type: 'commonjs',
      private: true,
      version,
      commit: cliCommit
    })
  }
  for (const path of missingRetained) {
    delete archiveFiles[path]
  }
  for (const [relative, contents] of Object.entries(archiveFiles)) {
    const filePath = join(sourceDir, ...relative.split('/'))
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, contents)
  }

  const archivePath = join(resourcesDir, 'app.asar')
  await asar.createPackageWithOptions(sourceDir, archivePath, { unpackDir: unpackPattern })
  const cliPackagePath = join(resourcesDir, 'app.asar.unpacked', 'out', 'package.json')
  const archiveBytes = await readFile(archivePath)
  const cliPackageBytes = await readFile(cliPackagePath)
  await writeFile(
    join(resourcesDir, 'ash-package-input-identity.json'),
    `${JSON.stringify({
      schema: 1,
      evidenceKind: 'packaging-input-snapshot',
      appId: 'com.ashide.desktop',
      productName: 'Ash IDE',
      packageName: 'ash-ide',
      version,
      architecture,
      sourceCommit,
      capturedAppAsarSha256: sha256(archiveBytes),
      capturedCompiledCliPackageJsonSha256: sha256(cliPackageBytes)
    })}\n`
  )
  return { root, resourcesDir, archivePath, cliPackagePath }
}

async function inspect(resourcesDir, expected = EXPECTED_COMMIT) {
  try {
    const report = await scanner.inspect({ resourcesDir, expected })
    return { status: scanner.exitCodeForReport(report), report, stderr: '' }
  } catch (error) {
    const report = scanner.reportForError(error)
    return { status: 1, report, stderr: '' }
  }
}

async function updateSidecar(resourcesDir, update) {
  const sidecarPath = join(resourcesDir, 'ash-package-input-identity.json')
  const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'))
  await writeFile(sidecarPath, `${JSON.stringify(update(sidecar))}\n`)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('matching static package evidence stays non-accepting without dynamic gates', async () => {
  const fixture = await makeFixture()
  const { status, report } = await inspect(fixture.resourcesDir)

  assert.notEqual(status, 0)
  assert.equal(scanner.exitCodeForReport(report), 1)
  assert.equal(report.result, 'non-accepting')
  assert.equal(report.staticFindings.status, 'no-hard-findings')
  assert.equal(report.identity.status, 'verified')
  assert.equal(report.inventory.asarFileCount, Object.keys(retainedFiles()).length + 3)
  assert.equal(report.inventory.exactExclusionHits.length, 0)
  assert.equal(report.gates['EX-09'].status, 'not-tested')
  assert.equal(report.gates['EX-10'].status, 'not-observed')
  assert.equal(report.inventory.retained.browserExtensionPreload, true)
  assert.equal(report.inventory.retained.browserExtensionHost, true)
  assert.equal(report.inventory.retained.localBrowserAutomation, true)
  assert.equal(report.inventory.retained.localCliRuntime, true)
  assert.equal(report.inventory.retained.localDaemonRuntime, true)
  assert.equal(report.inventory.retained.wslProviderHookRelay, true)
  assert.equal(report.inventory.retained.providerNativeSkills, true)
  assert.equal(report.inventory.retained.ashUpdateConfigAbsent, true)
  assert.deepEqual(report.failures, [])
})

test('an exact excluded artifact is a confirmed finding and fails the static gate', async () => {
  const fixture = await makeFixture({
    files: { 'out/cli/handlers/jira.js': 'module.exports = true\n' }
  })
  const { status, report } = await inspect(fixture.resourcesDir)

  assert.equal(status, 1)
  assert.equal(report.result, 'non-accepting')
  assert.equal(report.staticFindings.status, 'hard-findings')
  assert.deepEqual(report.inventory.exactExclusionHits, [
    { path: 'out/cli/handlers/jira.js', policy: 'EX-07 task tracker CLI artifact' }
  ])
  assert.match(report.gates['EX-07'].status, /forbidden/)
})

test('exact mobile relay artifacts map to EX-01 rather than the vendor cloud relay gate', async () => {
  const fixture = await makeFixture({
    files: {
      'out/shared/remote-runtime/relay/mobile-relay-phone-protocol.js': 'module.exports = true\n'
    }
  })
  const { status, report } = await inspect(fixture.resourcesDir)

  assert.equal(status, 1)
  assert.equal(report.gates['EX-01'].status, 'confirmed-forbidden-artifact')
  assert.equal(report.gates['EX-06'].status, 'not-observed')
  assert.equal(
    report.inventory.exactExclusionHits[0].path,
    'out/shared/remote-runtime/relay/mobile-relay-phone-protocol.js'
  )

  const vendorRelayFixture = await makeFixture({
    files: { 'out/relay/server.js': 'module.exports = true\n' }
  })
  const vendorRelay = await inspect(vendorRelayFixture.resourcesDir)
  assert.equal(vendorRelay.report.gates['EX-06'].status, 'confirmed-forbidden-artifact')
  assert.equal(vendorRelay.report.gates['EX-01'].status, 'not-observed')
})

test('a broad path candidate needs review and is not treated as a forbidden artifact', async () => {
  const fixture = await makeFixture({
    files: {
      'out/shared/remote-runtime/pairing/pairing-migration-compat.js': 'module.exports = true\n'
    }
  })
  const { status, report } = await inspect(fixture.resourcesDir)

  assert.notEqual(status, 0)
  assert.equal(report.result, 'non-accepting')
  assert.equal(report.staticFindings.status, 'review-needed')
  assert.equal(report.inventory.exactExclusionHits.length, 0)
  assert.equal(report.gates['EX-01'].status, 'review-needed')
  assert.equal(report.gates['EX-01'].filenameCandidates.count, 1)
  assert.equal(report.failures.length, 0)
})

test('EX-09 telemetry paths and EX-10 obsolete Orca names remain distinct', async () => {
  const fixture = await makeFixture({
    files: {
      'out/shared/telemetry-offline-migration.js': 'module.exports = true\n',
      'out/cli/runtime/orca-app-executable.js': 'module.exports = true\n',
      'node_modules/posthog-node/index.js': 'module.exports = true\n'
    }
  })
  const { report } = await inspect(fixture.resourcesDir)
  const ex09 = report.inventory.candidateAreas.find((area) => area.id === 'EX-09')
  const ex10 = report.inventory.candidateAreas.find((area) => area.id === 'EX-10')

  assert.equal(ex09.shippedFileCount, 2)
  assert.deepEqual(
    ex09.examples.map((item) => item.path),
    ['node_modules/posthog-node/index.js', 'out/shared/telemetry-offline-migration.js']
  )
  assert.equal(ex10.shippedFileCount, 1)
  assert.deepEqual(
    ex10.examples.map((item) => item.path),
    ['out/cli/runtime/orca-app-executable.js']
  )
  assert.equal(report.gates['EX-09'].status, 'not-tested')
  assert.ok(report.gates['EX-09'].confirmedForbiddenArtifacts.length > 0)
  assert.equal(
    report.gates['EX-09'].confirmedForbiddenArtifacts.every((item) =>
      item.policy.includes('posthog-node')
    ),
    true
  )
  assert.equal(
    report.gates['EX-10'].confirmedForbiddenArtifacts.some((item) => item.path.includes('posthog')),
    false
  )
  assert.equal(report.gates['EX-10'].status, 'review-needed')
  assert.equal(report.staticFindings.status, 'hard-findings')
  assert.equal(report.gates['PK-08'].status, 'fail')
})

test('stale and unknown source identity and mismatched hashes fail artifact identity', async () => {
  for (const sourceCommit of ['b'.repeat(40), null, 'unknown']) {
    const fixture = await makeFixture({ sourceCommit })
    const { status, report } = await inspect(fixture.resourcesDir)
    assert.equal(status, 1)
    assert.equal(report.identity.status, 'mismatch')
    assert.equal(report.identity.sourceCommitMatches, false)
    assert.equal(report.staticFindings.status, 'hard-findings')
  }

  const fixture = await makeFixture()
  await updateSidecar(fixture.resourcesDir, (sidecar) => ({
    ...sidecar,
    capturedAppAsarSha256: '0'.repeat(64)
  }))
  const { status, report } = await inspect(fixture.resourcesDir)
  assert.equal(status, 1, JSON.stringify(report))
  assert.equal(report.identity.status, 'mismatch')
  assert.equal(report.identity.appAsarMatchesSidecar, false)
  assert.equal(
    report.failures.some((failure) => /app\.asar digest mismatch/.test(failure)),
    true
  )

  const cliFixture = await makeFixture()
  await updateSidecar(cliFixture.resourcesDir, (sidecar) => ({
    ...sidecar,
    capturedCompiledCliPackageJsonSha256: '0'.repeat(64)
  }))
  const cliResult = await inspect(cliFixture.resourcesDir)
  assert.equal(cliResult.report.identity.status, 'mismatch')
  assert.equal(cliResult.report.identity.cliPackageJsonMatchesSidecar, false)
})

test('missing retained path controls fail the offline gate', async () => {
  const fixture = await makeFixture({
    missingRetained: ['out/main/browser-extension-native-host-supervisor-entry.js']
  })
  const { status, report } = await inspect(fixture.resourcesDir)

  assert.equal(status, 1, JSON.stringify(report))
  assert.equal(report.inventory.retained.browserExtensionHost, false)
  assert.equal(
    report.failures.some((failure) => /retained path control.*browserExtensionHost/.test(failure)),
    true
  )
})

test('matching digests cannot authenticate a stale compiled CLI commit or unsupported identity', async () => {
  const stale = await makeFixture({ cliCommit: 'b'.repeat(40) })
  const { report } = await inspect(stale.resourcesDir)
  assert.equal(report.identity.sourceCommitMatches, true)
  assert.equal(report.identity.cliPackageJsonMatchesSidecar, true)
  assert.equal(report.identity.cliSourceCommitMatches, false)
  assert.equal(report.identity.status, 'mismatch')
  for (const overrides of [{ version: 'not-a-version' }, { architecture: 'universal' }]) {
    const fixture = await makeFixture(overrides)
    assert.equal((await inspect(fixture.resourcesDir)).report.identity.status, 'mismatch')
  }
})

test('literal import read budget is cumulative across roots and incomplete analysis stays non-accepting', async () => {
  const fixture = await makeFixture()
  const report = await scanner.inspect({
    resourcesDir: fixture.resourcesDir,
    expected: EXPECTED_COMMIT,
    importReadLimit: 64
  })
  assert.equal(report.inspection.literalImportAnalysisBudgetExhausted, true)
  assert.equal(report.inspection.literalImportAnalysisStatus, 'incomplete')
  assert.ok(report.inspection.literalImportAnalysisBytesRead <= 64)
  assert.equal(report.staticFindings.status, 'inspection-incomplete')
  assert.equal(report.gates['PK-08'].status, 'inspection-incomplete')
  assert.equal(scanner.exitCodeForReport(report), 1)
})

test('unlisted, symlinked, or size-mismatched unpacked files fail safely', async () => {
  const unlisted = await makeFixture()
  const orphan = join(unlisted.resourcesDir, 'app.asar.unpacked', 'out', 'unlisted.js')
  await writeFile(orphan, 'unlisted\n')
  let result = await inspect(unlisted.resourcesDir)
  assert.equal(result.status, 1)
  assert.equal(result.report.inventory.unlistedUnpackedFileCount, 1)

  const sizeMismatch = await makeFixture()
  await writeFile(
    join(sizeMismatch.resourcesDir, 'app.asar.unpacked', 'out', 'main', 'index.js'),
    'changed size\n'
  )
  result = await inspect(sizeMismatch.resourcesDir)
  assert.equal(result.status, 1)
  assert.equal(result.report.staticFindings.status, 'inspection-failed')
  assert.match(result.report.error ?? result.report.failures.join('\n'), /size|changed|unpacked/i)

  const symlinked = await makeFixture()
  const unpacked = join(symlinked.resourcesDir, 'app.asar.unpacked', 'out', 'main', 'index.js')
  const external = join(symlinked.root, 'external.js')
  await rename(unpacked, external)
  await symlink(external, unpacked)
  result = await inspect(symlinked.resourcesDir)
  assert.equal(result.status, 1)
  assert.match(result.report.error ?? result.report.failures.join('\n'), /symlink|symbolic/i)
})

test('malformed ASAR and symlinked input paths are rejected', async () => {
  const malformed = await makeFixture()
  const archive = await readFile(malformed.archivePath)
  archive.writeUInt32LE(8, 0)
  await writeFile(malformed.archivePath, archive)
  await updateSidecar(malformed.resourcesDir, (sidecar) => ({
    ...sidecar,
    capturedAppAsarSha256: sha256(archive)
  }))
  let result = await inspect(malformed.resourcesDir)
  assert.equal(result.status, 1)
  assert.equal(result.report.staticFindings.status, 'inspection-failed')
  assert.match(result.report.error, /header|malformed|invalid/i)

  const symlinkedArchive = await makeFixture()
  await rename(symlinkedArchive.archivePath, `${symlinkedArchive.archivePath}.real`)
  await symlink(`${symlinkedArchive.archivePath}.real`, symlinkedArchive.archivePath)
  result = await inspect(symlinkedArchive.resourcesDir)
  assert.equal(result.status, 1)
  assert.match(result.report.error, /ELOOP|too many|symlink|regular|single-link|changed/i)

  const alias = join(symlinkedArchive.root, 'alias')
  await mkdir(alias)
  const resourcesAlias = join(alias, 'resources')
  await symlink(symlinkedArchive.resourcesDir, resourcesAlias)
  result = await inspect(resourcesAlias)
  assert.equal(result.status, 1)
  assert.match(result.report.error, /real directory|symlink/i)
})

test('package identity snapshot rejects archive, sidecar, or CLI metadata races', async () => {
  const mutations = [
    {
      selectPath: (fixture) => fixture.archivePath,
      contents: 'replacement after the pinned copy'
    },
    {
      selectPath: (fixture) => join(fixture.resourcesDir, 'ash-package-input-identity.json'),
      contents: '{"changed":true}\n'
    },
    {
      selectPath: (fixture) => fixture.cliPackagePath,
      contents: '{"changed":true}\n'
    }
  ]
  for (const mutation of mutations) {
    const fixture = await makeFixture()
    await assert.rejects(
      identity.withAshPackageInputSnapshot(
        fixture.resourcesDir,
        async () => writeFile(mutation.selectPath(fixture), mutation.contents),
        asar
      ),
      /changed while being inspected/
    )
  }
})

test('package identity rejects a changed private ASAR copy before trusting its digest', async () => {
  const original = await makeFixture({
    files: { 'out/cli/handlers/jira.js': 'module.exports = true\n' }
  })
  const replacement = await makeFixture()
  const cleanArchive = await readFile(replacement.archivePath)
  const replacingReader = {
    listPackage(archivePath) {
      writeFileSync(archivePath, cleanArchive)
      return asar.listPackage(archivePath)
    },
    statFile: (...args) => asar.statFile(...args),
    extractFile: (...args) => asar.extractFile(...args)
  }

  await assert.rejects(
    identity.withAshPackageInputSnapshot(original.resourcesDir, async () => {}, replacingReader),
    /inspection copy.*changed|changed while being inspected/
  )
})

test('inspection uncaches its private ASAR on success and failure', async () => {
  const fixture = await makeFixture()
  for (const fail of [false, true]) {
    const copies = []
    const uncached = []
    const reader = {
      listPackage(archivePath) {
        copies.push(archivePath)
        return asar.listPackage(archivePath)
      },
      statFile: (...args) => asar.statFile(...args),
      extractFile: (...args) => asar.extractFile(...args),
      uncache(archivePath) {
        uncached.push(archivePath)
        return asar.uncache(archivePath)
      }
    }
    const run = identity.withAshPackageInputSnapshot(
      fixture.resourcesDir,
      async () => {
        if (fail) {
          throw new Error('fixture inspection failed')
        }
        return 'ok'
      },
      reader
    )
    if (fail) {
      await assert.rejects(run, /fixture inspection failed/)
    } else {
      assert.equal(await run, 'ok')
    }
    assert.equal(copies.length, 1)
    assert.deepEqual(uncached, copies)
  }
})
