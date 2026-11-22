import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeLocalRuntimeProviderChildren } from './update-runtime-provider-socket-observation'

const fixture = vi.hoisted(() => ({
  metadata: {
    runtimeId: 'runtime-expected',
    authToken: 'private-fixture',
    pid: 128,
    transports: []
  } as { runtimeId: string; authToken: string; pid: number; transports: unknown[] } | null,
  response: {
    runtimeId: 'runtime-expected',
    providerAgentSessions: {
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable',
      lowerBound: 2
    }
  } as unknown,
  fail: false,
  calls: [] as unknown[]
}))

vi.mock('../runtime/rpc/server/runtime-metadata', () => ({
  readRuntimeMetadataAsync: async () => fixture.metadata
}))
vi.mock('../orcad/orcad-sidecar-runtime-client', () => ({
  sendOrcadSidecarRequest: async (...args: unknown[]) => {
    fixture.calls.push(args)
    if (fixture.fail) throw new Error('local runtime unavailable')
    return fixture.response
  }
}))

afterEach(() => {
  fixture.metadata = {
    runtimeId: 'runtime-expected',
    authToken: 'private-fixture',
    pid: 128,
    transports: []
  }
  fixture.response = {
    runtimeId: 'runtime-expected',
    providerAgentSessions: {
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable',
      lowerBound: 2
    }
  }
  fixture.fail = false
  fixture.calls.length = 0
})

describe('local runtime provider observation admission', () => {
  it('accepts a bounded positive result only from the expected authenticated runtime', async () => {
    expect(await observeLocalRuntimeProviderChildren('/private-fixture')).toBe(2)
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]).toMatchObject([
      expect.objectContaining({ runtimeId: 'runtime-expected' }),
      'runtime.providerActivity',
      undefined,
      2_000,
      { maxResponseBytes: 8 * 1024, strict: true }
    ])
  })

  it('refuses changed runtime IDs, mismatched replies, and untrusted counts', async () => {
    for (const invalid of [
      {
        runtimeId: 'runtime-replaced',
        providerAgentSessions: {
          state: 'unknown',
          reason: 'provider-agent-inventory-unavailable',
          lowerBound: 2
        }
      },
      { runtimeId: 'runtime-expected', providerAgentSessions: { state: 'known', count: 0 } },
      {
        runtimeId: 'runtime-expected',
        providerAgentSessions: {
          state: 'unknown',
          reason: 'provider-agent-inventory-unavailable',
          lowerBound: -1
        }
      },
      {
        runtimeId: 'runtime-expected',
        providerAgentSessions: {
          state: 'unknown',
          reason: 'provider-agent-inventory-unavailable',
          lowerBound: 10_001
        }
      },
      {
        runtimeId: 'runtime-expected',
        providerAgentSessions: {
          state: 'unknown',
          reason: 'provider-agent-inventory-unavailable',
          lowerBound: 1.5
        }
      }
    ]) {
      fixture.response = invalid
      expect(await observeLocalRuntimeProviderChildren('/private-fixture')).toBe(0)
    }
  })

  it('leaves evidence absent on missing metadata, a quiet runtime, or failed authenticated transport', async () => {
    fixture.metadata = null
    expect(await observeLocalRuntimeProviderChildren('/private-fixture')).toBe(0)
    expect(fixture.calls).toHaveLength(0)
    fixture.metadata = {
      runtimeId: 'runtime-expected',
      authToken: 'private-fixture',
      pid: 128,
      transports: []
    }
    fixture.response = {
      runtimeId: 'runtime-expected',
      providerAgentSessions: { state: 'unknown', reason: 'provider-agent-inventory-unavailable' }
    }
    expect(await observeLocalRuntimeProviderChildren('/private-fixture')).toBe(0)
    fixture.fail = true
    expect(await observeLocalRuntimeProviderChildren('/private-fixture')).toBe(0)
  })
})
