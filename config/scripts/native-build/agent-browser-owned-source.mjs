import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  fail,
  sourceDigestRecord,
  verifyPatchArtifact
} from './agent-browser-owned-source-integrity.mjs'
import { manifest } from './agent-browser-owned-source-manifest.mjs'
import { buildPrivate } from './agent-browser-owned-source-build.mjs'
import {
  assertKnownOptions,
  parseOptions,
  requiredOption
} from './agent-browser-owned-source-options.mjs'
import { prepareSource } from './agent-browser-owned-source-prepare.mjs'

function usage() {
  return [
    'Usage:',
    '  node config/scripts/native-build/agent-browser-owned-source.mjs prepare --reference <clean-v0.39.4-checkout> [--workspace-parent <private-temp-parent>]',
    '  node config/scripts/native-build/agent-browser-owned-source.mjs build --reference <clean-v0.39.4-checkout> --target x86_64-unknown-linux-gnu --rustc-version <exact-version> --cargo-version <exact-version> --rustc-executable <absolute-path> --cargo-executable <absolute-path> --rustdoc-executable <absolute-path> --pnpm-executable <absolute-path> --cargo-registry <read-only-cache> --pnpm-store <read-only-store> [--pnpm-policy-cache <private-verified-policy-cache>] [--workspace-parent <private-temp-parent>]',
    '',
    'Build uses package-manager offline flags and private cache copies. It does not provide OS network isolation or install the binary.'
  ].join('\n')
}

async function main(args) {
  const [command, ...rest] = args
  if (command === '--help' || command === '-h') {
    console.log(usage())
    return
  }
  const options = parseOptions(rest)
  if (command === 'prepare') {
    assertKnownOptions(options, ['--reference', '--workspace-parent'])
    verifyPatchArtifact()
    const prepared = await prepareSource({
      referencePath: requiredOption(options, '--reference'),
      workspaceParent: options.get('--workspace-parent')
    })
    const receipt = {
      kind: 'source-reconstruction',
      sourceCommit: manifest.source.commit,
      sourceDigests: sourceDigestRecord(prepared.sourceDirectory),
      sourceDirectory: prepared.sourceDirectory,
      workspace: prepared.workspace,
      patchedFiles: manifest.patch.files.map((entry) => entry.path)
    }
    console.log(JSON.stringify(receipt, null, 2))
    return
  }
  if (command === 'build') {
    assertKnownOptions(options, [
      '--reference',
      '--target',
      '--rustc-version',
      '--cargo-version',
      '--rustc-executable',
      '--cargo-executable',
      '--rustdoc-executable',
      '--pnpm-executable',
      '--cargo-registry',
      '--pnpm-store',
      '--pnpm-policy-cache',
      '--workspace-parent'
    ])
    await buildPrivate(options)
    return
  }
  fail(`Unknown command ${command || '<missing>'}.\n${usage()}`)
}

export { buildPrivate } from './agent-browser-owned-source-build.mjs'
export { createPrivateBuildReceipt } from './agent-browser-owned-source-recipe.mjs'
export {
  assertSupportedTarget,
  assertToolchainIdentity,
  resolveBuildTools
} from './agent-browser-owned-toolchain.mjs'
export { assertDashboardAssets } from './agent-browser-owned-dashboard-gate.mjs'
export {
  assertCleanReferenceStatus,
  assertPinnedRevision,
  verifyPatchArtifact
} from './agent-browser-owned-source-integrity.mjs'
export { copyBuildCaches, copyCacheTree } from './agent-browser-owned-build-environment.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  })
}
