import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  identity: { pid: 712, startedAtMs: 1793981775335.2798, launchNonce: 'nonce-a' } as {
    pid: number
    startedAtMs: number
    launchNonce: string
  } | null,
  sessions: null as null | Array<{
    sessionId: string
    incarnationId: string
    state: string
    shellState: string
    isAlive: boolean
    pid: number | null
    cwd: string | null
    cols: number
    rows: number
    createdAt: number
    foregroundProcess?: string | null
  }>,
  shutdown: vi.fn(async () => true)
}))

vi.mock('../../../daemon/providers/lifecycle/daemon-provider-state', () => ({
  getCurrentDaemonIdentity: () => state.identity,
  listLiveDaemonSessions: async () => state.sessions,
  shutdownDaemon: state.shutdown
}))
vi.mock('../../../daemon/providers/lifecycle/daemon-host-image-state', () => ({
  readSeveredDaemonStatus: async () => null,
  restartSeveredDaemon: async () => ({ status: 'restarted', killedCount: 0 })
}))

import { TERMINAL_DAEMON_METHODS } from './terminal-daemon'
import { TerminalDaemonStopParams } from '../../../../shared/rpc-contract/terminal-daemon-params'

const stopHandler = TERMINAL_DAEMON_METHODS.find(
  ({ name }) => name === 'terminalDaemon.stop'
) as Extract<(typeof TERMINAL_DAEMON_METHODS)[number], { name: 'terminalDaemon.stop' }>
const expectedIdentity = {
  pid: 712,
  startedAtMs: 1793981775335.2798,
  launchNonce: 'nonce-a'
}
const session = {
  sessionId: 'session-a',
  incarnationId: 'incarnation-a',
  state: 'running',
  shellState: 'ready',
  isAlive: true,
  pid: 812,
  cwd: '/tmp/ash-stop-fixture',
  cols: 80,
  rows: 24,
  createdAt: 1793981775335.5,
  foregroundProcess: 'zsh'
}
const expectedSessions = [
  {
    sessionId: session.sessionId,
    incarnationId: session.incarnationId,
    pid: session.pid,
    createdAt: session.createdAt,
    cwd: session.cwd,
    foregroundProcess: session.foregroundProcess
  }
]

async function stop(mode: 'graceful' | 'force' = 'graceful'): Promise<unknown> {
  return stopHandler.handler(
    { confirmed: true, expectedIdentity, expectedSessions, mode },
    { runtime: {} } as never
  )
}

describe('terminalDaemon.stop', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    state.identity = { ...expectedIdentity }
    state.sessions = [session]
    state.shutdown.mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('stops only after the exact daemon and live session inventory still match', async () => {
    await expect(stop()).resolves.toEqual({ status: 'stopped', killedCount: 1, mode: 'graceful' })
    expect(state.shutdown).toHaveBeenCalledWith(expectedIdentity, 'graceful')
  })

  it('refuses a replaced daemon before reading or stopping its sessions', async () => {
    state.identity = { ...expectedIdentity, launchNonce: 'nonce-b' }

    await expect(stop()).resolves.toEqual({ status: 'replaced' })
    expect(state.shutdown).not.toHaveBeenCalled()
  })

  it('refuses when live sessions cannot be inventoried or changed since preview', async () => {
    state.sessions = null
    await expect(stop()).resolves.toEqual({ status: 'unverifiable' })
    expect(state.shutdown).not.toHaveBeenCalled()

    state.sessions = [{ ...session, cwd: '/tmp/replaced-session' }]
    await expect(stop()).resolves.toMatchObject({ status: 'changed' })
    expect(state.shutdown).not.toHaveBeenCalled()
  })

  it('uses the confirmed force mode on supported Unix hosts', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })

    await expect(stop('force')).resolves.toEqual({
      status: 'stopped',
      killedCount: 1,
      mode: 'force'
    })
    expect(state.shutdown).toHaveBeenCalledWith(expectedIdentity, 'force')
  })

  it('refuses force mode on Windows without stopping the daemon', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    await expect(stop('force')).resolves.toEqual({ status: 'force-unavailable' })
    expect(state.shutdown).not.toHaveBeenCalled()
  })
})

describe('terminalDaemon.stop confirmation contract', () => {
  it('requires explicit confirmation in the authenticated RPC request', () => {
    const params = { confirmed: true, expectedIdentity, expectedSessions, mode: 'graceful' }
    expect(TerminalDaemonStopParams.safeParse(params).success).toBe(true)
    expect(TerminalDaemonStopParams.safeParse({ ...params, confirmed: undefined }).success).toBe(
      false
    )
  })
})
