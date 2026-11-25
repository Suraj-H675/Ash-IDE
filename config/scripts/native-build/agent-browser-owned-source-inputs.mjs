import { readFileSync } from 'node:fs'
import {
  assertTreeSnapshotUnchanged,
  captureTreeSnapshot
} from './agent-browser-owned-source-tree-snapshot.mjs'
import {
  fail,
  resolveInputDirectory,
  resolveTreeDirectory,
  resolveTreeFile,
  sha256
} from './agent-browser-owned-source-files.mjs'
import { manifest } from './agent-browser-owned-source-manifest.mjs'

function parsePnpmImporters(lockText) {
  const lines = lockText.split(/\r?\n/)
  const section = lines.findIndex((line) => /^importers:\s*$/.test(line))
  if (section === -1) {
    fail('Pinned pnpm lockfile has no importer list for generated-directory boundaries.')
  }
  const importers = []
  for (let index = section + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line && !line.startsWith(' ')) {
      break
    }
    if (!line.startsWith('  ') || line.startsWith('   ')) {
      continue
    }
    const match = line.match(/^  (.+?):(?:\s.*)?$/)
    if (!match) {
      fail('Pinned pnpm lockfile contains an unsupported importer key.')
    }
    let importer = match[1]
    if (importer.startsWith("'") && importer.endsWith("'")) {
      importer = importer.slice(1, -1).replaceAll("''", "'")
    } else if (importer.startsWith('"') && importer.endsWith('"')) {
      try {
        importer = JSON.parse(importer)
      } catch {
        fail('Pinned pnpm lockfile contains an invalid quoted importer key.')
      }
    }
    if (
      importer !== '.' &&
      (!importer ||
        importer.includes('\\') ||
        importer.startsWith('/') ||
        importer.split('/').some((part) => !part || part === '.' || part === '..'))
    ) {
      fail('Pinned pnpm lockfile contains an unsafe importer path.')
    }
    importers.push(importer)
  }
  if (!importers.includes('.') || new Set(importers).size !== importers.length) {
    fail('Pinned pnpm lockfile importer list is incomplete or duplicated.')
  }
  return importers
}

function sourceGeneratedDirectories(sourceDirectory) {
  const source = resolveInputDirectory(sourceDirectory, 'Source tree')
  const policy = manifest.inputs.generatedDirectoryPolicy
  if (
    policy?.nodeModulesPerPnpmImporter !== true ||
    !Array.isArray(policy.dashboardRelative) ||
    policy.dashboardRelative.length === 0
  ) {
    fail('Pinned source manifest has no complete generated-directory policy.')
  }
  const lock = manifest.inputs.pnpmLock
  const lockText = readFileSync(resolveTreeFile(source, lock.path, 'Pinned pnpm lockfile'), 'utf8')
  const importers = parsePnpmImporters(lockText)
  const packageManager = importers.map((importer) => {
    if (importer !== '.') {
      resolveTreeDirectory(source, importer, 'Pnpm workspace importer')
      resolveTreeFile(source, `${importer}/package.json`, 'Pnpm workspace package')
    }
    return importer === '.' ? 'node_modules' : `${importer}/node_modules`
  })
  const dashboard = policy.dashboardRelative.map((path) => {
    if (
      typeof path !== 'string' ||
      !path ||
      path.includes('\\') ||
      path.startsWith('/') ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      fail('Pinned source manifest contains an unsafe generated dashboard path.')
    }
    const relativePath = `${manifest.inputs.dashboard.packagePath}/${path}`
    resolveTreeDirectory(source, manifest.inputs.dashboard.packagePath, 'Dashboard package')
    return relativePath
  })
  return {
    packageManager: [...new Set(packageManager)].sort(),
    dashboard: [...new Set(dashboard)].sort()
  }
}

function flattenGeneratedDirectories(generatedDirectories) {
  return [
    ...new Set([...generatedDirectories.packageManager, ...generatedDirectories.dashboard])
  ].sort()
}

function assertGeneratedRootsAbsent(sourceDirectory, generatedDirectories) {
  for (const path of flattenGeneratedDirectories(generatedDirectories)) {
    try {
      resolveTreeDirectory(sourceDirectory, path, 'Generated source directory')
      fail(`Generated source directory already exists before package installation: ${path}`)
    } catch (error) {
      if (!String(error.message).includes('is missing:')) {
        throw error
      }
    }
  }
}

