import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const RUNTIME_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['runtime', 'stop'],
    destructive: true,
    summary: 'Close the authenticated Ash runtime while keeping terminal sessions running',
    usage: 'ash-ide runtime stop [--yes] [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'yes', 'force'],
    notes: [
      'Without --yes, prints the active terminal inventory and performs no stop.',
      'The graceful default closes Ash through its normal quit path. The independent terminal daemon and all its sessions keep running.',
      '--force --yes exits Ash immediately and may skip application cleanup; it still does not stop terminal sessions.'
    ],
    examples: ['ash-ide runtime stop', 'ash-ide runtime stop --yes']
  }
]
