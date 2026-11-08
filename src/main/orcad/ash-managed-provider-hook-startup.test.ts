import { describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({
  agentViewReconcile: vi.fn(async () => {}),
  startCodexHooks: vi.fn(),
  reconcileStartupManagedAgentHooks: vi.fn(),
  refreshInstalledOpenCodeStatusPlugins: vi.fn(),
  adoptLoginShellAgentHomes: vi.fn(async () => {}),
  hydrateAgentCliShellPath: vi.fn(async () => {})
}))

vi.mock('../claude/agent-view/agent-view-service', () => ({
  getClaudeAgentViewService: () => ({ reconcile: dependencies.agentViewReconcile })
}))
vi.mock('../codex/hooks/reconciliation/codex-hook-reconcile', () => ({
  startCodexHooks: dependencies.startCodexHooks
}))
vi.mock('../agent-hooks/managed-agent-hook-startup', () => ({
  reconcileStartupManagedAgentHooks: dependencies.reconcileStartupManagedAgentHooks
}))
vi.mock('../opencode/opencode-status-plugin-startup-refresh', () => ({
  refreshInstalledOpenCodeStatusPlugins: dependencies.refreshInstalledOpenCodeStatusPlugins
}))
vi.mock('../agent-hooks/agent-home-login-shell', () => ({
  adoptLoginShellAgentHomes: dependencies.adoptLoginShellAgentHomes
}))
vi.mock('../agent-hooks/local-agent-cli-presence', () => ({
  hydrateAgentCliShellPath: dependencies.hydrateAgentCliShellPath
}))

import { startOrcadManagedAgentHooks } from './orcad-managed-agent-hooks'

describe('Ash headless provider hook discovery never auto-writes provider config', () => {
  it('starts status receiver without installing Claude/Codex/OpenCode hooks', async () => {
    const getSettings = vi.fn(() => ({ agentStatusHooksEnabled: true }))
    let changed: ((update: { agentStatusHooksEnabled?: boolean }, settings: { agentStatusHooksEnabled: boolean }) => void) | undefined
    const removeSettingsListener = vi.fn()
    const onSettingsChanged = vi.fn((listener: typeof changed) => {
      changed = listener
      return removeSettingsListener
    })
    const setStatusHooksEnabled = vi.fn()
    const cleanups: Array<() => void> = []
    const controller = startOrcadManagedAgentHooks(
      { getSettings, onSettingsChanged } as never,
      setStatusHooksEnabled,
      (cleanup) => cleanups.push(cleanup as () => void)
    )
    controller.readinessPublished()
    await Promise.resolve()
    await Promise.resolve()
    expect(dependencies.agentViewReconcile).not.toHaveBeenCalled()
    expect(dependencies.startCodexHooks).not.toHaveBeenCalled()
    expect(dependencies.reconcileStartupManagedAgentHooks).not.toHaveBeenCalled()
    expect(dependencies.refreshInstalledOpenCodeStatusPlugins).not.toHaveBeenCalled()
    expect(dependencies.adoptLoginShellAgentHomes).not.toHaveBeenCalled()
    changed?.({ agentStatusHooksEnabled: false }, { agentStatusHooksEnabled: false })
    expect(setStatusHooksEnabled).toHaveBeenCalledWith(false)
    changed?.({ agentStatusHooksEnabled: true }, { agentStatusHooksEnabled: true })
    expect(setStatusHooksEnabled).toHaveBeenCalledWith(true)
    expect(dependencies.agentViewReconcile).not.toHaveBeenCalled()
    cleanups.forEach((cleanup) => cleanup())
    expect(removeSettingsListener).toHaveBeenCalledTimes(1)
  })
})
