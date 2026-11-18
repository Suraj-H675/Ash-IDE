import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  findRunnerDrift,
  findUncollectedTestFiles,
  readFoundationCollection
} from './check-test-file-runners.mjs'

describe('test runner audit', () => {
  it('follows a runtime re-export and flags fixtures without a collected caller', () => {
    const registrar = `import { it } from 'vitest'
export function register() {
  it('checks behavior', () => {})
}`
    const sources = new Map([
      ['src/selected.test.ts', `import { register } from './barrel'; register()`],
      ['src/barrel.ts', `export { register } from './registered.test-fixture'`],
      ['src/registered.test-fixture.ts', registrar],
      ['src/unselected.test-fixture.ts', registrar],
      ['src/unselected.spec.ts', registrar],
      ['src/unselected.ts', `import type { register } from './unselected.test-fixture'`]
    ])
    const selected = new Set(['src/selected.test.ts'])

    expect(findUncollectedTestFiles(sources, selected)).toEqual([
      'src/unselected.test-fixture.ts',
      'src/unselected.spec.ts'
    ])

    sources.set('src/barrel.ts', `export type { register } from './registered.test-fixture'`)
    expect(findUncollectedTestFiles(sources, selected)).toContain('src/registered.test-fixture.ts')
  })

  it('credits foundation only for direct Node execution and valid Vitest selectors', () => {
    const nodeFile = 'config/scripts/permissions.test.cjs'
    const unitFile = 'src/selected.test.ts'
    const excluded = 'src/manual.test.ts'
    const sources = new Map([
      [nodeFile, ''],
      [unitFile, ''],
      [excluded, '']
    ])
    const unit = new Set([unitFile, excluded])
    const balanced = new Set([unitFile])
    const listUnitFiles = (_script, usesBalancedConfig) => (usesBalancedConfig ? balanced : unit)
    const workflow = `jobs:
  foundation:
    steps:
      - run: node ${nodeFile}
      - run: |
          node node_modules/vitest/vitest.mjs run \\
            --config config/vitest.config.ts --pool=forks --maxWorkers=1 \\
            ${unitFile}
      - env:
          ORCA_BALANCE_UNIT_SHARDS: '1'
        run: node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts ${excluded}
      - run: node --check config/scripts/syntax-only.test.cjs
      - run: echo node config/scripts/echoed.test.cjs
      - if: false
        run: node config/scripts/disabled.test.cjs
      - run: |
          if false; then
            node config/scripts/skipped-by-shell.test.cjs
          fi
`

    const result = readFoundationCollection(workflow, listUnitFiles, sources)
    expect([...result.entries]).toEqual([nodeFile, unitFile])
    expect(result.problems).toContain(
      `Foundation Vitest selector does not select a test: ${excluded}`
    )

    const syntaxOnly = workflow.replace(`node ${nodeFile}`, `node --check ${nodeFile}`)
    const { entries } = readFoundationCollection(syntaxOnly, listUnitFiles, sources)
    expect(findUncollectedTestFiles(sources, new Set([...unit, ...entries]))).toEqual([nodeFile])
  })

  it('reports a missing config and a renamed foundation selector', () => {
    const config = 'config/vitest.agent-status-benchmark.config.ts'
    expect(findRunnerDrift([config], () => null)).toEqual([`${config} is missing`])
    const workflow = `jobs:
  foundation:
    steps:
      - run: node config/scripts/removed.test.cjs
      - run: node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/removed.test.ts
`
    const { entries, problems } = readFoundationCollection(workflow, () => new Set(), new Map())
    expect(entries.size).toBe(0)
    expect(problems).toEqual(
      expect.arrayContaining([
        'Foundation Node test is missing: config/scripts/removed.test.cjs',
        'Foundation Vitest selector does not select a test: src/removed.test.ts'
      ])
    )
  })
})

