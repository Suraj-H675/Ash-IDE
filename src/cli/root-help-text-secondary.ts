export const ROOT_HELP_TEXT_SECONDARY = [
  '',
  'Examples:',
  '  ash-ide open',
  '  ash-ide status --json',
  '  ash-ide terminal list --json',
  '  ash-ide terminal create --command codex --json',
  '  ash-ide terminal-daemon status',
  '  ash-ide terminal-daemon stop',
  '  ash-ide terminal-daemon stop --yes',
  '  ash-ide runtime stop',
  '',
  'Closing the Ash IDE window keeps the local host and its sessions running.',
  'terminal-daemon stop previews sessions; --yes ends those sessions through the daemon.',
  'runtime stop closes Ash while leaving the terminal daemon and sessions running.',
  '',
  'Run `ash-ide <command> --help` for command-specific options.'
].join('\n')
