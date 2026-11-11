import { describe, expect, it, vi } from 'vitest'
import { eraseRpcMethods, type RpcContext } from '../core'
import { RPC_PARAMS_BY_METHOD } from '../../../../shared/rpc-contract/rpc-params-catalog.generated'
import { RUNTIME_CAPABILITIES } from '../../../../shared/protocol-version'
import { SKILL_RUNTIME_CAPABILITIES } from '../../../../shared/skill-install-capability'

vi.mock('electron', () => ({
  app: { getPath: () => '/orca-state', isPackaged: true }
}))

vi.mock('../../../skills/skill-discovery-target', () => ({
  resolveSkillDiscoveryTarget: vi.fn((target) => ({ kind: 'native-host', cwd: target?.cwd })),
  discoverSkillsOnTarget: vi.fn(async () => ({ skills: [], sources: [], scannedAt: 1 }))
}))
// Off Windows the real gate never sees a distro; stand in for its UNC parse.
vi.mock('../../../wsl/filesystem/wsl-unc-access-gate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wslDistroForPath: (path: string) => /^\\\\wsl\.localhost\\([^\\]+)/.exec(path)?.[1] ?? null
}))
import { SKILL_METHODS } from './skills'
import {
  discoverSkillsOnTarget,
  resolveSkillDiscoveryTarget
} from '../../../skills/skill-discovery-target'

const WSL_RUNTIME = {
  status: 'resolved',
  runtime: {
    kind: 'wsl',
    hostPlatform: 'wsl',
    projectId: 'project-1',
    distro: 'Ubuntu',
    reason: 'project-override',
    cacheKey: 'wsl:Ubuntu'
  }
} as const

function makeContext(overrides: {
  resolveProjectRuntimeForWorktree?: (worktreeId: string | null | undefined) => unknown
  resolveRuntimeFileTarget?: (selector: string) => Promise<unknown>
}): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: skills.discover reads only these runtime members.
  return {
    runtime: {
      listRepos: () => [],
      resolveSkillDiscoveryProviderRoots: async () => ({}),
      resolveProjectRuntimeForWorktree:
        overrides.resolveProjectRuntimeForWorktree ?? (() => undefined),
      resolveRuntimeFileTarget: overrides.resolveRuntimeFileTarget
    }
  } as unknown as RpcContext
}

function discoverMethod() {
  const method = eraseRpcMethods(SKILL_METHODS).find((entry) => entry.name === 'skills.discover')
  if (!method) {
    throw new Error('skills.discover method not registered')
  }
  return method
}

function method(name: string) {
  const value = eraseRpcMethods(SKILL_METHODS).find((entry) => entry.name === name)
  if (!value) {
    throw new Error(`${name} method not registered`)
  }
  return value
}

describe('skills.discover RPC', () => {
  it('resolves the project runtime from the owning runtime store when the caller omits it', async () => {
    const resolveProjectRuntimeForWorktree = vi.fn(() => WSL_RUNTIME)
    await discoverMethod().handler(
      { cwd: 'C:\\repo', worktreeId: 'worktree-1' },
      makeContext({ resolveProjectRuntimeForWorktree })
    )
    expect(resolveProjectRuntimeForWorktree).toHaveBeenCalledWith('worktree-1')
    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectRuntime: WSL_RUNTIME }),
      { refuseStoppedWslDistro: true }
    )
  })

  it('scans a workspace named only by id in its folder, and refuses SSH workspaces', async () => {
    const resolveRuntimeFileTarget = vi.fn(async () => ({
      worktree: { path: '/repo/feature' },
      executionHostId: 'local'
    }))
    await discoverMethod().handler(
      { worktreeId: 'repo::/repo/feature' },
      makeContext({ resolveRuntimeFileTarget })
    )
    expect(resolveRuntimeFileTarget).toHaveBeenCalledWith('id:repo::/repo/feature')
    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: '/repo/feature' }),
      { refuseStoppedWslDistro: true }
    )

    const discoveries = vi.mocked(discoverSkillsOnTarget).mock.calls.length
    await expect(
      discoverMethod().handler(
        { worktreeId: 'remote::/srv/app' },
        makeContext({
          resolveRuntimeFileTarget: async () => ({
            worktree: { path: '/srv/app' },
            executionHostId: 'ssh:box'
          })
        })
      )
    ).rejects.toThrow('unavailable for SSH hosts')
    expect(vi.mocked(discoverSkillsOnTarget).mock.calls).toHaveLength(discoveries)
  })

  it('prefers a caller-supplied project runtime over store resolution', async () => {
    const resolveProjectRuntimeForWorktree = vi.fn()
    await discoverMethod().handler(
      { cwd: '/repo', worktreeId: 'worktree-1', projectRuntime: WSL_RUNTIME },
      makeContext({ resolveProjectRuntimeForWorktree })
    )
    expect(resolveProjectRuntimeForWorktree).not.toHaveBeenCalled()
    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectRuntime: WSL_RUNTIME }),
      { refuseStoppedWslDistro: true }
    )
  })

  it('only bypasses the host scan cache when the caller asks for a refresh', async () => {
    await discoverMethod().handler({ cwd: '/repo' }, makeContext({}))
    expect(vi.mocked(discoverSkillsOnTarget)).toHaveBeenLastCalledWith(expect.anything(), [], {
      providerRootOverrides: {},
      refresh: false
    })

    await discoverMethod().handler({ cwd: '/repo', refresh: true }, makeContext({}))
    expect(vi.mocked(discoverSkillsOnTarget)).toHaveBeenLastCalledWith(expect.anything(), [], {
      providerRootOverrides: {},
      refresh: true
    })
  })

  it('accepts a params payload from an older client that cannot send refresh', () => {
    expect(discoverMethod().params?.parse({ cwd: '/repo' })).toEqual({ cwd: '/repo' })
  })

  it('preserves portable filters through the server RPC boundary', async () => {
    await discoverMethod().handler(
      { names: ['orchestration'], sourceKinds: ['home'] },
      makeContext({})
    )

    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ names: ['orchestration'], sourceKinds: ['home'] }),
      { refuseStoppedWslDistro: true }
    )
  })

  it('accepts empty portable filters as an unbounded request', async () => {
    await discoverMethod().handler({ names: [], sourceKinds: [] }, makeContext({}))

    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ names: [], sourceKinds: [] }),
      { refuseStoppedWslDistro: true }
    )
  })
})

