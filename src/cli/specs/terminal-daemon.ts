import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TERMINAL_DAEMON_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['terminal-daemon', 'status'],
    summary:
      'Report whether the terminal daemon is running, its process ceiling, and whether it still has its program files',
    usage: 'ash-ide terminal-daemon status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'The daemon is reported live, exited, or unverifiable. Ash starts a new daemon with the next terminal after one exits, so exited between a crash and that terminal is expected.',
      'For a live daemon it also reports the terminal process ceiling: on with its limit, or off with the reason.',
      'On Linux AppImage, a daemon can outlive the files it runs from. Ash keeps it so its terminals keep running, but new terminals are not kept across restarts until it is restarted.'
    ],
    examples: ['ash-ide terminal-daemon status --json']
  },
  {
    path: ['terminal-daemon', 'restart'],
    destructive: true,
    summary: 'Restart a terminal daemon whose program files are gone',
    usage: 'ash-ide terminal-daemon restart --yes [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'yes'],
    notes: [
      'Restarting ENDS every process running in its terminals. Agents that support resume can be resumed afterwards; shells and other jobs must be started again.',
      'The host re-checks that the daemon is still the one reported by status before stopping it, and refuses otherwise.'
    ],
    examples: ['ash-ide terminal-daemon restart --yes']
  },
  {
    path: ['terminal-daemon', 'stop'],
    destructive: true,
    summary: 'Preview and stop all sessions hosted by the local terminal daemon',
    usage: 'ash-ide terminal-daemon stop [--yes] [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'yes', 'force'],
    notes: [
      'Without --yes, prints the current live-session inventory and performs no stop. The host rechecks both the daemon incarnation and every session incarnation after confirmation.',
      'Graceful stop is the default. --force --yes immediately kills live PTY process groups on supported Unix hosts.',
      'This command stops the terminal daemon and its sessions. ash-ide runtime stop closes the authenticated Ash desktop runtime while leaving the terminal daemon and sessions running.'
    ],
    examples: [
      'ash-ide terminal-daemon stop',
      'ash-ide terminal-daemon stop --yes',
      'ash-ide terminal-daemon stop --force --yes'
    ]
  }
]
