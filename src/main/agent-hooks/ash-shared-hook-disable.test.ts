import { describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  detectPresence: vi.fn(),
  removeClaude: vi.fn(),
  removeCodex: vi.fn(),
  readClaude: vi.fn(),
  readCodex: vi.fn(),
  installClaude: vi.fn(),
  installCodex: vi.fn()
}))

vi.mock('./local-agent-cli-presence', () => ({
  detectLocalManagedAgentCliPresence: hooks.detectPresence
}))

vi.mock('./managed-agent-hook-registry', () => ({
  MANAGED_AGENT_HOOK_INSTALLERS: [
    ['claude', hooks.installClaude],
    ['codex', hooks.installCodex]
  ],
  MANAGED_AGENT_HOOK_REMOVERS: [
    ['claude', hooks.removeClaude],
    ['codex', hooks.removeCodex]
  ],
  MANAGED_AGENT_HOOK_ASYNC_REMOVERS: [],
  MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS: [],
  MANAGED_AGENT_HOOK_STATUS_READERS: [
    ['claude', hooks.readClaude],
    ['codex', hooks.readCodex]
  ]
}))

import { beforeEach } from 'vitest'
import { applyAgentStatusHooksEnabled, installManagedAgentHooks } from './managed-agent-hook-controls'

beforeEach(() => {
  vi.resetAllMocks()
  hooks.readClaude.mockReturnValue({
    agent: 'claude', state: 'installed', configPath: '/shared/claude-settings',
    managedHooksPresent: true, detail: null
  })
  hooks.readCodex.mockReturnValue({
    agent: 'codex', state: 'partial', configPath: '/shared/codex-settings',
    managedHooksPresent: true, detail: 'Some approvals unavailable'
  })
  hooks.detectPresence.mockResolvedValue({ claude: { state: 'found', executablePath: '' } })
  hooks.installClaude.mockReturnValue({
    agent: 'claude', state: 'installed', configPath: '/shared/claude-settings',
    managedHooksPresent: true, detail: null
  })
})

describe('Ash disabled status hooks preserve other applications and report degradation', () => {
  it('does not uninstall shared provider hooks when the global Ash hook setting is disabled', async () => {
    const statuses = await applyAgentStatusHooksEnabled(false, { agentStatusHooksEnabled: false })
    expect(hooks.removeClaude).not.toHaveBeenCalled()
    expect(hooks.removeCodex).not.toHaveBeenCalled()
    expect(hooks.installClaude).not.toHaveBeenCalled()
    expect(hooks.installCodex).not.toHaveBeenCalled()
    expect(statuses).toEqual([
      expect.objectContaining({ agent: 'claude', state: 'skipped',
        skipReason: 'hooks_disabled', managedHooksPresent: true }),
      expect.objectContaining({ agent: 'codex', state: 'skipped',
        skipReason: 'hooks_disabled', managedHooksPresent: true })
    ])
    expect(statuses.every((entry) => entry.detail?.includes('left unchanged'))).toBe(true)
  })

  it('preserves physical hook presence while marking monitoring disabled with keepSharedEntries', async () => {
    const result = await applyAgentStatusHooksEnabled(false, { agentStatusHooksEnabled: false }, {
      keepSharedEntries: true
    })
    expect(result.map((entry) => entry.state)).toEqual(['skipped', 'skipped'])
    expect(result.map((entry) => entry.managedHooksPresent)).toEqual([true, true])
    expect(hooks.removeClaude).not.toHaveBeenCalled()
    expect(hooks.removeCodex).not.toHaveBeenCalled()
  })

  it('does not mark unreadable physical hook configuration as installed', async () => {
    hooks.readClaude.mockImplementation(() => { throw new Error('permission denied') })
    const result = await applyAgentStatusHooksEnabled(false, { agentStatusHooksEnabled: false })
    expect(result[0]).toMatchObject({
      agent: 'claude', state: 'skipped', skipReason: 'hooks_disabled', managedHooksPresent: false
    })
    expect(result[0].detail).toContain('left unchanged')
    expect(hooks.removeClaude).not.toHaveBeenCalled()
  })

  it('does not install or remove hooks when one agent is disabled and another remains enabled', async () => {
    const statuses = await applyAgentStatusHooksEnabled(true, {
      agentStatusHooksEnabled: true,
      disabledTuiAgents: ['codex']
    })
    expect(hooks.installClaude).not.toHaveBeenCalled()
    expect(hooks.installCodex).not.toHaveBeenCalled()
    expect(hooks.removeClaude).not.toHaveBeenCalled()
    expect(hooks.removeCodex).not.toHaveBeenCalled()
    expect(statuses).toEqual([
      expect.objectContaining({ agent: 'claude', state: 'skipped',
        skipReason: 'ash_ownership_unavailable' }),
      expect.objectContaining({ agent: 'codex', state: 'skipped',
        skipReason: 'ash_ownership_unavailable' })
    ])
  })

  it('does not install provider-global entries on Ash enable without an ownership ledger', async () => {
    const result = await applyAgentStatusHooksEnabled(true, {
      agentStatusHooksEnabled: true
    }, { userInitiated: true })
    expect(hooks.installClaude).not.toHaveBeenCalled()
    expect(hooks.installCodex).not.toHaveBeenCalled()
    expect(hooks.removeClaude).not.toHaveBeenCalled()
    expect(hooks.removeCodex).not.toHaveBeenCalled()
    expect(result).toEqual([
      expect.objectContaining({ agent: 'claude', state: 'skipped',
        skipReason: 'ash_ownership_unavailable', managedHooksPresent: true }),
      expect.objectContaining({ agent: 'codex', state: 'skipped',
        skipReason: 'ash_ownership_unavailable', managedHooksPresent: true })
    ])
  })

  it('fails closed for a direct startup installer call, without even probing or refreshing CLIs', async () => {
    const statuses = await installManagedAgentHooks({ agentStatusHooksEnabled: true })
    expect(hooks.detectPresence).not.toHaveBeenCalled()
    expect(hooks.installClaude).not.toHaveBeenCalled()
    expect(hooks.installCodex).not.toHaveBeenCalled()
    expect(statuses.every((s) => s.skipReason === 'ash_ownership_unavailable')).toBe(true)
  })
})
