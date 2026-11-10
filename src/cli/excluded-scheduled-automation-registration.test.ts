import { describe, expect, it } from 'vitest'

import { HANDLER_COMMAND_KEYS } from './dispatch'
import { HANDLER_GROUPS } from './handler-group-manifest'
import { BUNDLED_SKILL_GUIDES } from './bundled-skill-guides'
import { ASH_COMMAND_SPECS, COMMAND_SPECS } from './specs'

describe('scheduled automation CLI registration', () => {
  it('does not expose legacy automation specs or lazy handler routes', () => {
    expect(COMMAND_SPECS.some(({ path }) => path[0] === 'automations')).toBe(false)
    expect(
      HANDLER_GROUPS.some(({ keys }) => keys.some((key) => key.startsWith('automations ')))
    ).toBe(false)
    expect(HANDLER_COMMAND_KEYS.has('automations list')).toBe(false)
  })

  it('retains manually supervised orchestration Runs and Ash terminal commands', () => {
    expect(COMMAND_SPECS.some(({ path }) => path.join(' ') === 'orchestration run-create')).toBe(
      true
    )
    expect(HANDLER_COMMAND_KEYS.has('orchestration run-create')).toBe(true)
    expect(ASH_COMMAND_SPECS.some(({ path }) => path.join(' ') === 'terminal create')).toBe(true)
    expect(HANDLER_COMMAND_KEYS.has('terminal create')).toBe(true)
  })

  it('does not instruct CLI users to invoke the removed automation commands', () => {
    const references = BUNDLED_SKILL_GUIDES.flatMap((guide) => [
      guide.markdown,
      ...guide.references.map((reference) => reference.markdown)
    ]).join('\n')

    expect(references).not.toMatch(
      /\b(?:orca|ORCA) automations (?:list|show|create|edit|remove|run|runs)\b/
    )
    expect(references).toContain('orca automations ...` commands are unavailable')
    expect(references).toContain('orca orchestration run-create')
  })
})
