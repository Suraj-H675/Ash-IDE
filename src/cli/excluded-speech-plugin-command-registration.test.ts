import { describe, expect, it } from 'vitest'

import { HANDLER_GROUPS } from './handler-group-manifest'
import { ASH_COMMAND_SPECS, COMMAND_SPECS } from './specs'
import { CLI_COMMAND_NAMES } from '../main/startup/cli-command-names'

describe('Ash native CLI excludes voice and general IDE plugin commands', () => {
  it('does not expose speech or app-plugin command specifications', () => {
    for (const registry of [ASH_COMMAND_SPECS, COMMAND_SPECS]) {
      expect(registry.some((spec) => spec.path[0] === 'speech')).toBe(false)
      expect(registry.some((spec) => spec.path[0] === 'plugin')).toBe(false)
      expect(registry.some((spec) => spec.path.join(' ') === 'terminal create')).toBe(true)
    }
  })

  it('does not load excluded handler groups and does not treat commands as startup routes', () => {
    expect(
      HANDLER_GROUPS.flatMap(({ keys }) => keys).filter((key) =>
        /^(?:speech|plugin)(?: |$)/.test(key)
      )
    ).toEqual([])
    expect(CLI_COMMAND_NAMES).not.toContain('plugin')
    expect(CLI_COMMAND_NAMES).not.toContain('speech')
    expect(CLI_COMMAND_NAMES).toContain('terminal')
  })
})
