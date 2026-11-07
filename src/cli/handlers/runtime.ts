import type { CommandHandler } from '../dispatch'
import type { RuntimeStatus } from '../../shared/runtime-session-contracts'
import { printResult } from '../format'

type LiveTerminal = {
  sessionId: string
  incarnationId: string
  pid: number
  createdAt: number
  cwd: string | null
  foregroundProcess: string | null
}

type TerminalDaemonStatus = {
  sessions?: LiveTerminal[] | null
  daemon?: { verdict: 'live' | 'exited' | 'unverifiable'; pid: number | null }
}

function formatRuntimeStopPreview(sessions: LiveTerminal[] | null | undefined): string[] {
  if (sessions === null || sessions === undefined) {
    return ['The terminal inventory is unavailable; Ash can close without stopping the daemon.']
  }
  if (sessions.length === 0) {
    return ['No live terminal sessions.']
  }
  return [
    `Live terminal sessions (${sessions.length}) will remain running after the Ash runtime closes:`,
    ...sessions.map((session) => {
      const process = session.foregroundProcess ? `, process ${session.foregroundProcess}` : ''
      const cwd = session.cwd ? `, cwd ${session.cwd}` : ''
      return `  ${session.sessionId}: pid ${session.pid}${process}${cwd}`
    })
  ]
}

export const RUNTIME_HANDLERS: Record<string, CommandHandler> = {
  'runtime stop': async ({ client, json, flags }) => {
    const status = await client.call<RuntimeStatus>('status.get')
    const terminalStatus = await client.call<TerminalDaemonStatus>('terminalDaemon.severedStatus')
    const sessions = terminalStatus.result.sessions
    const mode = flags.get('force') === true ? 'force' : 'graceful'
    if (flags.get('yes') !== true) {
      const preview = { status: 'confirmation-required', mode, liveSessions: sessions ?? null }
      console.log(
        json
          ? JSON.stringify(preview, null, 2)
          : [
              'This closes the authenticated Ash runtime. The independent terminal daemon and its sessions keep running.',
              ...formatRuntimeStopPreview(sessions),
              mode === 'force'
                ? 'Force mode exits Ash immediately and may skip application cleanup.'
                : 'Graceful mode lets Ash run its quit cleanup.',
              'Re-run with --yes to confirm.'
            ].join('\n')
      )
      return
    }
    const result = await client.call<
      { status: 'stopping'; mode: 'graceful' | 'force'; runtimeId: string } | { status: 'replaced' }
    >('runtime.stop', { confirmed: true, expectedRuntimeId: status.result.runtimeId, mode })
    printResult(result, json, (value) =>
      value.status === 'stopping'
        ? `${mode === 'force' ? 'Force-exiting' : 'Gracefully stopping'} the Ash runtime. Terminal sessions remain running.`
        : 'The Ash runtime incarnation changed; nothing was stopped.'
    )
  }
}