describe('native provider skill RPC boundary', () => {
  const allowed = [
    'skills.discover',
    'skills.previewDelete',
    'skills.delete',
    'skills.planBundledOrca',
    'skills.executeBundledOrca',
    'skills.autoUpdateBundledOrca'
  ] as const

  const retired = [
    'skills.share',
    'skills.install',
    'skills.installBundle',
    'skills.cancelInstall',
    'skills.getInstallProgress',
    'skills.previewInstall',
    'skills.removeInstall',
    'skills.listManagedInstalls',
    'skills.beginUpload',
    'skills.uploadChunk',
    'skills.commitUpload',
    'skills.cancelUpload'
  ] as const

  it('registers exactly native discovery, deletion and bundled skill maintenance methods', () => {
    const names = eraseRpcMethods(SKILL_METHODS).map((entry) => entry.name)
    expect(names).toEqual([...allowed])
    const generatedNames = Object.keys(RPC_PARAMS_BY_METHOD).filter((name) =>
      name.startsWith('skills.')
    )
    expect(generatedNames).toEqual([...allowed].sort())
    for (const name of retired) {
      expect(names, `${name} must never expose Orca Cloud installation or transfer`).not.toContain(
        name
      )
      expect(generatedNames, `${name} must be absent from generated RPC parameters`).not.toContain(
        name
      )
    }
  })

  it('advertises native skill capabilities without Cloud installer, transfer or management claims', () => {
    const advertised: readonly string[] = SKILL_RUNTIME_CAPABILITIES
    expect(advertised).toContain('skills.delete.v1')
    expect(advertised).toContain('skills.bundled-orca.v1')
    expect(advertised).toContain('skills.bundled-orca-auto-update.v1')
    for (const capability of [
      'skills.install.v1',
      'skills.install.bundle.v1',
      'skills.install-cancel.v1',
      'skills.install-progress.v1',
      'skills.install-result.v2',
      'skills.upload.v1',
      'skills.manage.v1',
      'skills.install-providers.v1'
    ]) {
      expect(advertised, `retired Cloud capability ${capability}`).not.toContain(capability)
      expect(RUNTIME_CAPABILITIES, `runtime must not claim ${capability}`).not.toContain(capability)
    }
  })

  it('preserves working local bundled skill plans, execution and auto-update delegates', async () => {
    const planLocalBundledSkills = vi.fn(async () => ({ plan: 'local' }))
    const executeLocalBundledSkills = vi.fn(async () => ({ status: 'complete' }))
    const autoUpdateLocalBundledSkills = vi.fn(async () => ({ status: 'unchanged' }))
    const runtime = {
      planLocalBundledSkills,
      executeLocalBundledSkills,
      autoUpdateLocalBundledSkills
    }
    const params = {}
    await method('skills.planBundledOrca').handler(params, { runtime } as unknown as RpcContext)
    await method('skills.executeBundledOrca').handler(params, { runtime } as unknown as RpcContext)
    await method('skills.autoUpdateBundledOrca').handler(params, {
      runtime
    } as unknown as RpcContext)
    expect(planLocalBundledSkills).toHaveBeenCalledWith(params)
    expect(executeLocalBundledSkills).toHaveBeenCalledWith(params)
    expect(autoUpdateLocalBundledSkills).toHaveBeenCalledWith(params)
  })
})

describe('retired vendor Cloud skill publishing RPC', () => {
  it('does not register a skills.share handler, even when legacy schemas remain', () => {
    expect(eraseRpcMethods(SKILL_METHODS).map((method) => method.name)).not.toContain(
      'skills.share'
    )
    expect(eraseRpcMethods(SKILL_METHODS).map((method) => method.name)).toContain('skills.discover')
  })
})
