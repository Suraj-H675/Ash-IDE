import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrcaRuntimeService as RealOrcaRuntimeService } from '../../orca-runtime'
import { fixture as disposableProfileStore } from '../../../persistence/loading-store/profile-state-delayed-authority-fixture'
import { readRuntimeMetadataAsync } from '../server/runtime-metadata'
import { RpcDispatcher } from '../dispatcher'
import { sendOrcadSidecarRequest } from '../../../orcad/orcad-sidecar-runtime-client'
import { observeLocalRuntimeProviderChildren } from '../../../updater/update-runtime-provider-socket-observation'
import { collectAshUpdateRuntimeCensus } from '../../../updater/update-runtime-ash-census'
import {
  NO_STAGED_UPDATE_CANDIDATE,
  assessUpdatePreflight
} from '../../../updater/update-preflight'
import { ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS } from './ash-runtime-provider-activity'

const fixture = vi.hoisted(() => ({
  count: 2,
  fails: false,
  ptyCount: 0,
  ownerCount: 0,
  ptyFails: false,
  browserAvailable: false,
  onPtyRead: null as (() => void) | null
}))

vi.mock('../../../orcad/orcad-browser-backend-positive-evidence', () => ({
  observedHostedBrowserBackend: () => (fixture.browserAvailable ? 1 : 0)
}))

vi.mock(
  '../../../native-chat/agent-session-wire/structured-agent-session-positive-evidence',
  () => ({
    observedHostedStructuredAgentChildren: () => {
      if (fixture.fails) {
        throw new Error('unreadable local status projection')
      }
      return fixture.count
    }
  })
)

vi.mock('../../../updater/update-runtime-connected-pty-evidence', () => ({
  observeConnectedPtyPositiveEvidence: async () => {
    fixture.onPtyRead?.()
    if (fixture.ptyFails) {
      throw new Error('disconnected daemon')
    }
    return { ptySessions: fixture.ptyCount, ptyOwnedAgentSessions: fixture.ownerCount }
  }
}))

afterEach(() => {
  fixture.count = 2
  fixture.fails = false
  fixture.ptyCount = 0
  fixture.ownerCount = 0
  fixture.ptyFails = false
  fixture.browserAvailable = false
  fixture.onPtyRead = null
})

