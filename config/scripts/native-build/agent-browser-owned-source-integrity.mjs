import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { manifest, patchLicensePath, patchPath } from './agent-browser-owned-source-manifest.mjs'
import {
  fail,
  resolveInputDirectory,
  resolveTreeFile,
  sha256,
  sha256File,
  sha256Tree
} from './agent-browser-owned-source-files.mjs'
import { assertPinnedTreeIdentity } from './agent-browser-owned-source-tree-snapshot.mjs'
export { manifest, manifestPath, patchPath } from './agent-browser-owned-source-manifest.mjs'
export {
  fail,
  isWithin,
  resolveInputDirectory,
  resolveTreeDirectory,
  resolveTreeFile,
  sha256,
  sha256File,
  sha256Tree,
  walkFiles
} from './agent-browser-owned-source-files.mjs'
export {
  assertPreCargoInputSnapshotUnchanged,
  assertSourceInputSnapshotUnchanged,
  captureGeneratedInputs,
  createPreCargoInputSnapshot,
  createSourceInputSnapshot,
  assertGeneratedInputsUnchanged
} from './agent-browser-owned-source-inputs.mjs'

export function assertPinnedRevision(revision) {
  if (revision !== manifest.source.commit) {
    fail(`Upstream revision mismatch. Expected ${manifest.source.commit}, found ${revision}.`)
  }
}

export function assertCleanReferenceStatus(status) {
  if (status) {
    fail('The upstream reference must have a clean tracked and untracked working tree.')
  }
}

export function assertSafeArchiveEntries(listing) {
  const records = listing.split('\0').filter(Boolean)
  if (records.length === 0) {
    fail('Pinned source archive is empty.')
  }
  for (const record of records) {
    const separator = record.indexOf('\t')
    if (separator === -1) {
      fail('Git tree listing contains an invalid record.')
    }
    const metadata = record.slice(0, separator).split(' ')
    const path = record.slice(separator + 1)
    if (metadata[1] !== 'blob' || (metadata[0] !== '100644' && metadata[0] !== '100755')) {
      fail(`Pinned source archive contains a symlink or non-regular entry: ${path}`)
    }
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      fail('Pinned source archive contains an unsafe path.')
    }
  }
}

function verifyPinnedFiles(root, entries, expectedHash, label) {
  for (const entry of entries) {
    const path = resolveTreeFile(root, entry.path, label)
    const actual = sha256File(path)
    const expected = expectedHash(entry)
    if (actual !== expected) {
      fail(`${label} hash mismatch for ${entry.path}.`)
    }
  }
}

export function verifyPinnedFileSet(root, entries) {
  verifyPinnedFiles(root, entries, (entry) => entry.sha256, 'Pinned input')
}

export function verifyReference(referencePath, runGit) {
  const reference = resolveInputDirectory(referencePath, 'Upstream reference')
  const topLevel = runGit(reference, ['rev-parse', '--show-toplevel'])
  if (resolve(topLevel) !== reference) {
    fail('The upstream reference path must be the Git worktree root.')
  }

  const revision = runGit(reference, ['rev-parse', 'HEAD'])
  assertPinnedRevision(revision)
  if (runGit(reference, ['rev-parse', `${revision}^{tree}`]) !== manifest.source.gitTree) {
    fail('Pinned Git commit tree identity mismatch.')
  }
  assertSafeArchiveEntries(runGit(reference, ['ls-tree', '-r', '-z', '--full-tree', revision]))
  assertCleanReferenceStatus(
    runGit(reference, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignore-submodules=none'
    ])
  )

  const pinnedInputs = [
    manifest.inputs.license,
    manifest.inputs.cargoLock,
    manifest.inputs.pnpmLock,
    ...manifest.patch.files.filter((entry) => entry.originalSha256),
    ...manifest.preservedNotices
  ]
  verifyPinnedFiles(
    reference,
    pinnedInputs,
    (entry) => entry.sha256 ?? entry.originalSha256,
    'Pinned source'
  )

  const rootPackage = JSON.parse(
    readFileSync(resolveTreeFile(reference, 'package.json', 'Upstream input'), 'utf8')
  )
  if (rootPackage.version !== manifest.source.version) {
    fail(`Upstream package version must be ${manifest.source.version}.`)
  }
  if (rootPackage.packageManager !== `pnpm@${manifest.inputs.pnpmVersion}`) {
    fail(`Upstream package manager must be pnpm@${manifest.inputs.pnpmVersion}.`)
  }
  const nodeVersion = readFileSync(
    resolveTreeFile(reference, '.node-version', 'Upstream input'),
    'utf8'
  ).trim()
  if (nodeVersion !== String(manifest.inputs.nodeMajor)) {
    fail(`Upstream Node version input must remain ${manifest.inputs.nodeMajor}.`)
  }
  const cargoManifest = readFileSync(
    resolveTreeFile(reference, 'cli/Cargo.toml', 'Upstream input'),
    'utf8'
  )
  if (!new RegExp(`^version\\s*=\\s*"${manifest.source.version}"$`, 'm').test(cargoManifest)) {
    fail(`Cargo package version must be ${manifest.source.version}.`)
  }
  const lockText = readFileSync(
    resolveTreeFile(reference, manifest.inputs.cargoLock.path, 'Upstream input'),
    'utf8'
  )
  const packageCount = (lockText.match(/^\[\[package\]\]$/gm) ?? []).length
  if (packageCount !== manifest.inputs.cargoLock.packageCount) {
    fail(
      `Cargo.lock package count mismatch. Expected ${
        manifest.inputs.cargoLock.packageCount
      }, found ${packageCount}.`
    )
  }
  return reference
}

