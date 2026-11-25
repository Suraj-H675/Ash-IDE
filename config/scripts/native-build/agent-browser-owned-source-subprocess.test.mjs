import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { manifest } from './agent-browser-owned-source-manifest.mjs'
import { prepareSource } from './agent-browser-owned-source-prepare.mjs'
import {
  withTempDirectory,
  writeDashboardFixture
} from './test-fixtures/agent-browser-owned-source.mjs'

const subprocessProbe = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
  encoding: 'utf8',
  shell: false
})
const subprocessAvailable = !subprocessProbe.error

test(
  'the real preparation subprocess rejects a directory that is not a Git checkout',
  {
    skip: !subprocessAvailable
      ? 'nested process creation is blocked by the current sandbox'
      : process.platform !== 'linux'
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-browser-prepare-host-test-'))
    try {
      const reference = join(root, 'reference')
      const parent = join(root, 'output')
      mkdirSync(reference, { mode: 0o700 })
      mkdirSync(parent, { mode: 0o700 })
      await assert.rejects(
        prepareSource({ referencePath: reference, workspaceParent: parent }),
        /git rev-parse --show-toplevel failed/
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 })
  chmodSync(path, 0o700)
}

function createBuildFixture(root, { mutateSourceDuringInstall = false } = {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const source = join(root, 'source')
  const workspace = join(root, 'workspace')
  const reference = join(root, 'reference')
  const cargoRegistry = join(root, 'cargo-registry')
  const pnpmStore = join(root, 'pnpm-store')
  const toolsDirectory = join(root, 'tools')
  const targetLibdir = join(root, 'target-libdir')
  const dashboardStage = join(root, 'dashboard-stage')
  const dashboard = manifest.inputs.dashboard
  for (const directory of [
    source,
    workspace,
    reference,
    cargoRegistry,
    pnpmStore,
    toolsDirectory,
    targetLibdir
  ]) {
    mkdirSync(directory, { mode: 0o700 })
    chmodSync(directory, 0o700)
  }
  mkdirSync(join(source, dashboard.packagePath), { recursive: true, mode: 0o700 })
  writeFileSync(join(source, 'package.json'), '{"name":"fixture","packageManager":"pnpm@11.1.3"}\n')
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'importers:\n  .: {}\n  packages/dashboard: {}\n')
  writeFileSync(join(source, 'README.md'), 'source fixture\n')
  writeFileSync(join(source, dashboard.packagePath, 'package.json'), '{"name":"dashboard"}\n')
  writeDashboardFixture(dashboardStage)
  cpSync(
    join(dashboardStage, dashboard.packagePath, 'public'),
    join(source, dashboard.packagePath, 'public'),
    { recursive: true }
  )
  mkdirSync(join(source, dashboard.font.path, '..'), { recursive: true })
  cpSync(join(dashboardStage, dashboard.font.path), join(source, dashboard.font.path))
  const cargoMarker = join(root, 'cargo-invoked')
  const tools = Object.fromEntries(
    ['pnpm', 'rustc', 'cargo', 'rustdoc'].map((name) => [name, join(toolsDirectory, name)])
  )
  const pnpmScript = `#!/bin/sh
set -eu
if [ "$1" = "--version" ]; then printf "11.1.3\\n"; exit 0; fi
if [ "$1" = "install" ]; then
  /bin/mkdir -p node_modules packages/dashboard/node_modules
  printf "dependency\\n" > node_modules/fixture.js
  printf "dashboard dependency\\n" > packages/dashboard/node_modules/fixture.js
${mutateSourceDuringInstall ? '  printf "mutated\\n" >> README.md\n' : ''}  exit 0
fi
if [ "$1" = "--filter" ] && [ "$2" = "dashboard" ]; then
  /bin/cp -R ${shellQuote(join(dashboardStage, dashboard.outputPath))} ${shellQuote(join(source, dashboard.outputPath))}
  exit 0
fi
printf "unexpected pnpm command\\n" >&2
exit 2
`
  writeExecutable(tools.pnpm, pnpmScript)

  const rustVersion = (name) => `#!/bin/sh
set -eu
if [ "$1" = "--version" ] && [ "$2" = "--verbose" ]; then
  printf '${name} 1.86.0 (fixture)\\nrelease: 1.86.0\\nhost: ${manifest.inputs.cargoBuild.target}\\ncommit-hash: fixture\\n'
  exit 0
fi
${name === 'rustc' ? `if [ "$1" = "--print" ] && [ "$2" = "target-libdir" ]; then printf '%s\\n' ${shellQuote(targetLibdir)}; exit 0; fi\n` : ''}exit 2
`
  writeExecutable(tools.rustc, rustVersion('rustc'))
  writeExecutable(tools.rustdoc, rustVersion('rustdoc'))
  writeExecutable(
    tools.cargo,
    `#!/bin/sh
set -eu
if [ "$1" = "--version" ] && [ "$2" = "--verbose" ]; then
  printf 'cargo 1.86.0 (fixture)\\nrelease: 1.86.0\\nhost: ${manifest.inputs.cargoBuild.target}\\ncommit-hash: fixture\\n'
  exit 0
fi
if [ "$1" = "build" ]; then printf invoked > ${shellQuote(cargoMarker)}; /bin/mkdir -p "$CARGO_TARGET_DIR/${manifest.inputs.cargoBuild.target}/release"; printf 'fixture binary\\n' > "$CARGO_TARGET_DIR/${manifest.inputs.cargoBuild.target}/release/agent-browser"; exit 0; fi
exit 2
`
  )

  const runner = join(root, 'run-build.mjs')
  const sourceModuleUrl = new URL('./agent-browser-owned-source.mjs', import.meta.url).href
  writeFileSync(
    runner,
    `import { buildPrivate } from ${JSON.stringify(sourceModuleUrl)}
import { createSourceInputSnapshot } from ${JSON.stringify(new URL('./agent-browser-owned-source-integrity.mjs', import.meta.url).href)}
import { captureWorkspaceBoundary } from ${JSON.stringify(new URL('./agent-browser-owned-source-prepare.mjs', import.meta.url).href)}
const source = ${JSON.stringify(source)}
const workspace = ${JSON.stringify(workspace)}
const options = new Map(Object.entries({ '--reference': ${JSON.stringify(reference)}, '--target': ${JSON.stringify(manifest.inputs.cargoBuild.target)}, '--rustc-version': '1.86.0', '--cargo-version': '1.86.0', '--rustc-executable': ${JSON.stringify(tools.rustc)}, '--cargo-executable': ${JSON.stringify(tools.cargo)}, '--rustdoc-executable': ${JSON.stringify(tools.rustdoc)}, '--pnpm-executable': ${JSON.stringify(tools.pnpm)}, '--cargo-registry': ${JSON.stringify(cargoRegistry)}, '--pnpm-store': ${JSON.stringify(pnpmStore)} }))
await buildPrivate(options, { prepareSource: async () => ({ workspace, sourceDirectory: source, workspaceBoundary: captureWorkspaceBoundary(workspace), sourceInputSnapshot: createSourceInputSnapshot(source) }), sourceDigestRecord: () => ({ reconstructedTreeSha256: 'fixture' }), verifyTreePins: () => {} })`
  )
  return { runner, source, cargoMarker }
}

test(
  'the build orchestrator gates Cargo on its source snapshot using disposable subprocess tools',
  {
    skip: !subprocessAvailable
      ? 'nested process creation is blocked by the current sandbox'
      : undefined
  },
  () => {
    withTempDirectory((root) => {
      const clean = createBuildFixture(join(root, 'clean'))
      const cleanRun = spawnSync(process.execPath, [clean.runner], {
        encoding: 'utf8',
        shell: false,
        timeout: 120000
      })
      assert.equal(cleanRun.error, undefined, cleanRun.error?.message)
      assert.equal(cleanRun.status, 0, cleanRun.stderr)
      assert.equal(readFileSync(clean.cargoMarker, 'utf8'), 'invoked')

      const changed = createBuildFixture(join(root, 'changed'), { mutateSourceDuringInstall: true })
      const changedRun = spawnSync(process.execPath, [changed.runner], {
        encoding: 'utf8',
        shell: false,
        timeout: 120000
      })
      assert.equal(changedRun.error, undefined, changedRun.error?.message)
      assert.notEqual(changedRun.status, 0)
      assert.match(changedRun.stderr, /source input tree changed/)
      assert.equal(existsSync(changed.cargoMarker), false)
    })
  }
)
