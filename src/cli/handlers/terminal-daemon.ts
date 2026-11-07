import type { CommandHandler } from '../dispatch'
import {
  describePtyProcessCeiling,
  type PtyProcessCeilingState
} from '../../shared/terminal/pty/native-process/pty-process-ceiling-state'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

type SeveredDaemonStatus = {
  pid: number
  linuxStartTicks: string
  bootId: string
  liveSessionCount: number | null
}

type DaemonLiveness = {
  verdict: 'live' | 'unverifiable' | 'exited'
  pid: number | null
  detail: string
  processCeiling: PtyProcessCeilingState | null
  identity?: { pid: number; startedAtMs: number; launchNonce: string } | null
}

type LiveTerminal = {
  sessionId: string
  incarnationId: string
  pid: number
  createdAt: number
  cwd: string | null
  foregroundProcess: string | null
}

/** `daemon` is absent from hosts that predate the liveness report. */
type SeveredStatusResult = {
  severed: SeveredDaemonStatus | null
  daemon?: DaemonLiveness
  sessions?: LiveTerminal[] | null
  forceSupported?: boolean
}

type RestartResult =
  | { status: 'restarted'; killedCount: number }
  | { status: 'refused'; reason: 'not-severed' | 'replaced' | 'unverifiable' }

const REFUSAL_MESSAGES: Record<Extract<RestartResult, { status: 'refused' }>['reason'], string> = {
  'not-severed': 'The terminal daemon has its program files; nothing to restart.',
  replaced: 'The terminal daemon was already replaced; nothing was stopped.',
  unverifiable: 'The host could not verify the daemon process, so nothing was stopped.'
}

function describeSessions(count: number | null): string {
  return count === null
    ? 'an unknown number of running terminals'
    : `${count} running terminal${count === 1 ? '' : 's'}`
}

function formatDaemonLiveness(daemon: DaemonLiveness | undefined): string[] {
  if (!daemon) {
    return [
      'Terminal daemon: unverifiable — this Ash server does not report whether it is running.'
    ]
  }
  const lines = [
    `Terminal daemon: ${daemon.verdict}${daemon.pid === null ? '' : ` (pid ${daemon.pid})`} — ${daemon.detail}.`
  ]
  if (daemon.verdict === 'live') {
    lines.push(`Terminal process ceiling: ${describePtyProcessCeiling(daemon.processCeiling)}`)
  }
  return lines
}

function formatLiveTerminals(sessions: readonly LiveTerminal[]): string[] {
  if (sessions.length === 0) {
    return ['Live terminals: none.']
  }
  return [
    `Live terminals (${sessions.length}):`,
    ...sessions.map((session) => {
      const process = session.foregroundProcess ? `, process ${session.foregroundProcess}` : ''
      const cwd = session.cwd ? `, cwd ${session.cwd}` : ''
      return `  ${session.sessionId}: pid ${session.pid}${process}${cwd}`
    })
  ]
}

export function formatSeveredDaemonStatus(result: SeveredStatusResult): string {
  const severed = result.severed
  const liveness = formatDaemonLiveness(result.daemon)
  // An exited daemon hosts nothing; do not print stale severed-state details.
  if (!severed || result.daemon?.verdict === 'exited') {
    return liveness.join('\n')
  }
  return [
    `Terminal daemon PID ${severed.pid} is running without its program files (the AppImage it started from is gone).`,
    `It still hosts ${describeSessions(severed.liveSessionCount)}. New terminals are not kept across restarts until it is restarted.`,
    'Restarting ENDS those processes. Agents that support resume can be resumed afterwards; shells and other jobs cannot.',
    'Run `ash-ide terminal-daemon restart --yes` when your agents are idle.',
    ...liveness
  ].join('\n')
}

