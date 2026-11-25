import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertDashboardAssets } from './agent-browser-owned-dashboard-gate.mjs'
import { normalizeGeneratedDashboardModes } from './agent-browser-owned-dashboard-modes.mjs'
import { buildEnvironment, copyBuildCaches } from './agent-browser-owned-build-environment.mjs'
import {
  assertDistributionGateBlocked,
  manifest,
  resolveInputDirectory,
  resolveTreeFile,
  sha256,
  sha256File,
  sourceDigestRecord,
  verifyTreePins
} from './agent-browser-owned-source-integrity.mjs'
import {
  assertGeneratedInputsUnchanged,
  assertPreCargoInputSnapshotUnchanged,
  assertSourceInputSnapshotUnchanged,
  captureGeneratedInputs,
  createPreCargoInputSnapshot,
  createSourceInputSnapshot
} from './agent-browser-owned-source-inputs.mjs'
import { runChecked } from './agent-browser-owned-process.mjs'
import { captureTreeSnapshot } from './agent-browser-owned-source-tree-snapshot.mjs'
import {
  assertRecipeFilesUnchanged,
  captureRecipeFiles,
  createBuildRecipe,
  createPrivateBuildReceipt
} from './agent-browser-owned-source-recipe.mjs'
import {
  assertWorkspaceBoundary,
  captureWorkspaceBoundary,
  prepareSource
} from './agent-browser-owned-source-prepare.mjs'
import {
  assertToolchainIdentitiesUnchanged,
  assertSupportedTarget,
  captureToolchainIdentities,
  resolveBuildTools,
  verifyToolchain
} from './agent-browser-owned-toolchain.mjs'
import { fail } from './agent-browser-owned-source-files.mjs'
import { requiredOption } from './agent-browser-owned-source-options.mjs'

function assertToolchainIdentityMapMatches(expected, actual) {
  for (const [name, identity] of Object.entries(expected)) {
    if (JSON.stringify(actual[name]) !== JSON.stringify(identity)) {
      fail(`Toolchain identity changed between phases: ${name}`)
    }
  }
}

