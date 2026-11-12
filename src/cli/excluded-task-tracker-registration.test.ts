import { describe, expect, it } from 'vitest'
import { HANDLER_COMMAND_KEYS } from './dispatch'
import { HANDLER_GROUPS } from './handler-group-manifest'
import { ASH_COMMAND_SPECS, COMMAND_SPECS } from './specs'

describe('Ash Jira/Linear application connector CLI exclusions', () => {
  it('does not retain the excluded connector roots in even the broad spec registry', () => {
    for (const spec of [...COMMAND_SPECS, ...ASH_COMMAND_SPECS]) {
      expect(['jira', 'linear'], spec.path.join(' ')).not.toContain(spec.path[0])
    }
    expect(ASH_COMMAND_SPECS.some(({ path }) => path.join(' ') === 'terminal create')).toBe(true)
  })

  it('does not register excluded CLI handler groups or executable command keys', () => {
    for (const group of HANDLER_GROUPS) {
      expect(group.name).not.toMatch(/^(?:jira|linear)$/)
      for (const key of group.keys) {
        expect(key, 'excluded tracker root').not.toMatch(/^(?:jira|linear)(?:\s|$)/)
      }
    }
    for (const key of HANDLER_COMMAND_KEYS) {
      expect(key, 'excluded tracker route').not.toMatch(/^(?:jira|linear)(?:\s|$)/)
    }
    expect(HANDLER_COMMAND_KEYS.has('terminal create')).toBe(true)
    expect(HANDLER_COMMAND_KEYS.has('runtime stop')).toBe(true)
  })
})