export const TERMINAL_DAEMON_HANDLERS: Record<string, CommandHandler> = {
  'terminal-daemon status': async ({ client, json }) => {
    const result = await client.call<SeveredStatusResult>('terminalDaemon.severedStatus')
    printResult(result, json, (value) =>
      [
        formatSeveredDaemonStatus(value),
        ...(value.sessions ? formatLiveTerminals(value.sessions) : [])
      ].join('\n')
    )
  },
  'terminal-daemon restart': async ({ client, json, flags }) => {
    const status = await client.call<SeveredStatusResult>('terminalDaemon.severedStatus')
    const severed = status.result.severed
    if (!severed) {
      printResult(status, json, () => REFUSAL_MESSAGES['not-severed'])
      return
    }
    if (flags.get('yes') !== true) {
      throw new RuntimeClientError(
        'confirmation_required',
        `Restarting the terminal daemon ends ${describeSessions(severed.liveSessionCount)}. Re-run with --yes to confirm.`
      )
    }
    const result = await client.call<RestartResult>('terminalDaemon.restartSevered', {
      pid: severed.pid,
      linuxStartTicks: severed.linuxStartTicks,
      bootId: severed.bootId
    })
    printResult(result, json, (value) =>
      value.status === 'restarted'
        ? `Restarted the terminal daemon; ended ${describeSessions(value.killedCount)}.`
        : REFUSAL_MESSAGES[value.reason]
    )
  },
  'terminal-daemon stop': async ({ client, json, flags }) => {
    const status = await client.call<SeveredStatusResult>('terminalDaemon.severedStatus')
    const daemon = status.result.daemon
    const identity = daemon?.identity
    if (
      daemon?.verdict !== 'live' ||
      daemon.pid === null ||
      !identity ||
      identity.pid !== daemon.pid
    ) {
      const message =
        'The terminal host could not verify its live process incarnation, so nothing was stopped.'
      console.log(
        json ? JSON.stringify({ status: 'refused', reason: 'unverifiable' }, null, 2) : message
      )
      return
    }
    const sessions = status.result.sessions
    if (sessions === null || sessions === undefined) {
      const message =
        'The terminal host could not verify every live session, so nothing was stopped.'
      console.log(
        json ? JSON.stringify({ status: 'refused', reason: 'unverifiable' }, null, 2) : message
      )
      return
    }
    const mode = flags.get('force') === true ? 'force' : 'graceful'
    const expectedSessions = sessions.map(
      ({ sessionId, incarnationId, pid, createdAt, cwd, foregroundProcess }) => ({
        sessionId,
        incarnationId,
        pid,
        createdAt,
        cwd,
        foregroundProcess
      })
    )
    if (mode === 'force' && status.result.forceSupported === false) {
      const result = { status: 'force-unavailable' as const }
      console.log(
        json
          ? JSON.stringify(result, null, 2)
          : 'Force stop is not supported on this terminal host; nothing was stopped.'
      )
      return
    }
    if (flags.get('yes') !== true) {
      const preview = {
        status: 'confirmation-required',
        mode,
        liveSessions: sessions
      }
      console.log(
        json
          ? JSON.stringify(preview, null, 2)
          : [
              `Stopping the terminal daemon will end ${describeSessions(sessions.length)}.`,
              ...formatLiveTerminals(sessions),
              mode === 'force'
                ? 'Force mode immediately kills live PTY process groups.'
                : 'Graceful mode asks each terminal process group to exit before the daemon closes.',
              'Re-run with --yes to confirm.'
            ].join('\n')
      )
      return
    }
    const result = await client.call<
      | { status: 'stopped'; killedCount: number; mode: 'graceful' | 'force' }
      | { status: 'changed'; sessions: LiveTerminal[] | null }
      | { status: 'replaced' | 'unverifiable' | 'force-unavailable' }
    >('terminalDaemon.stop', {
      confirmed: true,
      expectedIdentity: identity,
      expectedSessions,
      mode
    })
    printResult(result, json, (value) =>
      value.status === 'stopped'
        ? `${mode === 'force' ? 'Force-stopped' : 'Gracefully stopped'} the terminal daemon and ended ${describeSessions(value.killedCount)}.`
        : value.status === 'changed'
          ? [
              'The live terminal inventory changed after confirmation, so nothing was stopped.',
              ...(value.sessions
                ? formatLiveTerminals(value.sessions)
                : ['The updated inventory is unverifiable.']),
              'Review the current sessions and confirm again.'
            ].join('\n')
          : value.status === 'force-unavailable'
            ? 'Force stop is not supported on this terminal host; nothing was stopped.'
            : `The terminal host ${value.status === 'replaced' ? 'was replaced' : 'could not be verified'}, so nothing was stopped.`
    )
  }
}
