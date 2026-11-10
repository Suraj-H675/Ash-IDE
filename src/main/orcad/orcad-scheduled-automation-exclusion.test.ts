import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createOrcadIdleProbes, type OrcadManagedIdleExitPorts } from './orcad-managed-idle-exit'

describe('scheduled automation runtime exclusion', () => {
  it('does not start a scheduler from Orcad runtime startup', () => {
    const entry = readFileSync(new URL('./orcad-entry.ts', import.meta.url), 'utf-8')

    expect(entry).not.toMatch(/\bstartOrcadAutomations\b/)
    expect(entry).not.toMatch(/\borcadAutomationsKeepHostBusy\b/)
  })

  it('does not wire the WSL host schedule-wake loop into runtime startup', () => {
    const handlers = readFileSync(
      new URL('../ipc/wsl/wsl-host-handlers.ts', import.meta.url),
      'utf-8'
    )

    expect(handlers).not.toContain('createWslHostAutomationWake')
  })

  it('keeps stored schedules out of generic idle-exit probes', () => {
    const ports = {
      readClientActivity: () => ({ openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }),
      listTerminals: async () => [],
      countDaemonSessions: async () => 0,
      hasDaemon: () => false,
      agentStates: () => [],
      hasChatProviders: () => false,
      hasStagedMigration: () => false,
      emulatorsBusy: async () => false,
      activationFenceExists: async () => false
    } satisfies OrcadManagedIdleExitPorts
    const probes = createOrcadIdleProbes(
      { timeoutMs: 1_000, activationRoot: '/tmp/activation' },
      ports
    )
    const names = probes.map(({ name }) => name)

    expect(names).not.toContain('automations')
    expect(names).toContain('terminals')
    expect(names).toContain('agents')
  })
})
