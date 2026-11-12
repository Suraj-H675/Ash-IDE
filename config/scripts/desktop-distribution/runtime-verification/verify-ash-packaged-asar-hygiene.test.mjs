import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createPackage } = require('@electron/asar')
const { verifyAshPackagedAsarHygiene } = require('./verify-ash-packaged-asar-hygiene.cjs')
const {
  PACKAGED_RUNTIME_PACKAGE_ROOTS,
  createPackagedRuntimeNodeModuleResources
} = require('../../../packaged-runtime-node-modules.cjs')

const fixtures = []

async function makeArchive(files) {
  const root = await mkdtemp(join(tmpdir(), 'ash-packaged-asar-hygiene-'))
  fixtures.push(root)
  const source = join(root, 'source')
  const resources = join(root, 'resources')
  await mkdir(resources, { recursive: true })
  for (const name of files) {
    const path = join(source, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'synthetic data, no real user profile\n')
  }
  await createPackage(source, join(resources, 'app.asar'))
  return resources
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

it('does not select retired Linear/telemetry SDKs in Linux or macOS runtime dependency closure', () => {
  const excluded = ['@linear/sdk', '@posthog/core', '@posthog/types', 'posthog-node']
  expect(PACKAGED_RUNTIME_PACKAGE_ROOTS).not.toEqual(
    expect.arrayContaining(['@linear/sdk', 'posthog-node'])
  )
  for (const platform of ['linux', 'darwin']) {
    const resources = createPackagedRuntimeNodeModuleResources(platform)
    const names = resources.map(({ to }) => to.replace(/^node_modules\//, ''))
    for (const packageName of excluded) {
      expect(names, platform).not.toContain(packageName)
    }
    for (const required of ['node-pty', '@orca/process-host', '@anthropic-ai/claude-agent-sdk']) {
      expect(names, platform).toContain(required)
    }
  }
})

it('allows only the reviewed runtime roots in a real ASAR archive', async () => {
  const resources = await makeArchive([
    'LICENSE',
    'package.json',
    'out/main/index.js',
    'out/renderer/index.html',
    'resources/plugins/launch.json',
    'scripts/ash-runtime-launcher.sh'
  ])
  expect(verifyAshPackagedAsarHygiene(resources)).toMatchObject({
    roots: ['LICENSE', 'out', 'package.json', 'resources', 'scripts']
  })
})

it.each([
  '.cache/private-home/provider.json',
  '.audit/private-qa-data.json',
  '.tmp/temporary-auth.json',
  '.env',
  'dist/ash-ide-linux.AppImage',
  'release/old-package.tar.gz',
  'unexpected-private-source/secrets.json'
])('refuses private checkout or unexpected root %s inside app.asar', async (path) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js', path])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    '[ash-package-hygiene] unexpected private/build roots in app.asar:'
  )
})

it('refuses a package lacking the compiled runtime entry', async () => {
  const resources = await makeArchive(['package.json', 'resources/icon.png'])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    '[ash-package-hygiene] packaged runtime entry roots are incomplete'
  )
})

it.each(['@linear/sdk', '@posthog/core', '@posthog/types', 'posthog-node'])(
  'refuses the retired vendor dependency %s in packaged node_modules',
  async (packageName) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js'])
    const path = join(resources, 'node_modules', ...packageName.split('/'), 'package.json')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'synthetic vendor fixture\n')
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded app vendor SDK was packaged: ${packageName}`
    )
  }
)

it('refuses a retired vendor dependency packed inside app.asar', async () => {
  const resources = await makeArchive([
    'package.json',
    'out/main/index.js',
    'node_modules/posthog-node/package.json'
  ])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    '[ash-package-hygiene] excluded app vendor SDK was packaged: posthog-node'
  )
})
