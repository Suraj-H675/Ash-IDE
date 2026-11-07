import './runtime-test-module-registration.spec'
import './orca-runtime-test-lifecycle.spec'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { store } from './orca-runtime-test-fixtures.spec'
import { TERMINAL_PERSISTENCE_UNAVAILABLE_CODE } from '../../../shared/runtime-capability-degradation'

describe('runtime status terminal persistence', () => {
  it('does not advertise product surfaces Ash does not serve', () => {
    const capabilities = new OrcaRuntimeService(store).getStatus().capabilities ?? []
    const unsupported =
      /^(accounts\.|account\.|artifacts\.|automation\.|automations\.|browser\.desktopBridge\.|cloud\.|device\.|device-key\.|emulator\.|github\.|gitlab\.|hostedReview\.|jira\.|linear\.|managed-runtime\.|managedServer\.|mobile\.|mobileRelay\.|mobileWeb\.|network\.browserTunnel\.|notifications\.remote-|orcad\.|orchestration\.federation|pairing\.|plugin\.|plugins\.|project-host-setup\.|remote-runtime\.|remote-server\.|relay\.|runtime\.automatic-work\.|runtime\.environments\.|runtime\.status\.compat\.|skills\.|speech\.|ssh\.|task-source\.|telemetry\.|updater\.)/

    expect(capabilities.filter((capability) => unsupported.test(capability))).toEqual([])
    expect(capabilities.some((capability) => capability.startsWith('terminal.'))).toBe(true)
  })

  it('reports when new terminals would not survive a server restart', () => {
    let daemonOwnsFreshSessions = false
    const runtime = new OrcaRuntimeService(store, undefined, {
      canRecoverPersistentLocalPtys: () => daemonOwnsFreshSessions
    })
    const codes = (): string[] =>
      (runtime.getStatus().degradations ?? []).map((degradation) => degradation.code)

    expect(codes()).toContain(TERMINAL_PERSISTENCE_UNAVAILABLE_CODE)
    daemonOwnsFreshSessions = true
    expect(codes()).not.toContain(TERMINAL_PERSISTENCE_UNAVAILABLE_CODE)
  })
})
