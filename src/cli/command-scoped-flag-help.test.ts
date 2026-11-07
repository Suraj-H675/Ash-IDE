import { describe, expect, it } from 'vitest'
import { formatCommandHelp } from './help'
import { ASH_COMMAND_SPECS } from './specs'

describe('Ash stop command help', () => {
  it('keeps runtime shutdown distinct from stopping terminal sessions', () => {
    const runtimeStopSpec = ASH_COMMAND_SPECS.find(({ path }) => path.join(' ') === 'runtime stop')!
    const daemonStopSpec = ASH_COMMAND_SPECS.find(
      ({ path }) => path.join(' ') === 'terminal-daemon stop'
    )!
    const runtimeHelp = formatCommandHelp(runtimeStopSpec)
    const daemonHelp = formatCommandHelp(daemonStopSpec)

    expect(runtimeHelp).toContain(
      '--yes                  Confirm closing the authenticated Ash runtime'
    )
    expect(runtimeHelp).toContain('--force                Exit Ash immediately')
    expect(daemonHelp).toContain(
      '--yes                  Confirm stopping the daemon and ending every listed terminal session'
    )
    expect(daemonHelp).toContain('--force                Immediately kill live PTY process groups')
    expect(runtimeHelp).toContain('independent terminal daemon and all its sessions keep running')
    expect(daemonHelp).toContain('stops the terminal daemon and its sessions')
    expect(runtimeHelp).not.toContain('--environment')
    expect(runtimeHelp).not.toContain('--pairing-code')
    expect(daemonHelp).not.toContain('--environment')
    expect(daemonHelp).not.toContain('--pairing-code')
  })

  it('rewrites inherited product names in option descriptions', () => {
    const help = formatCommandHelp({
      path: ['demo'],
      summary: 'Show a workspace',
      usage: 'orca demo',
      allowedFlags: ['activate']
    })

    expect(help).toContain('--activate             Reveal the new worktree in the Ash IDE app')
    expect(help).not.toContain('Orca')
    expect(help).not.toContain('orca ')
  })
})