export async function buildPrivate(options, dependencies = {}) {
  assertDistributionGateBlocked()
  const referencePath = requiredOption(options, '--reference')
  const target = assertSupportedTarget(requiredOption(options, '--target'))
  const rustcVersion = requiredOption(options, '--rustc-version')
  const cargoVersion = requiredOption(options, '--cargo-version')
  const cargoRegistry = resolveInputDirectory(
    requiredOption(options, '--cargo-registry'),
    'Cargo registry cache'
  )
  const pnpmStore = resolveInputDirectory(requiredOption(options, '--pnpm-store'), 'pnpm store')
  const policyCache = options.get('--pnpm-policy-cache')
  const tools = resolveBuildTools(options)
  const recipeFiles = captureRecipeFiles()
  const initialToolchainIdentities = captureToolchainIdentities(tools)
  const prepare = dependencies.prepareSource ?? prepareSource
  const recordSourceDigests = dependencies.sourceDigestRecord ?? sourceDigestRecord
  const verifyPinnedSource = dependencies.verifyTreePins ?? verifyTreePins
  const prepared = await prepare({
    referencePath,
    workspaceParent: options.get('--workspace-parent'),
    cachePaths: [cargoRegistry, pnpmStore, ...(policyCache ? [policyCache] : [])]
  })

  try {
    assertRecipeFilesUnchanged(recipeFiles)
    assertToolchainIdentitiesUnchanged(initialToolchainIdentities)
    const sourceSnapshot =
      prepared.sourceInputSnapshot ?? createSourceInputSnapshot(prepared.sourceDirectory)
    assertSourceInputSnapshotUnchanged(prepared.sourceDirectory, sourceSnapshot)
    const sourceDigests = recordSourceDigests(prepared.sourceDirectory)
    const environment = buildEnvironment(prepared.workspace, tools)
    const workspaceBoundary =
      prepared.workspaceBoundary ?? captureWorkspaceBoundary(prepared.workspace)
    assertToolchainIdentitiesUnchanged(initialToolchainIdentities)
    const verifiedToolchain = verifyToolchain(
      {
        cwd: prepared.workspace,
        rustcVersion,
        cargoVersion
      },
      environment
    )
    assertToolchainIdentityMapMatches(
      initialToolchainIdentities,
      verifiedToolchain.executableIdentities
    )
    verifyPinnedSource(prepared.sourceDirectory)
    assertSourceInputSnapshotUnchanged(prepared.sourceDirectory, sourceSnapshot)
    const toolchain = {
      ...verifiedToolchain,
      executableIdentities: {
        ...verifiedToolchain.executableIdentities,
        ...Object.fromEntries(
          Object.entries(environment.wrapperIdentities).map(([name, identity]) => [
            `PATH:${name}`,
            identity
          ])
        )
      }
    }
    assertWorkspaceBoundary(workspaceBoundary)
    assertToolchainIdentitiesUnchanged(toolchain.executableIdentities)
    assertRecipeFilesUnchanged(recipeFiles)
    assertSourceInputSnapshotUnchanged(prepared.sourceDirectory, sourceSnapshot)
    copyBuildCaches(environment, cargoRegistry, pnpmStore, policyCache)
    assertWorkspaceBoundary(workspaceBoundary)
    assertToolchainIdentitiesUnchanged(toolchain.executableIdentities)
    assertRecipeFilesUnchanged(recipeFiles)
    assertSourceInputSnapshotUnchanged(prepared.sourceDirectory, sourceSnapshot)
    const privatePnpmStore = environment.paths.privatePnpmStore
    const pnpmInstallArguments = [
      ...manifest.recipe.commands.pnpmInstall,
      '--store-dir',
      privatePnpmStore
    ]
    const dashboardBuildArguments = [...manifest.recipe.commands.dashboardBuild]
    const cargoBuildArguments = [...manifest.inputs.cargoBuild.arguments]
    const policySeed = policyCache
      ? captureTreeSnapshot(join(environment.paths.xdgCache, 'pnpm'), {
          label: 'Pnpm policy cache seed'
        })
      : null
    const recipe = createBuildRecipe(
      {
        ...recipeFiles,
        pnpmPolicyCacheSeed: policySeed
          ? { sha256: policySeed.sha256, entryCount: policySeed.entryCount }
          : null
      },
      {
        pnpmInstall: { executable: environment.tools.pnpm, arguments: pnpmInstallArguments },
        dashboardBuild: { executable: environment.tools.pnpm, arguments: dashboardBuildArguments },
        cargoBuild: { executable: environment.tools.cargo, arguments: cargoBuildArguments }
      }
    )
    const assertPhaseBoundary = () => {
      assertWorkspaceBoundary(workspaceBoundary)
      assertToolchainIdentitiesUnchanged(toolchain.executableIdentities)
      assertRecipeFilesUnchanged(recipeFiles)
    }
    const runBuildPhase = (executable, arguments_, verifyInputs) => {
      assertPhaseBoundary()
      try {
        runChecked(executable, arguments_, {
          cwd: prepared.sourceDirectory,
          env: environment.env,
          inherit: true
        })
      } catch (error) {
        assertPhaseBoundary()
        verifyInputs()
        throw error
      }
      assertPhaseBoundary()
      verifyInputs()
    }

    runBuildPhase(environment.tools.pnpm, pnpmInstallArguments, () => {
      verifyPinnedSource(prepared.sourceDirectory)
      assertSourceInputSnapshotUnchanged(prepared.sourceDirectory, sourceSnapshot)
    })
    const installedDependencies = captureGeneratedInputs(
      prepared.sourceDirectory,
      sourceSnapshot.generatedDirectories.packageManager
    )

    runBuildPhase(environment.tools.pnpm, dashboardBuildArguments, () => {
      verifyPinnedSource(prepared.sourceDirectory)
      assertSourceInputSnapshotUnchanged(prepared.sourceDirectory, sourceSnapshot)
      assertGeneratedInputsUnchanged(
        prepared.sourceDirectory,
        sourceSnapshot.generatedDirectories.packageManager,
        installedDependencies
      )
    })
    normalizeGeneratedDashboardModes(prepared.sourceDirectory)
    const dashboardAssetsSha256 = assertDashboardAssets(prepared.sourceDirectory)
    const privateCargoRegistry = join(environment.paths.cargoHome, 'registry')
    const preCargoInput = createPreCargoInputSnapshot(
      prepared.sourceDirectory,
      sourceSnapshot,
      installedDependencies,
      privateCargoRegistry
    )
    assertPreCargoInputSnapshotUnchanged(
      prepared.sourceDirectory,
      preCargoInput,
      privateCargoRegistry
    )
    const inputManifestBytes = Buffer.from(`${JSON.stringify(preCargoInput, null, 2)}\n`)
    const inputManifestSha256 = sha256(inputManifestBytes)
    const artifactDirectory = join(prepared.workspace, 'output')
    mkdirSync(artifactDirectory, { mode: 0o700 })
    const inputManifestPath = join(artifactDirectory, 'agent-browser-private-build-inputs.json')
    writeFileSync(inputManifestPath, inputManifestBytes, { flag: 'wx', mode: 0o600 })
    if (sha256File(inputManifestPath) !== inputManifestSha256) {
      fail('Private pre-Cargo input manifest changed while it was recorded.')
    }

    runBuildPhase(environment.tools.cargo, cargoBuildArguments, () => {
      verifyPinnedSource(prepared.sourceDirectory)
      assertPreCargoInputSnapshotUnchanged(
        prepared.sourceDirectory,
        preCargoInput,
        privateCargoRegistry
      )
    })

    const binaryPath = resolveTreeFile(
      environment.paths.cargoTarget,
      `${target}/release/agent-browser`,
      'Cargo output binary'
    )
    const artifactPath = join(artifactDirectory, 'agent-browser-linux-x64')
    copyFileSync(binaryPath, artifactPath)
    chmodSync(artifactPath, 0o700)
    assertPhaseBoundary()
    assertPreCargoInputSnapshotUnchanged(
      prepared.sourceDirectory,
      preCargoInput,
      privateCargoRegistry
    )
    const recordedInputManifestSha256 = sha256File(inputManifestPath)
    if (recordedInputManifestSha256 !== inputManifestSha256) {
      fail('Private pre-Cargo input manifest changed after it was written.')
    }
    const receipt = createPrivateBuildReceipt({
      sourceDigests,
      dashboardAssetsSha256,
      target,
      toolchain,
      artifactSha256: sha256File(artifactPath),
      recipe,
      inputManifestSha256: recordedInputManifestSha256,
      preCargoInput
    })
    writeFileSync(
      join(artifactDirectory, 'agent-browser-private-build.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 }
    )
    console.log(JSON.stringify({ workspace: prepared.workspace, artifactPath, receipt }, null, 2))
  } catch (error) {
    error.message += `\nPrivate workspace retained at ${prepared.workspace}`
    throw error
  }
}
