import { describe, expect, it } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../args'
import { ASH_COMMAND_SPECS } from './index'
import { PROFILE_STATE_COMMAND_SPECS } from './profile-state'

describe('profile state rollback discovery', () => {
  it.each(PROFILE_STATE_COMMAND_SPECS)('rejects --page for $path', (spec) => {
    const parsed = parseArgs([...spec.path, '--page', '1'])

    expect(() => validateCommandAndFlags(PROFILE_STATE_COMMAND_SPECS, parsed)).toThrow(
      `Unknown flag --page for command: ${spec.path.join(' ')}`
    )
  })

  it('exposes only local profile-state maintenance commands through the Ash registry', () => {
    const profileSpecs = ASH_COMMAND_SPECS.filter(({ path }) => path[0] === 'profile')
    expect(profileSpecs.map(({ path }) => path.join(' '))).toEqual([
      'profile state exports',
      'profile state checkpoint',
      'profile state rollback'
    ])
    const args = parseArgs(['profile', 'state', 'checkpoint', '--profile-id', 'inactive'])
    expect(() => validateCommandAndFlags(ASH_COMMAND_SPECS, args)).not.toThrow()
    const remote = parseArgs(['profile', 'state', 'checkpoint', '--host', 'remote'])
    expect(() => validateCommandAndFlags(ASH_COMMAND_SPECS, remote)).toThrow(/Unknown flag/)
  })

  it.each(['exports', 'rollback'])('accepts an explicit profile for %s', (command) => {
    const parsed = parseArgs(['profile', 'state', command, '--profile-id', 'inactive'])
    expect(parsed.flags.get('profile-id')).toBe('inactive')
    expect(() => validateCommandAndFlags(PROFILE_STATE_COMMAND_SPECS, parsed)).not.toThrow()
  })
  it.each(
    ['current-json', 'latest-json'].flatMap((selector) => [
      { selector, argv: ['profile', 'state', 'rollback', `--${selector}`] },
      { selector, argv: [`--${selector}`, 'profile', 'state', 'rollback'] },
      { selector, argv: ['profile', `--${selector}`, 'state', 'rollback'] }
    ])
  )('parses the JSON selector as a boolean: $argv', ({ argv, selector }) => {
    const parsed = parseArgs(argv)
    expect(parsed.commandPath).toEqual(['profile', 'state', 'rollback'])
    expect(parsed.flags.get(selector)).toBe(true)
    expect(() => validateCommandAndFlags(PROFILE_STATE_COMMAND_SPECS, parsed)).not.toThrow()
  })

  it('parses the current SQLite selector as a boolean', () => {
    const parsed = parseArgs(['profile', 'state', 'rollback', '--current-sqlite'])
    expect(parsed.flags.get('current-sqlite')).toBe(true)
    expect(() => validateCommandAndFlags(PROFILE_STATE_COMMAND_SPECS, parsed)).not.toThrow()
  })
})
