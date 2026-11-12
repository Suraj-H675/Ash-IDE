import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { RuntimeEdgeCommandController } from './runtime-edge-command-controller'

describe('Ash runtime does not install excluded application connectors', () => {
  it('does not ship the retired connector RPC roots but retains saved-state coverage', () => {
    for (const path of [
      'src/main/runtime/rpc/methods/jira.ts',
      'src/main/runtime/rpc/methods/linear.ts',
      'src/main/runtime/rpc/methods/linear-agent-access.ts',
      'src/main/runtime/integrations/jira/runtime-jira-commands.ts',
      'src/main/runtime/integrations/linear/linear-commands.ts',
      'src/main/runtime/integrations/linear/runtime-linear-command-surface.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
    expect(
      existsSync(
        resolve(process.cwd(), 'src/main/runtime/rpc/methods/jira-saved-filter-state.test.ts')
      )
    ).toBe(true)
  })

  it('does not install Linear methods on the real runtime prototype', () => {
    const runtimeMethods = Object.getOwnPropertyNames(OrcaRuntimeService.prototype)
    expect(runtimeMethods.some((name) => name.startsWith('linear'))).toBe(false)
    expect(runtimeMethods).not.toContain('linearConnect')
  })

  it('does not bind Jira commands into the live browser/emulator edge surface', () => {
    const edge = new RuntimeEdgeCommandController({
      // The retained browser and emulator commands are bound lazily to their
      // respective hosts, which are not invoked by this registry-only test.
      browserHost: {} as ConstructorParameters<
        typeof RuntimeEdgeCommandController
      >[0]['browserHost'],
      emulatorHost: {} as ConstructorParameters<
        typeof RuntimeEdgeCommandController
      >[0]['emulatorHost'],
      screencast: {
        registerSubscriptionCleanup: () => undefined,
        cleanupSubscription: () => undefined,
        getDriver: () => null as never,
        setDriver: () => undefined,
        notifyRemoteViewersChanged: () => undefined
      }
    })
    const methods = Object.keys(edge.surface)
    expect(methods.some((name) => name.startsWith('jira'))).toBe(false)
    expect(methods).not.toContain('jiraConnect')
    expect(methods).toContain('browserSnapshot')
    expect(methods).toContain('emulatorTap')
  })
})