export function createSourceInputSnapshot(sourceDirectory) {
  const source = resolveInputDirectory(sourceDirectory, 'Source tree')
  const generatedDirectories = sourceGeneratedDirectories(source)
  assertGeneratedRootsAbsent(source, generatedDirectories)
  const baseline = captureTreeSnapshot(source, {
    excludedRoots: flattenGeneratedDirectories(generatedDirectories),
    label: 'source input tree'
  })
  return { schemaVersion: 1, generatedDirectories, source: baseline }
}

export function assertSourceInputSnapshotUnchanged(sourceDirectory, snapshot) {
  const source = resolveInputDirectory(sourceDirectory, 'Source tree')
  const generatedDirectories = sourceGeneratedDirectories(source)
  if (JSON.stringify(generatedDirectories) !== JSON.stringify(snapshot.generatedDirectories)) {
    fail('source input tree generated-directory policy changed after its snapshot was captured.')
  }
  return assertTreeSnapshotUnchanged(source, snapshot.source, {
    excludedRoots: flattenGeneratedDirectories(generatedDirectories),
    label: 'source input tree'
  })
}

export function captureGeneratedInputs(sourceDirectory, generatedDirectories) {
  return captureTreeSnapshot(sourceDirectory, {
    onlyRoots: generatedDirectories,
    allowMissingRoots: true,
    allowInternalSymlinks: true,
    label: 'generated source inputs'
  })
}

export function assertGeneratedInputsUnchanged(
  sourceDirectory,
  generatedDirectories,
  snapshot,
  label = 'generated source inputs'
) {
  const current = captureGeneratedInputs(sourceDirectory, generatedDirectories)
  if (
    current.sha256 !== snapshot.sha256 ||
    current.entryCount !== snapshot.entryCount ||
    JSON.stringify(current.entries) !== JSON.stringify(snapshot.entries)
  ) {
    fail(`${label} changed after its snapshot was captured.`)
  }
  return current
}

function preCargoSnapshotDigest(snapshot) {
  const content = { ...snapshot }
  delete content.sha256
  return sha256(Buffer.from(JSON.stringify(content)))
}

export function createPreCargoInputSnapshot(
  sourceDirectory,
  sourceSnapshot,
  packageManager,
  cargoRegistryPath
) {
  assertSourceInputSnapshotUnchanged(sourceDirectory, sourceSnapshot)
  assertGeneratedInputsUnchanged(
    sourceDirectory,
    sourceSnapshot.generatedDirectories.packageManager,
    packageManager
  )
  const dashboard = captureGeneratedInputs(
    sourceDirectory,
    sourceSnapshot.generatedDirectories.dashboard
  )
  const snapshot = {
    schemaVersion: 2,
    generatedDirectories: sourceSnapshot.generatedDirectories,
    source: sourceSnapshot.source,
    packageManager,
    dashboard,
    cargoRegistry: captureTreeSnapshot(cargoRegistryPath, { label: 'Cargo registry input tree' })
  }
  return { ...snapshot, sha256: preCargoSnapshotDigest(snapshot) }
}

export function assertPreCargoInputSnapshotUnchanged(sourceDirectory, snapshot, cargoRegistryPath) {
  if (snapshot.schemaVersion !== 2) {
    fail('Pre-Cargo input snapshot must include the Cargo registry.')
  }
  const sourceSnapshot = {
    schemaVersion: 1,
    generatedDirectories: snapshot.generatedDirectories,
    source: snapshot.source
  }
  assertSourceInputSnapshotUnchanged(sourceDirectory, sourceSnapshot)
  assertGeneratedInputsUnchanged(
    sourceDirectory,
    snapshot.generatedDirectories.packageManager,
    snapshot.packageManager,
    'pre-Cargo input tree'
  )
  assertGeneratedInputsUnchanged(
    sourceDirectory,
    snapshot.generatedDirectories.dashboard,
    snapshot.dashboard,
    'pre-Cargo input tree'
  )
  assertTreeSnapshotUnchanged(cargoRegistryPath, snapshot.cargoRegistry, {
    label: 'Cargo registry input tree'
  })
  const actual = {
    schemaVersion: snapshot.schemaVersion,
    generatedDirectories: snapshot.generatedDirectories,
    source: snapshot.source,
    packageManager: snapshot.packageManager,
    dashboard: snapshot.dashboard,
    cargoRegistry: snapshot.cargoRegistry
  }
  if (preCargoSnapshotDigest(actual) !== snapshot.sha256) {
    fail('pre-Cargo input tree changed after its snapshot was captured.')
  }
  return snapshot
}
