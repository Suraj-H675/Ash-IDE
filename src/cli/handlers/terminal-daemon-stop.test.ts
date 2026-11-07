import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'
import { TERMINAL_DAEMON_HANDLERS } from './terminal-daemon'

const daemonIdentity = {
  pid: 712,
  startedAtMs: 1793981775335.2798,
  launchNonce: 'nonce-a'
}
const liveSession = {
  sessionId: 'session-a',
  incarnationId: 'incarnation-a',
  pid: 812,
  createdAt: 1793981775335.5,
  cwd: '/tmp/ash-stop-fixture',
  foregroundProcess: 'zsh'
}

function context(
  flags: Map<string, string | boolean>,
  call: ReturnType<typeof vi.fn>,
  json = false
): HandlerContext {
  return {
    flags,
    client: { call } as unknown as RuntimeClient,
    cwd: '/tmp/ash-stop-fixture',
    json
  }
}

describe('terminal-daemon stop CLI', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('previews the live inventory and requires an explicit yes before stopping', async () => {
    const call = vi.fn(async () => ({
      result: {
        daemon: { verdict: 'live', pid: daemonIdentity.pid, identity: daemonIdentity },
        sessions: [liveSession],
        forceSupported: true
      }
    }))

    await TERMINAL_DAEMON_HANDLERS['terminal-daemon stop']?.(context(new Map(), call))

    expect(call.mock.calls).toEqual([['terminalDaemon.severedStatus']])
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('session-a'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Re-run with --yes'))
  })

  it('sends the reviewed daemon and session incarnations for graceful stop after yes', async () => {
    const call = vi.fn(async (method: string) =>
      method === 'terminalDaemon.severedStatus'
        ? {
            result: {
              daemon: { verdict: 'live', pid: daemonIdentity.pid, identity: daemonIdentity },
              sessions: [liveSession],
              forceSupported: true
            }
          }
        : { result: { status: 'stopped', killedCount: 1, mode: 'graceful' } }
    )

    await TERMINAL_DAEMON_HANDLERS['terminal-daemon stop']?.(
      context(new Map([['yes', true]]), call)
    )

    expect(call).toHaveBeenLastCalledWith('terminalDaemon.stop', {
      confirmed: true,
      expectedIdentity: daemonIdentity,
      expectedSessions: [liveSession],
      mode: 'graceful'
    })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ended 1 running terminal'))
  })

  it('does not send a force stop until the caller confirms the reviewed inventory', async () => {
    const call = vi.fn(async (method: string) =>
      method === 'terminalDaemon.severedStatus'
        ? {
            result: {
              daemon: { verdict: 'live', pid: daemonIdentity.pid, identity: daemonIdentity },
              sessions: [liveSession],
              forceSupported: true
            }
          }
        : { result: { status: 'stopped', killedCount: 1, mode: 'force' } }
    )

    await TERMINAL_DAEMON_HANDLERS['terminal-daemon stop']?.(
      context(new Map([['force', true]]), call)
    )

    expect(call.mock.calls).toEqual([['terminalDaemon.severedStatus']])
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Force mode immediately kills')
    )
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Re-run with --yes'))

    await TERMINAL_DAEMON_HANDLERS['terminal-daemon stop']?.(
      context(
        new Map([
          ['force', true],
          ['yes', true]
        ]),
        call
      )
    )

    expect(call).toHaveBeenLastCalledWith('terminalDaemon.stop', {
      confirmed: true,
      expectedIdentity: daemonIdentity,
      expectedSessions: [liveSession],
      mode: 'force'
    })
  })

  it('refuses to stop when daemon identity or the complete live inventory is unverifiable', async () => {
    const call = vi.fn(async () => ({
      result: {
        daemon: { verdict: 'live', pid: daemonIdentity.pid, identity: null },
        sessions: [liveSession],
        forceSupported: true
      }
    }))

    await TERMINAL_DAEMON_HANDLERS['terminal-daemon stop']?.(
      context(new Map([['yes', true]]), call, true)
    )

    expect(call.mock.calls).toEqual([['terminalDaemon.severedStatus']])
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ status: 'refused', reason: 'unverifiable' }, null, 2)
    )
  })

  it('does not attempt force stop when the host reports it unsupported', async () => {
    const call = vi.fn(async () => ({
      result: {
        daemon: { verdict: 'live', pid: daemonIdentity.pid, identity: daemonIdentity },
        sessions: [liveSession],
        forceSupported: false
      }
    }))

    await TERMINAL_DAEMON_HANDLERS['terminal-daemon stop']?.(
      context(
        new Map([
          ['yes', true],
          ['force', true]
        ]),
        call,
        true
      )
    )

    expect(call.mock.calls).toEqual([['terminalDaemon.severedStatus']])
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ status: 'force-unavailable' }, null, 2)
    )
  })
})
