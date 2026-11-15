import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createPackage } = require('@electron/asar')
const { verifyAshPackagedAsarHygiene } = require('./verify-ash-packaged-asar-hygiene.cjs')
const {
  EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS,
  EXCLUDED_ASH_CLI_ARTIFACT_ROOTS
} = require('../../../excluded-ash-cli-entry-artifacts.cjs')
const {
  EXCLUDED_APP_PLUGIN_EXECUTABLES
} = require('../../../excluded-ash-app-plugin-artifacts.cjs')
const {
  EXCLUDED_ASH_MOBILE_RELAY_MODULES,
  EXCLUDED_ASH_MOBILE_SERVICE_ROOTS,
  EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS
} = require('../../../excluded-ash-mobile-relay-artifacts.cjs')
const {
  PACKAGED_RUNTIME_PACKAGE_ROOTS,
  createPackagedRuntimeNodeModuleResources
} = require('../../../packaged-runtime-node-modules.cjs')

const fixtures = []

async function makeArchive(files, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ash-packaged-asar-hygiene-'))
  fixtures.push(root)
  const source = join(root, 'source')
  const resources = join(root, 'resources')
  await mkdir(resources, { recursive: true })
  for (const name of files) {
    const path = join(source, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, overrides[name] ?? 'synthetic data, no real user profile\n')
  }
  await createPackage(source, join(resources, 'app.asar'))
  return resources
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

it('tracks exactly the retired standalone general app-plugin CLI trees', () => {
  expect(EXCLUDED_ASH_CLI_ARTIFACT_ROOTS).toEqual([
    'out/cli/plugin-authoring',
    'out/cli/plugin-dev-watch'
  ])
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
    'resources/icons/ash.png',
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

it('rejects the excluded native speech worker in the desktop ASAR', async () => {
  const resources = await makeArchive([
    'package.json',
    'out/main/index.js',
    'out/main/stt-worker.js'
  ])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(/excluded speech worker/)
})

it('rejects the excluded native speech worker in unpacked runtime files', async () => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const worker = join(resources, 'app.asar.unpacked', 'out', 'main', 'stt-worker.js')
  await mkdir(dirname(worker), { recursive: true })
  await writeFile(worker, 'synthetic excluded speech worker\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(/excluded speech worker/)
})

it.each([
  'node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node'
])('rejects packaged native speech dependency %s in the ASAR', async (artifact) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js', artifact])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(/excluded speech native/)
})

it('rejects a native speech dependency copied beside app.asar', async () => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const native = join(resources, 'node_modules', 'sherpa-onnx-linux-x64', 'sherpa-onnx.node')
  await mkdir(dirname(native), { recursive: true })
  await writeFile(native, 'synthetic excluded speech addon\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(/excluded speech native/)
})

it.each(['out/cli/handlers/jira.js', 'out/cli/specs/linear.js'])(
  'refuses unregistered task-tracker CLI artifact %s in app.asar',
  async (path) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js', path])
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded CLI artifact packaged: ${path}`
    )
  }
)

it('refuses a Jira handler copied to app.asar.unpacked outside the archive', async () => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const artifact = 'out/cli/handlers/jira.js'
  const unpacked = join(resources, 'app.asar.unpacked', artifact)
  await mkdir(dirname(unpacked), { recursive: true })
  await writeFile(unpacked, 'synthetic retired handler\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `[ash-package-hygiene] excluded CLI artifact packaged: ${artifact}`
  )
})

it.each(EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS)(
  'refuses excluded Ash CLI entrypoint %s in app.asar',
  async (artifact) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js', artifact])
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded CLI artifact packaged: ${artifact}`
    )
  }
)

it.each([
  'out/cli/plugin-authoring/plugin-cli-output.js',
  'out/cli/plugin-dev-watch/plugin-dev-watch-check.js'
])('rejects retired app-plugin CLI directory artifact %s in app.asar', async (artifact) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js', artifact])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `[ash-package-hygiene] excluded app-plugin CLI tree packaged: ${artifact.split('/').slice(0, 3).join('/')}`
  )
})

it.each([
  'out/cli/plugin-authoring/plugin-cli-output.js',
  'out/cli/plugin-dev-watch/plugin-dev-watch-check.js'
])(
  'rejects retired app-plugin CLI directory artifact %s in app.asar.unpacked',
  async (artifact) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js'])
    const unpacked = join(resources, 'app.asar.unpacked', artifact)
    await mkdir(dirname(unpacked), { recursive: true })
    await writeFile(unpacked, 'synthetic excluded app-plugin CLI fixture\n')
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded app-plugin CLI tree packaged: ${artifact.split('/').slice(0, 3).join('/')}`
    )
  }
)

it('rejects a dangling CommonJS import of a retired app-plugin CLI authoring module', async () => {
  const importer = 'out/cli/handlers/local-status.js'
  const resources = await makeArchive(['package.json', 'out/main/index.js', importer], {
    [importer]: "const authoring = require('../plugin-authoring/plugin-cli-output')\n"
  })
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `[ash-package-hygiene] retained runtime imports excluded app-plugin CLI tree: ${importer} -> out/cli/plugin-authoring/plugin-cli-output`
  )
})

it('rejects a dangling static dynamic import of a retired app-plugin CLI watcher', async () => {
  const importer = 'out/cli/runtime/retained-status.js'
  const resources = await makeArchive(['package.json', 'out/main/index.js', importer], {
    [importer]: "const watcher = import('../plugin-dev-watch/plugin-dev-watch-check.js')\n"
  })
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `[ash-package-hygiene] retained runtime imports excluded app-plugin CLI tree: ${importer} -> out/cli/plugin-dev-watch/plugin-dev-watch-check.js`
  )
})

it.each([
  'out/cli/handlers/speech.js',
  'out/cli/handlers/plugin-runtime.js',
  'out/cli/specs/plugin.js'
])('refuses excluded CLI module %s in app.asar.unpacked', async (artifact) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const unpacked = join(resources, 'app.asar.unpacked', artifact)
  await mkdir(dirname(unpacked), { recursive: true })
  await writeFile(unpacked, 'synthetic excluded CLI fixture\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `[ash-package-hygiene] excluded CLI artifact packaged: ${artifact}`
  )
})

it.each(EXCLUDED_APP_PLUGIN_EXECUTABLES)(
  'rejects general app-plugin executable %s in app.asar',
  async (artifact) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js', artifact])
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded app-plugin executable packaged: ${artifact}`
    )
  }
)

