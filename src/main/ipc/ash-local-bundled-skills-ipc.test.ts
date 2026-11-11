import { beforeEach, expect, it, vi } from 'vitest'
import type {
  BundledSkillAutoUpdateRequest,
  LocalBundledSkillExecuteRequest,
  LocalBundledSkillPlanRequest
} from '../../shared/bundled-skill-plan'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trustedSender: { id: 74 }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      ipc.handlers.set(channel, listener)
    }
  }
}))
vi.mock('./ui', () => ({ getTrustedUIRendererWebContents: () => ipc.trustedSender }))

import { registerLocalBundledSkillIpcHandlers } from './bundled-skills'

const plan = {
  scope: 'global' as const,
  homeDirectory: '/disposable-ash-home',
  skills: [],
  planDigest: '0'.repeat(64)
}
const result = { scope: 'global' as const, skills: [] }

const host = {
  planLocalBundledSkills: vi.fn(async (_request: LocalBundledSkillPlanRequest) => plan),
  executeLocalBundledSkills: vi.fn(async (_request: LocalBundledSkillExecuteRequest) => result),
  autoUpdateLocalBundledSkills: vi.fn(async (_request: BundledSkillAutoUpdateRequest) => result)
}

function invoke(channel: string, value?: unknown, sender: unknown = ipc.trustedSender) {
  const handler = ipc.handlers.get(channel)
  if (!handler) {
    throw new Error(`Missing desktop skill handler: ${channel}`)
  }
  return handler({ sender }, value)
}

beforeEach(() => {
  ipc.handlers.clear()
  vi.clearAllMocks()
  registerLocalBundledSkillIpcHandlers(host)
})

it('registers only local bundled-skill IPC for planning, digest execution and safe auto-update', async () => {
  expect([...ipc.handlers.keys()].sort()).toEqual([
    'skills:bundledAutoUpdate',
    'skills:bundledExecute',
    'skills:bundledPlan'
  ])
  expect(await invoke('skills:bundledPlan')).toEqual(plan)
  expect(host.planLocalBundledSkills).toHaveBeenCalledWith({})

  expect(await invoke('skills:bundledPlan', { names: ['orca-cli'], agent: 'codex' })).toEqual(plan)
  expect(host.planLocalBundledSkills).toHaveBeenCalledWith({
    names: ['orca-cli'],
    agent: 'codex'
  })

  const request = { planDigest: 'a'.repeat(64), request: { names: ['orca-cli'] } }
  expect(await invoke('skills:bundledExecute', request)).toEqual(result)
  expect(host.executeLocalBundledSkills).toHaveBeenCalledWith(request)

  expect(await invoke('skills:bundledAutoUpdate', { names: ['orca-cli'] })).toEqual(result)
  expect(host.autoUpdateLocalBundledSkills).toHaveBeenCalledWith({ names: ['orca-cli'] })
})

it('refuses every bundled-skill operation from an untrusted renderer', () => {
  for (const channel of ipc.handlers.keys()) {
    expect(() => invoke(channel, {}, { id: 999 })).toThrow('Unauthorized skill IPC sender')
  }
  expect(host.planLocalBundledSkills).not.toHaveBeenCalled()
  expect(host.executeLocalBundledSkills).not.toHaveBeenCalled()
  expect(host.autoUpdateLocalBundledSkills).not.toHaveBeenCalled()
})

it('rejects unknown and malformed input before invoking any local install service', async () => {
  await expect(invoke('skills:bundledPlan', { cloudPackageId: 'legacy' })).rejects.toThrow()
  await expect(invoke('skills:bundledPlan', { names: ['../escape'] })).rejects.toThrow()
  await expect(
    invoke('skills:bundledExecute', { planDigest: 'not-a-digest', request: {} })
  ).rejects.toThrow()
  await expect(
    invoke('skills:bundledExecute', {
      planDigest: 'a'.repeat(64),
      request: {},
      remoteHostId: 'excluded'
    })
  ).rejects.toThrow()
  await expect(invoke('skills:bundledAutoUpdate', { names: [] })).rejects.toThrow()
  await expect(
    invoke('skills:bundledAutoUpdate', { names: ['orca-cli'], force: true })
  ).rejects.toThrow()

  expect(host.planLocalBundledSkills).not.toHaveBeenCalled()
  expect(host.executeLocalBundledSkills).not.toHaveBeenCalled()
  expect(host.autoUpdateLocalBundledSkills).not.toHaveBeenCalled()
})
