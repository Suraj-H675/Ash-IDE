import { describe, expect, it } from 'vitest'
import { TerminalDaemonStopParams } from './terminal-daemon-params'

describe('terminal daemon stop incarnation', () => {
  const expectedIdentity = {
    pid: 461036,
    startedAtMs: 1793981775335.2798,
    launchNonce: '07f1e50e-a5cf-4386-9f5a-20621f395516'
  }
  const expectedSessions = [
    {
      sessionId: 'session-1',
      incarnationId: 'incarnation-1',
      pid: 461100,
      createdAt: 1793981775000,
      cwd: '/tmp/ash-fixture',
      foregroundProcess: null
    }
  ]

  it('accepts an observed fractional-millisecond process incarnation without rounding it', () => {
    const parsed = TerminalDaemonStopParams.parse({
      confirmed: true,
      expectedIdentity,
      expectedSessions,
      mode: 'graceful'
    })
    expect(parsed.expectedIdentity).toEqual(expectedIdentity)
    expect(parsed.expectedSessions).toEqual(expectedSessions)
  })

  it.each([-1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid process start value %s',
    (startedAtMs) => {
      expect(() =>
        TerminalDaemonStopParams.parse({
          confirmed: true,
          expectedIdentity: { ...expectedIdentity, startedAtMs },
          expectedSessions,
          mode: 'graceful'
        })
      ).toThrow()
    }
  )

  it('requires a stable incarnation identity for every confirmed session', () => {
    expect(() =>
      TerminalDaemonStopParams.parse({
        confirmed: true,
        expectedIdentity,
        expectedSessions: [{ ...expectedSessions[0], incarnationId: '' }],
        mode: 'graceful'
      })
    ).toThrow()
  })
})
