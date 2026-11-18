#!/usr/bin/env node
// Static gate: a checked-in test file that no runner collects passes vacuously, so every one must be collected.

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript-api'
import { parse } from 'yaml'

const exec = promisify(execFile)
const FOUNDATION = '.github/workflows/foundation.yml'
const VITEST = 'node_modules/vitest/vitest.mjs'
const VITEST_WRAPPER = 'config/scripts/test-runtime/execution-policy/run-vitest.mjs'
const UNIT_CONFIG = 'config/vitest.config.ts'
const BENCHMARK_CONFIG = 'config/vitest.agent-status-benchmark.config.ts'

export const TEST_RUNNERS = [
  { script: VITEST, config: UNIT_CONFIG },
  { script: VITEST_WRAPPER, config: UNIT_CONFIG },
  { script: VITEST, config: BENCHMARK_CONFIG }
]

const TEST_FILE_NAME = /\.(?:test|spec|e2e|bench)\.[cm]?[jt]sx?$/

const CODE_FILE = /\.[cm]?[jt]sx?$/
const TEST_FRAMEWORK_IMPORT = /\bfrom\s+['"](?:vitest|node:test|@playwright\/test|bun:test)['"]/
const TEST_REGISTRATION =
  /^\s*(?:describe|it|test|suite|bench)(?:\.\w+)*(?:\([^)]*\))?\s*\(\s*[`'"]/m

export function isTestLike(file, source) {
  return (
    TEST_FILE_NAME.test(file) ||
    (TEST_FRAMEWORK_IMPORT.test(source) && TEST_REGISTRATION.test(source))
  )
}

// Keep the required groups in sync with foundation.yml. The workflow owns their file selectors.
const REQUIRED_FOUNDATION_TEST_STEPS = new Set([
  'Reject group/world-writable files in Linux packages',
  'Test the runner audit diagnostics',
  'Test the persistent runtime and provider boundaries',
  'Test Claude runtime-controller native PTY routing',
  'Test retained IPC registrations',
  'Test runtime-scoped WebSocket authentication and legacy mobile rejection',
  'Test excluded renderer startup capability gates',
  'Verify Ash package inputs and standalone local CLI'
])
const FOUNDATION_AUDIT_STEP = 'Verify runnable test collection'
const FOUNDATION_AUDIT_COMMAND = 'pnpm run check:test-file-runners'
const FOUNDATION_VITEST_OPTIONS =
  /^--(?:pool=(?:forks|threads)|maxWorkers=\d+|no-file-parallelism)$/
const REPO_FILE = /^(?:[\w.-]+\/)+[\w.-]+$/
const NODE_TEST_FILE = /\.test\.[cm]?js$/
const UNSUPPORTED_TEST_COMMAND =
  /^[ \t]*(?:(?:(?:pnpm|npm|bun)\s+(?:exec\s+)?|(?:npx|bunx)\s+)?vitest|node\s+--test)(?:\s|$)/m

function* foundationCommands(source, problems) {
  const workflow = parse(source)
  const job = workflow?.jobs?.foundation
  if (!Array.isArray(job?.steps) || job.steps.length === 0) {
    throw new Error(`${FOUNDATION} has no foundation job steps`)
  }
  if (job.if !== undefined || job['continue-on-error'] !== undefined) {
    throw new Error('Conditional or failure-tolerant foundation job cannot guarantee hosted tests')
  }

  // The auditor cannot certify hosted coverage if its own CI quality gate is removed or bypassed.
  // This contract is also checked by the dedicated audit regression suite.
  const gates = job.steps.filter((step) => step.name === FOUNDATION_AUDIT_STEP)
  if (gates.length !== 1) {
    problems.push(`Missing or duplicated foundation audit gate: ${FOUNDATION_AUDIT_STEP}`)
  } else {
    const gate = gates[0]
    const cwd =
      gate['working-directory'] ??
      job.defaults?.run?.['working-directory'] ??
      workflow.defaults?.run?.['working-directory'] ??
      '.'
    const shell = gate.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell
    if (
      gate.run?.trim() !== FOUNDATION_AUDIT_COMMAND ||
      gate.if !== undefined ||
      gate['continue-on-error'] !== undefined ||
      cwd !== '.' ||
      shell !== undefined
    ) {
      problems.push(`Disabled or unsupported foundation audit gate: ${FOUNDATION_AUDIT_STEP}`)
    }
  }

  const missing = new Set(REQUIRED_FOUNDATION_TEST_STEPS)
  for (const step of job.steps) {
    const { name, run } = step
    missing.delete(name)
    const script = typeof run === 'string' ? run.replace(/\\\r?\n/g, '') : ''
    const commands = script
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/\s+/))
    const tests = commands.filter(
      ([program, entry]) =>
        program === 'node' &&
        (entry === VITEST || entry === VITEST_WRAPPER || NODE_TEST_FILE.test(entry))
    )
    const unsupported = UNSUPPORTED_TEST_COMMAND.test(script)
    if (
      tests.length === 0 &&
      !REQUIRED_FOUNDATION_TEST_STEPS.has(name) &&
      !/^Test\b/.test(name) &&
      !unsupported
    ) {
      continue
    }

    const label = name ?? 'unnamed step'
    if (step.if !== undefined || step['continue-on-error'] !== undefined) {
      problems.push(`Conditional foundation test step: ${label}`)
      continue
    }
    const cwd =
      step['working-directory'] ??
      job.defaults?.run?.['working-directory'] ??
      workflow.defaults?.run?.['working-directory'] ??
      '.'
    const shell = step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell
    // Only direct commands under the default shell can be credited without evaluating shell code.
    if (
      cwd !== '.' ||
      shell !== undefined ||
      unsupported ||
      tests.length === 0 ||
      !commands.every(
        ([program, ...args]) => program === 'node' && args.every((arg) => /^[\w./=-]+$/.test(arg))
      )
    ) {
      problems.push(`Unsupported foundation test step: ${label}`)
      continue
    }
    const balanced =
      step.env?.ORCA_BALANCE_UNIT_SHARDS ??
      job.env?.ORCA_BALANCE_UNIT_SHARDS ??
      workflow.env?.ORCA_BALANCE_UNIT_SHARDS
    for (const args of tests) {
      yield { args, balanced: String(balanced) === '1' }
    }
  }
  for (const name of missing) {
    problems.push(`Missing required foundation test step: ${name}`)
  }
}

export function readFoundationCollection(source, listUnitFiles, sources) {
  const entries = new Set()
  const problems = []
  try {
    for (const { args, balanced } of foundationCommands(source, problems)) {
      const [, entry, mode, configFlag, config, ...rest] = args
      if (entry === VITEST || entry === VITEST_WRAPPER) {
        const selectors = rest.filter((arg) => !FOUNDATION_VITEST_OPTIONS.test(arg))
        if (
          mode !== 'run' ||
          configFlag !== '--config' ||
          config !== UNIT_CONFIG ||
          selectors.length === 0 ||
          selectors.some((arg) => !REPO_FILE.test(arg) || !TEST_FILE_NAME.test(arg))
        ) {
          problems.push(`Unsupported foundation Vitest command: ${args.join(' ')}`)
          continue
        }
        const discovered = listUnitFiles(entry, balanced)
        for (const file of selectors) {
          if (!sources.has(file) || !discovered?.has(file)) {
            problems.push(`Foundation Vitest selector does not select a test: ${file}`)
          } else {
            entries.add(file)
          }
        }
      } else if (args.length !== 2 || !REPO_FILE.test(entry)) {
        problems.push(`Unsupported foundation Node test command: ${args.join(' ')}`)
      } else if (!sources.has(entry)) {
        problems.push(`Foundation Node test is missing: ${entry}`)
      } else {
        entries.add(entry)
      }
    }
  } catch (error) {
    problems.push(error.message)
  }
  if (entries.size === 0) {
    problems.push('Foundation selects no hosted tests')
  }
  return { entries, problems }
}

export function findRunnerDrift(paths, readSource) {
  return paths.filter((file) => readSource(file) === null).map((file) => `${file} is missing`)
}

// Vite's default resolve.extensions, in its order; the unit config's aliases.
const RESOLVE_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
const TS_SOURCE_TWINS = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts']
}
const IMPORT_ALIASES = [
  ['@renderer/', 'src/renderer/src/'],
  ['@/', 'src/renderer/src/']
]

// Why not ci-unit-dependency-graph: it keeps every plausible candidate, which cannot prove a run.
export function resolveRuntimeImport(importer, specifier, files) {
  const alias = IMPORT_ALIASES.find(([prefix]) => specifier.startsWith(prefix))
  const base = alias
    ? alias[1] + specifier.slice(alias[0].length)
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(importer), specifier)
      : null
  if (base === null) {
    return null
  }
  const extension = path.posix.extname(base)
  const stem = base.slice(0, base.length - extension.length)
  const candidates = [
    base,
    ...(TS_SOURCE_TWINS[extension] ?? []).map((twin) => stem + twin),
    ...RESOLVE_EXTENSIONS.map((suffix) => base + suffix),
    ...RESOLVE_EXTENSIONS.map((suffix) => `${base}/index${suffix}`)
  ]
  return candidates.find((candidate) => files.has(candidate)) ?? null
}

const TYPESCRIPT_FILE = /\.[cm]?tsx?$/
const TRANSPILE_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  jsx: ts.JsxEmit.Preserve
}

function importsOf(file, source, files) {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => resolveRuntimeImport(file, fileName, files))
    .filter((resolved) => resolved !== null)
}

// Transpile to match Vitest erasure of type-only/unused/typeof-import edges; verbatimModuleSyntax would add conservative false failures.
function runtimeImportsOf(file, source, files) {
  if (!TYPESCRIPT_FILE.test(file)) {
    return importsOf(file, source, files)
  }
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: TRANSPILE_OPTIONS,
    reportDiagnostics: false
  })
  return importsOf(file, outputText, files)
}

// A suite module (e.g. `Foo.case.spec.tsx`) is collected when a selected entry file imports it.
export function findUncollectedTestFiles(sources, selected) {
  const files = new Set(sources.keys())
  const candidates = [...files].filter(
    (file) => !selected.has(file) && isTestLike(file, sources.get(file))
  )
  // Only source edges reaching candidate tests need slower transpilation; other edges cannot collect them.
  const importers = new Map()
  for (const file of files) {
    for (const imported of importsOf(file, sources.get(file), files)) {
      importers.set(imported, (importers.get(imported) ?? new Set()).add(file))
    }
  }
  const reachesCandidate = new Set(candidates)
  for (const file of reachesCandidate) {
    for (const importer of importers.get(file) ?? []) {
      reachesCandidate.add(importer)
    }
  }
  const collected = new Set([...selected].filter((file) => reachesCandidate.has(file)))
  for (const file of collected) {
    for (const imported of runtimeImportsOf(file, sources.get(file), files)) {
      if (reachesCandidate.has(imported)) {
        collected.add(imported)
      }
    }
  }
  return candidates.filter((file) => !collected.has(file))
}

async function checkedInCodeSources(root) {
  // Include nonignored additions so the local check catches a new orphan before staging.
  const { stdout } = await exec(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    }
  )
  return new Map(
    stdout
      .split('\0')
      .filter((file) => CODE_FILE.test(file) && existsSync(path.join(root, file)))
      .map((file) => [file, readFileSync(path.join(root, file), 'utf8')])
  )
}

async function listVitestFiles(root, { script, config }, balanced) {
  // filesOnly loads the real projects and applies their filters without importing test modules.
  const directory = mkdtempSync(path.join(tmpdir(), 'ash-test-runner-audit-'))
  const output = path.join(directory, 'files.json')
  try {
    await exec(
      process.execPath,
      [script, 'list', '--config', config, '--filesOnly', `--json=${output}`],
      {
        cwd: root,
        env: {
          ...process.env,
          TMPDIR: directory,
          TEMP: directory,
          TMP: directory,
          ORCA_BALANCE_UNIT_SHARDS: balanced ? '1' : '0',
          ORCA_LOCAL_MODULE_CACHE: '0'
        },
        timeout: 30_000
      }
    )
    const files = JSON.parse(readFileSync(output, 'utf8')).map(({ file }) =>
      path.relative(root, file).split(path.sep).join('/')
    )
    if (!files.length) {
      throw new Error(`${config} selects no tests`)
    }
    return new Set(files)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function main(root) {
  const readSource = (file) => {
    const absolute = path.join(root, file)
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
  }
  const required = new Set([
    FOUNDATION,
    ...TEST_RUNNERS.flatMap(({ script, config }) => [script, config])
  ])
  const drift = findRunnerDrift([...required], readSource)
  const sources = await checkedInCodeSources(root)
  const workflow = readSource(FOUNDATION)
  const unit = new Set()
  const benchmark = new Set()
  const unitByScript = new Map()
  const balancedByScript = new Map()
  for (const runner of TEST_RUNNERS) {
    const { script, config } = runner
    if (readSource(script) === null || readSource(config) === null) {
      continue
    }
    try {
      const files = await listVitestFiles(root, runner, false)
      if (config === UNIT_CONFIG) {
        unitByScript.set(script, files)
        files.forEach((file) => unit.add(file))
        if (workflow?.includes('ORCA_BALANCE_UNIT_SHARDS')) {
          balancedByScript.set(script, await listVitestFiles(root, runner, true))
        }
      } else {
        files.forEach((file) => benchmark.add(file))
      }
    } catch (error) {
      drift.push(
        `${script} with ${config} could not list tests: ${error.stderr?.trim() || error.message}`
      )
    }
  }
  const { entries: hosted, problems } =
    workflow === null
      ? { entries: new Set(), problems: [] }
      : readFoundationCollection(
          workflow,
          (script, balanced) => (balanced ? balancedByScript : unitByScript).get(script),
          sources
        )
  drift.push(...problems)

  const selected = new Set([...unit, ...benchmark, ...hosted])
  const uncollected = findUncollectedTestFiles(sources, selected)
  for (const problem of drift) {
    console.error(`Runner list is out of date: ${problem}`)
  }
  for (const file of uncollected) {
    console.error(`No test runner collects ${file}`)
  }
  console.log(`Foundation CI selects ${hosted.size} test entry files.`)
  console.log(
    `Local Vitest selects ${[...unit].filter((file) => sources.has(file) && !hosted.has(file)).length} additional test entry files.`
  )
  for (const file of benchmark) {
    if (sources.has(file) && !hosted.has(file)) {
      console.log(`Manual benchmark: ${file}`)
    }
  }
  if (drift.length > 0 || uncollected.length > 0) {
    return 1
  }
  console.log('Every checked-in test file has a collection path.')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.cwd())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
