import { TerminalLimitUpdateParams } from '../../../../shared/rpc-contract/terminal-limit-params'
import {
  TerminalDaemonRestartSeveredParams,
  TerminalDaemonStopParams
} from '../../../../shared/rpc-contract/terminal-daemon-params'
import {
  readSeveredDaemonStatus,
  restartSeveredDaemon
} from '../../../daemon/providers/lifecycle/daemon-host-image-state'
import {
  getCurrentDaemonIdentity,
  listLiveDaemonSessions,
  shutdownDaemon
} from '../../../daemon/providers/lifecycle/daemon-provider-state'
import { sameEndpointIdentity } from '../../../daemon/endpoint/identity/daemon-endpoint-incarnation'
import type { SessionInfo } from '../../../daemon/protocol/daemon-session-info'
import { defineMethod } from '../core'

type StopSessionIdentity = {
  sessionId: string
  incarnationId: string
  pid: number
  createdAt: number
}

type LiveSessionInventoryEntry = StopSessionIdentity & {
  cwd: string | null
  foregroundProcess: string | null
}

export function sessionStopIdentity(session: SessionInfo): StopSessionIdentity | null {
  if (
    !session.isAlive ||
    !session.incarnationId ||
    !Number.isSafeInteger(session.pid) ||
    (session.pid ?? 0) <= 0 ||
    !Number.isFinite(session.createdAt) ||
    session.createdAt < 0
  ) {
    return null
  }
  return {
    sessionId: session.sessionId,
    incarnationId: session.incarnationId,
    pid: session.pid!,
    createdAt: session.createdAt
  }
}

export function toLiveSessionInventory(
  sessions: readonly SessionInfo[]
): LiveSessionInventoryEntry[] | null {
  const live = sessions.filter((session) => session.isAlive)
  const inventory = live.map((session) => {
    const identity = sessionStopIdentity(session)
    return identity
      ? {
          ...identity,
          cwd: session.cwd,
          foregroundProcess: session.foregroundProcess ?? null
        }
      : null
  })
  return inventory.every((entry) => entry !== null)
    ? (inventory as LiveSessionInventoryEntry[])
    : null
}

export function sameLiveSessionInventory(
  current: readonly SessionInfo[],
  expected: readonly LiveSessionInventoryEntry[]
): boolean {
  const identities = current
    .filter((session) => session.isAlive)
    .map((session) => {
      const identity = sessionStopIdentity(session)
      return identity
        ? {
            ...identity,
            cwd: session.cwd,
            foregroundProcess: session.foregroundProcess ?? null
          }
        : null
    })
    .filter((identity): identity is LiveSessionInventoryEntry => identity !== null)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  const sortedExpected = [...expected].sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  return (
    identities.length === current.filter((session) => session.isAlive).length &&
    identities.length === sortedExpected.length &&
    identities.every((identity, index) => {
      const candidate = sortedExpected[index]
      return (
        identity.sessionId === candidate?.sessionId &&
        identity.incarnationId === candidate.incarnationId &&
        identity.pid === candidate.pid &&
        identity.createdAt === candidate.createdAt &&
        identity.cwd === candidate.cwd &&
        identity.foregroundProcess === candidate.foregroundProcess
      )
    })
  )
}

export const TERMINAL_DAEMON_METHODS = [
  defineMethod({
    name: 'terminalDaemon.limit',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.terminalLimit()
  }),
  defineMethod({
    name: 'terminalDaemon.setLimit',
    permission: 'host-admin',
    params: TerminalLimitUpdateParams,
    handler: async (params, { runtime }) => runtime.terminalLimit(params)
  }),
  defineMethod({
    name: 'terminalDaemon.severedStatus',
    permission: 'workspace',
    params: null,
    // Why `daemon` is additive: older CLIs read only `severed`.
    handler: async () => {
      const daemon = await (
        await import('../../../daemon/health/daemon-liveness-report')
      ).readTerminalDaemonLiveness()
      const sessions = await listLiveDaemonSessions()
      return {
        severed: await readSeveredDaemonStatus(),
        daemon: { ...daemon, identity: getCurrentDaemonIdentity() },
        sessions: sessions ? toLiveSessionInventory(sessions) : null,
        forceSupported: process.platform !== 'win32'
      }
    }
  }),
  defineMethod({
    name: 'terminalDaemon.restartSevered',
    permission: 'host-admin',
    params: TerminalDaemonRestartSeveredParams,
    handler: async (params) => restartSeveredDaemon(params)
  }),
  defineMethod({
    name: 'terminalDaemon.stop',
    permission: 'host-admin',
    params: TerminalDaemonStopParams,
    handler: async ({ expectedIdentity, expectedSessions, mode }) => {
      const currentIdentity = getCurrentDaemonIdentity()
      if (!currentIdentity || !sameEndpointIdentity(currentIdentity, expectedIdentity)) {
        return { status: 'replaced' as const }
      }
      const sessions = await listLiveDaemonSessions()
      if (sessions === null) {
        return { status: 'unverifiable' as const }
      }
      if (!sameLiveSessionInventory(sessions, expectedSessions)) {
        return {
          status: 'changed' as const,
          sessions: toLiveSessionInventory(sessions)
        }
      }
      if (mode === 'force' && process.platform === 'win32') {
        return { status: 'force-unavailable' as const }
      }
      const killedCount = expectedSessions.length
      if (!(await shutdownDaemon(expectedIdentity, mode))) {
        return { status: 'replaced' as const }
      }
      return { status: 'stopped' as const, killedCount, mode }
    }
  })
]
