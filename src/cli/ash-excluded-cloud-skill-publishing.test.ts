import { expect, it } from 'vitest'
import { HANDLER_GROUPS } from './handler-group-manifest'
import { COMMAND_SPECS } from './specs'

it('does not advertise or route vendor Cloud skill publishing', async () => {
  const commands = COMMAND_SPECS.map((spec) => spec.path.join(' '))
  const routed = HANDLER_GROUPS.flatMap((group) => group.keys)

  expect(commands).not.toContain('skills share')
  expect(routed).not.toContain('skills share')
  expect(commands).toContain('skills installed')
  expect(routed).toContain('skills installed')
  expect(commands).toContain('skills install')
  expect(commands).toContain('skills update')

  const group = HANDLER_GROUPS.find((entry) => entry.keys.includes('skills installed'))
  if (!group) {
    throw new Error('Native installed skill discovery has no CLI handler group')
  }
  expect(Object.keys(await group.load())).toEqual(['skills installed'])
})