export function verifyPatchArtifact(patchBytes = readFileSync(patchPath)) {
  if (sha256File(patchLicensePath) !== manifest.inputs.license.sha256) {
    fail('The source patch must retain the exact pinned upstream Apache license.')
  }
  if (sha256(patchBytes) !== manifest.patch.sha256) {
    fail(
      'Pinned patch SHA-256 mismatch. Restore the reviewed patch before preparing a source tree.'
    )
  }
  const patchText = patchBytes.toString('utf8')
  const paths = [...patchText.matchAll(/^diff --git a\/([^\s]+) b\/([^\s]+)$/gm)].map((match) => {
    if (match[1] !== match[2] || match[1].split('/').includes('..') || match[1].startsWith('/')) {
      fail('Patch contains a path outside its reviewed source file.')
    }
    return match[1]
  })
  const expected = manifest.patch.files.map((entry) => entry.path).sort()
  if (
    paths.length !== expected.length ||
    JSON.stringify(paths.sort()) !== JSON.stringify(expected)
  ) {
    fail('Patch file set does not match the reviewed source manifest.')
  }
  return patchText
}

export function verifyTreePins(sourceDirectory) {
  const pinned = [
    manifest.inputs.license,
    manifest.inputs.cargoLock,
    manifest.inputs.pnpmLock,
    ...manifest.preservedNotices,
    { path: manifest.inputs.dashboard.font.path, sha256: manifest.inputs.dashboard.font.sha256 },
    {
      path: manifest.inputs.dashboard.font.noticePath,
      sha256: manifest.inputs.dashboard.font.noticeSha256
    }
  ]
  verifyPinnedFiles(sourceDirectory, pinned, (entry) => entry.sha256, 'Pinned source tree file')
  verifyPinnedFiles(
    sourceDirectory,
    manifest.patch.files,
    (entry) => entry.patchedSha256,
    'Patched source file'
  )
}

export function sourceDigestRecord(sourceDirectory) {
  verifyTreePins(sourceDirectory)
  return {
    reconstructedTreeSha256: sha256Tree(sourceDirectory),
    completeTreeIdentity: assertPinnedTreeIdentity(
      sourceDirectory,
      manifest.source.patchedTree,
      'Patched source tree'
    ),
    licenseSha256: sha256File(
      resolveTreeFile(sourceDirectory, manifest.inputs.license.path, 'License')
    ),
    cargoLockSha256: sha256File(
      resolveTreeFile(sourceDirectory, manifest.inputs.cargoLock.path, 'Cargo lockfile')
    ),
    pnpmLockSha256: sha256File(
      resolveTreeFile(sourceDirectory, manifest.inputs.pnpmLock.path, 'pnpm lockfile')
    ),
    patchSha256: sha256File(patchPath),
    patchedFiles: manifest.patch.files.map((entry) => ({
      path: entry.path,
      sha256: sha256File(resolveTreeFile(sourceDirectory, entry.path, 'Patched source file'))
    })),
    notices: manifest.preservedNotices.map((entry) => ({
      path: entry.path,
      sha256: sha256File(resolveTreeFile(sourceDirectory, entry.path, 'Preserved notice'))
    }))
  }
}

export function assertDistributionGateBlocked() {
  const gate = manifest.distributionGate
  if (gate.status !== 'blocked' || !Array.isArray(gate.blockers) || gate.blockers.length === 0) {
    fail('Distribution remains blocked until the reviewed notice gates are cleared.')
  }
  return { status: gate.status, blockers: [...gate.blockers] }
}