describe('authenticated runtime provider-native activity RPC', () => {
  const runtime = { getRuntimeId: () => 'tested-runtime' } as OrcaRuntimeService

  it('publishes only a positive lower bound and the actual runtime ID', async () => {
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
    })
    const answer = await dispatcher.dispatch({
      id: 'probe',
      authToken: 'owner-token',
      method: 'runtime.providerActivity'
    })
    expect(answer).toMatchObject({
      ok: true,
      result: {
        runtimeId: 'tested-runtime',
        browserBackends: {
          state: 'unknown',
          reason: 'browser-backend-inventory-unavailable',
          lowerBound: 0
        },
        pendingDiskWrites: {
          state: 'unknown',
          reason: 'pending-write-census-unavailable',
          lowerBound: 0
        },
        ptys: { state: 'unknown', reason: 'inventory-partial', lowerBound: 0 },
        ptyOwnedAgentSessions: {
          state: 'unknown',
          reason: 'agent-owner-inventory-incomplete',
          lowerBound: 0
        },
        providerAgentSessions: {
          state: 'unknown',
          reason: 'provider-agent-inventory-unavailable',
          lowerBound: 2
        }
      }
    })
    expect(JSON.stringify(answer)).not.toContain('sessionId')
    expect(JSON.stringify(answer)).not.toContain('authToken')
  })

  it('cannot report a complete or known-zero provider census on absence or failure', async () => {
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
    })
    for (const mode of ['zero', 'unreadable'] as const) {
      fixture.count = 0
      fixture.fails = mode === 'unreadable'
      const answer = await dispatcher.dispatch({
        id: mode,
        authToken: 'owner-token',
        method: 'runtime.providerActivity'
      })
      expect(answer).toMatchObject({
        ok: true,
        result: {
          providerAgentSessions: {
            state: 'unknown',
            reason: 'provider-agent-inventory-unavailable'
          }
        }
      })
      if (answer.ok) {
        expect(answer.result).not.toHaveProperty('providerAgentSessions.lowerBound')
      }
    }
  })

  it('surfaces a positive connected-daemon PTY and owner count as unknown, without revealing identities', async () => {
    fixture.ptyCount = 3
    fixture.ownerCount = 2
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
    })
    const answer = await dispatcher.dispatch({
      id: 'observed-ptys',
      authToken: 'owner-token',
      method: 'runtime.providerActivity'
    })
    expect(answer).toMatchObject({
      ok: true,
      result: {
        ptys: { state: 'unknown', reason: 'inventory-partial', lowerBound: 3 },
        ptyOwnedAgentSessions: {
          state: 'unknown',
          reason: 'agent-owner-inventory-incomplete',
          lowerBound: 2
        }
      }
    })
    expect(JSON.stringify(answer)).not.toContain('sessionId')
  })

  it('retains positive native provider evidence if the connected-daemon read fails', async () => {
    fixture.ptyFails = true
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
    })
    expect(
      await dispatcher.dispatch({
        id: 'failed-daemon',
        authToken: 'owner-token',
        method: 'runtime.providerActivity'
      })
    ).toMatchObject({
      ok: true,
      result: {
        providerAgentSessions: { state: 'unknown', lowerBound: 2 },
        ptys: { state: 'unknown', lowerBound: 0 }
      }
    })
  })

  it.each(['admitted-during-read', 'retired-during-read'] as const)(
    'retains a positive headless browser backend %s across the asynchronous daemon census',
    async (phase) => {
      fixture.browserAvailable = phase === 'retired-during-read'
      fixture.onPtyRead = () => {
        fixture.browserAvailable = phase === 'admitted-during-read'
      }
      const dispatcher = new RpcDispatcher({
        runtime,
        methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
      })
      expect(
        await dispatcher.dispatch({
          id: phase,
          authToken: 'owner-token',
          method: 'runtime.providerActivity'
        })
      ).toMatchObject({
        ok: true,
        result: {
          browserBackends: {
            state: 'unknown',
            reason: 'browser-backend-inventory-unavailable',
            lowerBound: 1
          }
        }
      })
    }
  )

  it.each(['admitted-during-read', 'drained-during-read'] as const)(
    'retains a Store write %s across an asynchronous daemon observation',
    async (phase) => {
      let writing = phase === 'drained-during-read'
      const host = {
        getRuntimeId: () => 'runtime-writing',
        hasObservedPendingLocalProfileWrite: () => writing
      } as OrcaRuntimeService
      fixture.onPtyRead = () => {
        writing = phase === 'admitted-during-read'
      }
      const dispatcher = new RpcDispatcher({
        runtime: host,
        methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
      })
      expect(
        await dispatcher.dispatch({
          id: phase,
          authToken: 'owner-token',
          method: 'runtime.providerActivity'
        })
      ).toMatchObject({
        ok: true,
        result: {
          pendingDiskWrites: { state: 'unknown', lowerBound: 1 }
        }
      })
    }
  )

  it('observes a real paused SQLite Store write on the host runtime without flushing it', async () => {
    const { store, authority, readState } = await disposableProfileStore()
    const live = new RealOrcaRuntimeService(store)
    const dispatcher = new RpcDispatcher({
      runtime: live,
      methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
    })
    const request = {
      id: 'real-store',
      authToken: 'owner-token',
      method: 'runtime.providerActivity'
    }
    expect((await dispatcher.dispatch(request)).ok).toBe(true)
    expect(live.hasObservedPendingLocalProfileWrite()).toBe(false)
    const next = !store.getSettings().agentStatusHooksEnabled
    const gate = authority.pause()
    store.updateSettings({ agentStatusHooksEnabled: next })
    const flushing = store.flushPendingOrThrowAsync()
    await gate.started.promise
    try {
      expect(await dispatcher.dispatch(request)).toMatchObject({
        ok: true,
        result: {
          pendingDiskWrites: {
            state: 'unknown',
            reason: 'pending-write-census-unavailable',
            lowerBound: 1
          }
        }
      })
      expect(readState().settings.agentStatusHooksEnabled).not.toBe(next)
    } finally {
      gate.finish.resolve()
    }
    await flushing
    expect(readState().settings.agentStatusHooksEnabled).toBe(next)
    expect(await dispatcher.dispatch(request)).toMatchObject({
      ok: true,
      result: { pendingDiskWrites: { state: 'unknown', lowerBound: 0 } }
    })
  })

  it('refuses non-local runtime clients even if they have a broad RPC grant', async () => {
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS
    })
    const request = {
      id: 'remote',
      authToken: 'paired-token',
      method: 'runtime.providerActivity'
    }
    await expect(dispatcher.dispatch(request, { clientKind: 'runtime' })).resolves.toMatchObject({
      ok: false
    })
    await expect(
      dispatcher.dispatch(request, { pairedDeviceId: 'another-client' })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      dispatcher.dispatch(request, { callerScope: { kind: 'mobile' }, clientKind: 'mobile' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})

it.skipIf(process.platform !== 'linux')(
  'reads a separate live Ash runtime through the authenticated local socket, not a UI mock',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-provider-activity-socket-'))
    const script = [
      "const { OrcaRuntimeRpcServer } = require('./src/main/runtime/rpc/server/runtime-rpc.ts')",
      "const { OrcaRuntimeService } = require('./src/main/runtime/orca-runtime.ts')",
      "const { ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS } = require('./src/main/runtime/rpc/methods/ash-runtime-provider-activity.ts')",
      "const { registerHostedBrowserBackendProbe } = require('./src/main/orcad/orcad-browser-backend-positive-evidence.ts')",
      'registerHostedBrowserBackendProbe(() => true)',
      "const { setStructuredAgentSessionHost } = require('./src/main/native-chat/agent-session-wire/structured-agent-session-registry.ts')",
      "setStructuredAgentSessionHost({ loadedSessionIds: () => ['private-provider-child', 'resting-chat'], readStatusSummary: (id) => ({ hostExecutionOwned: id === 'private-provider-child' }) })",
      'const runtime = new OrcaRuntimeService()',
      'runtime.hasObservedPendingLocalProfileWrite = () => true',
      'const server = new OrcaRuntimeRpcServer({ runtime, userDataPath: process.argv[1], methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS })',
      "server.start().then(() => { process.stdout.write('ready\\n') }, (error) => { console.error(error); process.exitCode = 2 })",
      "process.on('SIGTERM', () => { void server.stop().finally(() => process.exit(0)) })"
    ].join('\n')
    const child: ChildProcessWithoutNullStreams = spawn(
      process.execPath,
      ['--import', 'tsx', '-e', script, root],
      { cwd: process.cwd(), stdio: 'pipe' }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (part: string) => {
      stdout += part
    })
    child.stderr.on('data', (part: string) => {
      stderr += part
    })
    try {
      await vi.waitFor(() => expect(stdout).toContain('ready\n'), { timeout: 15_000 })
      const metadata = await readRuntimeMetadataAsync(root)
      expect(metadata).not.toBeNull()
      if (!metadata) {
        throw new Error('Missing authenticated runtime metadata')
      }
      const response = await sendOrcadSidecarRequest(
        metadata,
        'runtime.providerActivity',
        undefined,
        5_000
      )
      expect(response).toEqual({
        runtimeId: metadata.runtimeId,
        browserBackends: {
          state: 'unknown',
          reason: 'browser-backend-inventory-unavailable',
          lowerBound: 1
        },
        ptys: { state: 'unknown', reason: 'inventory-partial', lowerBound: 0 },
        ptyOwnedAgentSessions: {
          state: 'unknown',
          reason: 'agent-owner-inventory-incomplete',
          lowerBound: 0
        },
        pendingDiskWrites: {
          state: 'unknown',
          reason: 'pending-write-census-unavailable',
          lowerBound: 1
        },
        providerAgentSessions: {
          state: 'unknown',
          reason: 'provider-agent-inventory-unavailable',
          lowerBound: 1
        }
      })
      expect(JSON.stringify(response)).not.toContain('private-provider-child')
      fixture.count = 0
      expect(await observeLocalRuntimeProviderChildren(root)).toBe(1)
      const combined = await collectAshUpdateRuntimeCensus(
        () => 0,
        () => false,
        root
      )
      expect(combined.providerAgentSessions).toEqual({
        state: 'unknown',
        reason: 'provider-agent-inventory-unavailable',
        lowerBound: 1
      })
      expect(combined.pendingDiskWrites).toEqual({
        state: 'unknown',
        reason: 'pending-write-census-unavailable',
        lowerBound: 1
      })
      expect(combined.browserBackends).toEqual({
        state: 'unknown',
        reason: 'browser-backend-inventory-unavailable',
        lowerBound: 1
      })
      const preflight = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, combined)
      expect(preflight.decision).toBe('busy')
      expect(preflight.blockers).toEqual(
        expect.arrayContaining([
          'provider-agent-session-observed',
          'provider-agent-inventory-unknown',
          'browser-backend-observed',
          'browser-backend-inventory-unknown'
        ])
      )
      expect(preflight.activationAvailable).toBe(false)
      await expect(
        sendOrcadSidecarRequest(
          { ...metadata, authToken: 'not-the-real-auth-token' },
          'runtime.providerActivity',
          undefined,
          5_000
        )
      ).rejects.toThrow()
    } finally {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 4_000))
      ])
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
      rmSync(root, { recursive: true, force: true })
    }
    expect(stderr).not.toMatch(/Error:|UnhandledPromiseRejection/)
  },
  25_000
)
