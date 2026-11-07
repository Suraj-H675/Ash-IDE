import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'
import { RUNTIME_HANDLERS } from './runtime'

const LIVE_SESSION = {
  sessionId: 'fixture-shell',
  incarnationId: 'fixture-incarnation',
  pid: 9021,
  createdAt: 1793981775000,
  cwd: '/tmp/ash-fixture',
  foregroundProcess: 'zsh'
}

function context(
  flags: Map<string, string | boolean>,
  call: ReturnType<typeof vi.fn>
): HandlerContext {
  return {
    flags,
    client: { call } as unknown as RuntimeClient,
    cwd: '/tmp/ash-fixture',
    json: false
  }
}

describe('runtime stop CLI', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('previews active terminal sessions without stopping the Ash runtime', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return { result: { runtimeId: 'runtime-a' } }
      }
      return { result: { sessions: [LIVE_SESSION] } }
    })
    await RUNTIME_HANDLERS['runtime stop']?.(context(new Map(), call))
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'status.get',
      'terminalDaemon.severedStatus'
    ])
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('will remain running'))
  })

  it('fences a confirmed stop to the runtime incarnation and leaves terminals independent', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return { result: { runtimeId: 'runtime-a' } }
      }
      if (method === 'terminalDaemon.severedStatus') {
        return { result: { sessions: [LIVE_SESSION] } }
      }
      return { result: { status: 'stopping', mode: 'graceful', runtimeId: 'runtime-a' } }
    })
    await RUNTIME_HANDLERS['runtime stop']?.(context(new Map([['yes', true]]), call))
    expect(call).toHaveBeenLastCalledWith('runtime.stop', {
      confirmed: true,
      expectedRuntimeId: 'runtime-a',
      mode: 'graceful'
    })
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Terminal sessions remain running')
    )
  })

  it('keeps force runtime exit separate from terminal-daemon stop', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return { result: { runtimeId: 'runtime-a' } }
      }
      if (method === 'terminalDaemon.severedStatus') {
        return { result: { sessions: [LIVE_SESSION] } }
      }
      return { result: { status: 'stopping', mode: 'force', runtimeId: 'runtime-a' } }
    })

    await RUNTIME_HANDLERS['runtime stop']?.(
      context(
        new Map([
          ['yes', true],
          ['force', true]
        ]),
        call
      )
    )

    expect(call).toHaveBeenLastCalledWith('runtime.stop', {
      confirmed: true,
      expectedRuntimeId: 'runtime-a',
      mode: 'force'
    })
    expect(call.mock.calls.some(([method]) => method === 'terminalDaemon.stop')).toBe(false)
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Terminal sessions remain running')
    )
  })
})
