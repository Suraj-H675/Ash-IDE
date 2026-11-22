import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
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

const fixture = vi.hoisted(() => ({ count: 2, fails: false }))

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

afterEach(() => {
  fixture.count = 2
  fixture.fails = false
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
      "const { setStructuredAgentSessionHost } = require('./src/main/native-chat/agent-session-wire/structured-agent-session-registry.ts')",
      "setStructuredAgentSessionHost({ loadedSessionIds: () => ['private-provider-child', 'resting-chat'], readStatusSummary: (id) => ({ hostExecutionOwned: id === 'private-provider-child' }) })",
      'const server = new OrcaRuntimeRpcServer({ runtime: new OrcaRuntimeService(), userDataPath: process.argv[1], methods: ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS })',
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
      const preflight = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, combined)
      expect(preflight.decision).toBe('busy')
      expect(preflight.blockers).toEqual(
        expect.arrayContaining([
          'provider-agent-session-observed',
          'provider-agent-inventory-unknown'
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