it.each(EXCLUDED_ASH_MOBILE_RELAY_MODULES)(
  'rejects retired mobile/relay compiled module %s in app.asar',
  async (artifact) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js', artifact])
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded mobile/relay module packaged: ${artifact}`
    )
  }
)

it('rejects a dangling CommonJS import of an excluded mobile module from retained runtime', async () => {
  const importer = 'out/shared/retained-local-agent.js'
  const resources = await makeArchive(['package.json', 'out/main/index.js', importer], {
    [importer]: "const alert = require('./mobile-notification-identity')\n"
  })
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `retained runtime imports excluded mobile/relay module: ${importer} -> out/shared/mobile-notification-identity.js`
  )
})

it('rejects a dangling static ESM import of an excluded relay module', async () => {
  const importer = 'out/main/retained-subsystem.js'
  const resources = await makeArchive(['package.json', 'out/main/index.js', importer], {
    [importer]: "import { session } from '../shared/remote-runtime/relay/mobile-relay-status.js'\n"
  })
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `retained runtime imports excluded mobile/relay module: ${importer} -> out/shared/remote-runtime/relay/mobile-relay-status.js`
  )
})

it.each([
  'out/shared/mobile-notification-identity.js',
  'out/shared/remote-runtime/e2ee/mobile-e2ee-legacy-fixtures.js',
  'out/shared/remote-runtime/e2ee/paired-e2ee-framing-policy.js',
  'out/shared/remote-runtime/relay/mobile-relay-phone-protocol.js'
])('rejects retired mobile/relay module %s in app.asar.unpacked', async (artifact) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const file = join(resources, 'app.asar.unpacked', artifact)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'synthetic retired mobile/relay fixture\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    `[ash-package-hygiene] excluded mobile/relay module packaged: ${artifact}`
  )
})

it.each(EXCLUDED_ASH_MOBILE_SERVICE_ROOTS)(
  'rejects a reintroduced mobile/remote service root %s in app.asar',
  async (root) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js', `${root}/index.js`])
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded mobile/remote service tree packaged: ${root}`
    )
  }
)

it.each(['out/mobile-web', 'out/relay'])(
  'rejects mobile/remote service root %s in app.asar.unpacked',
  async (root) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js'])
    const file = join(resources, 'app.asar.unpacked', root, 'index.js')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'synthetic retired service entry\n')
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded mobile/remote service tree packaged: ${root}`
    )
  }
)

it.each(EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS)(
  'rejects a separately copied native %s service',
  async (root) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js'])
    const file = join(resources, root, 'manifest.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'synthetic retired app service resource\n')
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded mobile/relay native resource: ${root}`
    )
  }
)

it.each(EXCLUDED_APP_PLUGIN_EXECUTABLES)(
  'rejects general app-plugin executable %s in app.asar.unpacked',
  async (artifact) => {
    const resources = await makeArchive(['package.json', 'out/main/index.js'])
    const file = join(resources, 'app.asar.unpacked', artifact)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'synthetic excluded app-plugin host\n')
    expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
      `[ash-package-hygiene] excluded app-plugin executable packaged: ${artifact}`
    )
  }
)

it.each([
  'resources/plugins/launch/bundled-plugins.json',
  'resources/plugins/launch/orca-marketplace.json',
  'resources/plugins/declarative/orca-runtime.mjs',
  'resources/plugins/types/orca-host.d.ts'
])('rejects application-plugin authoring/marketplace file %s in app.asar', async (artifact) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js', artifact])
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    '[ash-package-hygiene] excluded app-plugin marketplace/authoring tree packaged'
  )
})

it('rejects unpacked application-plugin source resources', async () => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const file = join(
    resources,
    'app.asar.unpacked',
    'resources',
    'plugins',
    'declarative',
    'orca-runtime.mjs'
  )
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'synthetic app-plugin runtime\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    '[ash-package-hygiene] excluded app-plugin marketplace/authoring tree packaged'
  )
})

it.each([
  'plugins/launch/bundled-plugins.json',
  'plugins/launch/orca-marketplace.json',
  'plugins/types/orca-host.d.ts'
])('rejects native extraResources application-plugin tree %s', async (artifact) => {
  const resources = await makeArchive(['package.json', 'out/main/index.js'])
  const file = join(resources, artifact)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'synthetic native plugin tree\n')
  expect(() => verifyAshPackagedAsarHygiene(resources)).toThrow(
    '[ash-package-hygiene] excluded app-plugin marketplace/authoring tree packaged'
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
