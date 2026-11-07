import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../../../daemon/protocol/daemon-session-info'
import {
  sameLiveSessionInventory,
  toLiveSessionInventory
} from './terminal-daemon'

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'session-1',
    incarnationId: 'incarnation-1',
    state: 'running',
    shellState: 'ready',
    isAlive: true,
    pid: 5012,
    cwd: '/tmp/ash-fixture',
    cols: 80,
    rows: 24,
    createdAt: 1793981775000,
    ...overrides
  }
}

describe('terminal daemon stop inventory', () => {
  it('exposes only live session identity and safe display fields', () => {
    expect(
      toLiveSessionInventory([
        session({ foregroundProcess: 'zsh' }),
        session({ sessionId: 'exited', isAlive: false, pid: null })
      ])
    ).toEqual([
      {
        sessionId: 'session-1',
        incarnationId: 'incarnation-1',
        pid: 5012,
        createdAt: 1793981775000,
        cwd: '/tmp/ash-fixture',
        foregroundProcess: 'zsh'
      }
    ])
  })

  it('refuses a live session without a verifiable process incarnation', () => {
    expect(toLiveSessionInventory([session({ incarnationId: undefined })])).toBeNull()
  })

  it('accepts an unchanged confirmed inventory and rejects replacement or new sessions', () => {
    const current = [session()]
    const expected = [
      {
        sessionId: 'session-1',
        incarnationId: 'incarnation-1',
        pid: 5012,
        createdAt: 1793981775000,
        cwd: '/tmp/ash-fixture',
        foregroundProcess: null
      }
    ]
    expect(sameLiveSessionInventory(current, expected)).toBe(true)
    expect(
      sameLiveSessionInventory([session({ incarnationId: 'incarnation-2' })], expected)
    ).toBe(false)
    expect(sameLiveSessionInventory([session({ cwd: '/tmp/other' })], expected)).toBe(false)
    expect(sameLiveSessionInventory([...current, session({ sessionId: 'session-2' })], expected)).toBe(
      false
    )
  })
})