describe('foundation hosted test coverage', () => {
  const workflowSource = readFileSync(
    new URL('../../../../.github/workflows/foundation.yml', import.meta.url),
    'utf8'
  )
  const files = new Set(workflowSource.match(/[\w./-]+\.(?:test|spec|e2e|bench)\.[cm]?[jt]sx?\b/g))
  const sources = new Map([...files].map((file) => [file, '']))
  const auditStep = 'Test the runner audit diagnostics'
  const auditGate = 'Verify runnable test collection'
  const auditFile = 'config/scripts/ci/unit-selection/ash-test-runner-audit.test.mjs'
  const nodeFile =
    'config/scripts/desktop-distribution/linux/linux-package-file-permissions.test.cjs'

  it('collects the checked-in workflow’s direct Vitest and Node test commands', () => {
    const { entries, problems } = readFoundationCollection(workflowSource, () => files, sources)

    expect(problems).toEqual([])
    expect(entries.has(auditFile)).toBe(true)
    expect(entries.has(nodeFile)).toBe(true)
  })

  it.each([
    ['echo no tests run', 'Foundation selects no hosted tests'],
    ['pnpm exec vitest run src/missing.test.ts', 'Unsupported foundation test step']
  ])('rejects a workflow with only %s', (command, diagnostic) => {
    const workflow = stringify({
      jobs: { foundation: { steps: [{ name: 'Replaced coverage', run: command }] } }
    })
    const { entries, problems } = readFoundationCollection(workflow, () => files, sources)

    expect(entries.size).toBe(0)
    expect(problems).toContain('Foundation selects no hosted tests')
    expect(problems.some((problem) => problem.includes(diagnostic))).toBe(true)
  })

  it('reports a removed mandatory test group while other foundation tests remain', () => {
    const workflow = parse(workflowSource)
    const job = workflow.jobs.foundation
    job.steps = job.steps.filter(({ name }) => name !== auditStep)

    const { entries, problems } = readFoundationCollection(
      stringify(workflow),
      () => files,
      sources
    )
    expect(entries.has(nodeFile)).toBe(true)
    expect(entries.has(auditFile)).toBe(false)
    expect(problems).toContain(`Missing required foundation test step: ${auditStep}`)
  })

  it.each([
    ['removed', (steps) => steps.filter(({ name }) => name !== auditGate), 'Missing or duplicated'],
    [
      'silenced',
      (steps) =>
        steps.map((step) =>
          step.name === auditGate
            ? { ...step, run: 'pnpm run check:test-file-runners || true' }
            : step
        ),
      'Disabled or unsupported'
    ],
    [
      'made failure-tolerant',
      (steps) =>
        steps.map((step) =>
          step.name === auditGate ? { ...step, 'continue-on-error': true } : step
        ),
      'Disabled or unsupported'
    ]
  ])('rejects a %s CI audit gate', (_scenario, transform, diagnostic) => {
    const workflow = parse(workflowSource)
    workflow.jobs.foundation.steps = transform(workflow.jobs.foundation.steps)
    const { problems } = readFoundationCollection(stringify(workflow), () => files, sources)
    expect(problems).toContain(`${diagnostic} foundation audit gate: ${auditGate}`)
  })

  it.each([
    ['a pnpm Vitest wrapper', () => ({ run: `pnpm exec vitest run ${auditFile}` }), 'Unsupported'],
    ['a shell condition', (run) => ({ run: `if false; then\n${run}fi\n` }), 'Unsupported'],
    ['no test invocation', () => ({ run: 'node --version' }), 'Unsupported'],
    ['a step condition', () => ({ if: false }), 'Conditional']
  ])('reports drift when a mandatory group uses %s', (_scenario, change, reason) => {
    const workflow = parse(workflowSource)
    const step = workflow.jobs.foundation.steps.find(({ name }) => name === auditStep)
    Object.assign(step, change(step.run))

    const { entries, problems } = readFoundationCollection(
      stringify(workflow),
      () => files,
      sources
    )
    expect(entries.has(nodeFile)).toBe(true)
    expect(entries.has(auditFile)).toBe(false)
    expect(problems).toContain(`${reason} foundation test step: ${auditStep}`)
  })

  it('does not credit tests when the foundation job is conditional', () => {
    const workflow = parse(workflowSource)
    workflow.jobs.foundation.if = false

    const { entries, problems } = readFoundationCollection(
      stringify(workflow),
      () => files,
      sources
    )
    expect(entries.size).toBe(0)
    expect(problems).toContain(
      'Conditional or failure-tolerant foundation job cannot guarantee hosted tests'
    )
  })

  it('rejects a mandatory test group with continue-on-error enabled', () => {
    const workflow = parse(workflowSource)
    workflow.jobs.foundation.steps.find(({ name }) => name === auditStep)['continue-on-error'] =
      true
    const { problems } = readFoundationCollection(stringify(workflow), () => files, sources)
    expect(problems).toContain(`Conditional foundation test step: ${auditStep}`)
  })
})
