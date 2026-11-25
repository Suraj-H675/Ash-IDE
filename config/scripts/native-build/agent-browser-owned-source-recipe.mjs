import { lstatSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertDistributionGateBlocked } from './agent-browser-owned-source-integrity.mjs'
import { fail, isWithin, resolveTreeFile, sha256File } from './agent-browser-owned-source-files.mjs'
import { manifest, manifestPath } from './agent-browser-owned-source-manifest.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

export function captureRecipeFiles() {
  const expectedPaths = [...manifest.recipe.scriptPaths].sort()
  const actualNames = readdirSync(import.meta.dirname)
    .filter((name) => /^agent-browser-owned-.*\.mjs$/.test(name) && !name.endsWith('.test.mjs'))
    .sort()
  const actualPaths = actualNames.map((name) => `config/scripts/native-build/${name}`)
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    fail('Recipe script list does not match the native build implementation files.')
  }
  const scripts = expectedPaths.map((path) => {
    const absolute = resolve(repositoryRoot, path)
    if (!isWithin(repositoryRoot, absolute)) {
      fail(`Recipe script path leaves the repository: ${path}`)
    }
    const scriptPath = resolveTreeFile(repositoryRoot, path, 'Recipe script')
    const stat = lstatSync(scriptPath)
    return { path, mode: stat.mode & 0o7777, sha256: sha256File(scriptPath) }
  })
  return {
    manifestSha256: sha256File(manifestPath),
    scripts
  }
}

export function assertRecipeFilesUnchanged(expected) {
  const current = captureRecipeFiles()
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    fail('Native build recipe manifest or scripts changed after validation.')
  }
}

export function createBuildRecipe(fileIdentities, commands) {
  return { ...fileIdentities, commands }
}

export function createPrivateBuildReceipt({
  sourceDigests,
  dashboardAssetsSha256,
  target,
  toolchain,
  artifactSha256,
  recipe,
  inputManifestSha256,
  preCargoInput
}) {
  const distributionGate = assertDistributionGateBlocked()
  return {
    schemaVersion: 3,
    kind: 'private-development-build',
    source: {
      repository: manifest.source.repository,
      version: manifest.source.version,
      commit: manifest.source.commit,
      ...sourceDigests,
      dashboardAssetsSha256,
      inputSnapshot: {
        sourceSha256: preCargoInput.source.sha256,
        sourceEntryCount: preCargoInput.source.entryCount,
        packageManagerSha256: preCargoInput.packageManager.sha256,
        packageManagerEntryCount: preCargoInput.packageManager.entryCount,
        dashboardSha256: preCargoInput.dashboard.sha256,
        dashboardEntryCount: preCargoInput.dashboard.entryCount,
        cargoRegistrySha256: preCargoInput.cargoRegistry.sha256,
        cargoRegistryEntryCount: preCargoInput.cargoRegistry.entryCount,
        preCargoSha256: preCargoInput.sha256,
        generatedDirectories: preCargoInput.generatedDirectories
      }
    },
    build: {
      target,
      profile: manifest.inputs.cargoBuild.profile,
      ...toolchain,
      recipe,
      inputManifest: {
        file: 'agent-browser-private-build-inputs.json',
        sha256: inputManifestSha256,
        snapshotSha256: preCargoInput.sha256
      }
    },
    artifact: { name: 'agent-browser-linux-x64', sha256: artifactSha256 },
    distributionGate,
    claims: {
      sourceReconstruction: 'verified',
      buildInputCoverage: 'source-package-manager-dashboard-cargo-registry',
      cargoRegistrySnapshot: 'verified-before-and-after-cargo',
      binaryDeterminism: 'not-claimed',
      distributionEligibility: 'blocked',
      externalReadOnlySourceProtection: 'not-verified',
      externalReadOnlyToolchainProtection: 'not-verified',
      sameUidRaceProtection: 'not-provided-by-hashing',
      productionTrust: 'blocked'
    }
  }
}
