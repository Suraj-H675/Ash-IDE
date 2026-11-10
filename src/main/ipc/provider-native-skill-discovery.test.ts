import { beforeEach, expect, it, vi } from 'vitest'
import { registerProviderNativeSkillDiscoveryHandler } from './skills'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trustedSender: { id: 37 },
  resolve: vi.fn(async () => ({
    kind: 'native-host' as const,
    cwd: '/disposable/workspace',
    sourceKinds: ['repo'] as const
  })),
  discover: vi.fn(async () => ({ skills: [], sources: [], scannedAt: 123 })),
  rootOverrides: vi.fn(async () => ({})),
  cloud: vi.fn(),
  stoppedWslGate: vi.fn(async (run: () => Promise<unknown>) => run())
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, listener)
    }
  }
}))
vi.mock('./ui', () => ({
  getTrustedUIRendererWebContents: () => mocks.trustedSender
}))
vi.mock('../skills/skill-discovery-target', () => ({
  resolveSkillDiscoveryTarget: mocks.resolve,
  discoverSkillsOnTarget: mocks.discover
}))
vi.mock('../skills/skill-discovery-stopped-wsl-roots', () => ({
  unavailableWhileWslDistroStopped: mocks.stoppedWslGate
}))
vi.mock('../wsl/filesystem/wsl-unc-access-gate', () => ({
  runAsWslUserAct: vi.fn(),
  wslDistroForPath: vi.fn()
}))
vi.mock('./skill-cloud-ipc-handlers', () => ({
  registerSkillCloudIpcHandlers: mocks.cloud
}))

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
})

it('registers only trusted provider-native discovery and retains provider roots and passive WSL protection', async () => {
  const repos = [{ id: 'repo', path: '/disposable/workspace' }]
  const store = { getRepos: () => repos }
  const overrides = { codex: ['/disposable/managed-codex'] }
  mocks.rootOverrides.mockResolvedValueOnce(overrides)
  const runtime = { resolveSkillDiscoveryProviderRoots: mocks.rootOverrides }

  registerProviderNativeSkillDiscoveryHandler(store as never, runtime as never)

  expect([...mocks.handlers.keys()]).toEqual(['skills:discover'])
  expect(mocks.cloud).not.toHaveBeenCalled()
  const handler = mocks.handlers.get('skills:discover')!
  const target = { cwd: '/disposable/workspace', sourceKinds: ['repo'], refresh: true }
  const response = await handler({ sender: mocks.trustedSender }, target)
  expect(response).toEqual({ skills: [], sources: [], scannedAt: 123 })
  expect(mocks.resolve).toHaveBeenCalledWith(target, { refuseStoppedWslDistro: true })
  expect(mocks.stoppedWslGate).toHaveBeenCalledOnce()
  expect(mocks.rootOverrides).toHaveBeenCalledWith({
    kind: 'native-host',
    cwd: '/disposable/workspace',
    sourceKinds: ['repo']
  })
  expect(mocks.discover).toHaveBeenCalledWith(
    { kind: 'native-host', cwd: '/disposable/workspace', sourceKinds: ['repo'] },
    repos,
    { providerRootOverrides: overrides, refresh: true }
  )

  expect(() => handler({ sender: { id: 100 } }, target)).toThrow('Unauthorized skill IPC sender')
  expect(mocks.discover).toHaveBeenCalledOnce()

  await expect(
    handler({ sender: mocks.trustedSender }, { sourceKinds: ['unsupported-kind'] })
  ).rejects.toThrow()
  expect(mocks.discover).toHaveBeenCalledOnce()
})
