import { availableParallelism } from 'node:os'
import { createRequire } from 'node:module'
import { lstatSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProcess } from '@orca/process-host'
import { describeProcessFailure } from '../tool-invocation/process-failure-message.mjs'
import { isDirectInvocation } from '../tool-invocation/script-entry-detection.mjs'
import { supportsTsrs } from '../typecheck/project-execution/tsrs-typecheck-compiler.mjs'
import {
  resolveProjectCompiler,
  resolveTypecheckBunExecutable,
  runTypecheckProjects,
  selectTypecheckCompiler
} from '../typecheck/project-execution/run-typecheck-projects-in-parallel.mjs'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CONFIG = 'config/tsconfig.build.cli.json'

/**
 * The CLI compiler emits the complete src/cli and src/shared graphs into these two directories.
 * Unlike Vite, TypeScript does not remove output for sources deleted since the previous build.
 * Keep old app-plugin modules and their now-broken imports out of packaged applications by
 * retiring only these two known generated trees before each successful compile attempt.
 */
export function clearPreviousCliEmission(root = ROOT, outDir = 'out') {
  const output = resolve(root, outDir)
  if (outDir !== 'out' || output !== resolve(root, 'out')) {
    throw new Error('Refusing to clean CLI emissions outside the repository out directory')
  }
  const generatedRoot = lstatSync(output, { throwIfNoEntry: false })
  if (!generatedRoot) return
  if (!generatedRoot.isDirectory() || generatedRoot.isSymbolicLink()) {
    throw new Error('Refusing to clean symlinked or non-directory CLI output root')
  }

  const directories = ['cli', 'shared'].map((name) => join(output, name))
  // Preflight both roots before deleting either: never follow a redirected output directory.
  for (const directory of directories) {
    const stat = lstatSync(directory, { throwIfNoEntry: false })
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(`Refusing to clean symlinked or non-directory CLI output: ${directory}`)
    }
  }
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true })
  }
}

export async function buildCli({
  root = ROOT,
  outDir = 'out',
  check = runTypecheckProjects,
  execute = runProcess,
  compiler = process.env.ORCA_CLI_BUILD_COMPILER ?? 'bun',
  resolveBunExecutable = resolveTypecheckBunExecutable
} = {}) {
  if (compiler !== 'bun' && compiler !== 'tsrs') {
    throw new Error(`Invalid ORCA_CLI_BUILD_COMPILER: ${compiler}`)
  }
  const emitArguments = [
    '-p',
    CONFIG,
    '--outDir',
    outDir,
    '--composite',
    'false',
    '--incremental',
    'false'
  ]
  if (compiler === 'tsrs') {
    const manifest = createRequire(join(root, 'package.json')).resolve('tsrs/package.json')
    clearPreviousCliEmission(root, outDir)
    const result = await execute({
      program: process.execPath,
      args: [join(dirname(manifest), 'bin', 'tsrs'), ...emitArguments, '--noEmitOnError'],
      cwd: root,
      stdio: 'inherit',
      timeoutMs: null
    })
    if (result.code !== 0) {
      throw new Error(`CLI compilation failed: ${describeProcessFailure(result)}`)
    }
    return
  }
  const selection = selectTypecheckCompiler('bun', {
    root,
    resolveBunExecutable,
    fallbackHint: supportsTsrs() ? 'set ORCA_CLI_BUILD_COMPILER=tsrs' : null
  })
  const failures = await check({
    ...selection,
    root,
    projects: [{ config: CONFIG, heapGib: 2 }],
    bunThreads: availableParallelism()
  })
  if (failures.length > 0) {
    throw failures[0]
  }

  // Bun has checked this exact project; retain TypeScript's emitter without checking it twice.
  clearPreviousCliEmission(root, outDir)
  const result = await execute({
    program: process.execPath,
    args: [resolveProjectCompiler(CONFIG, root), ...emitArguments, '--noCheck'],
    cwd: root,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    throw new Error(`CLI emission failed: ${describeProcessFailure(result)}`)
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  try {
    await buildCli()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
