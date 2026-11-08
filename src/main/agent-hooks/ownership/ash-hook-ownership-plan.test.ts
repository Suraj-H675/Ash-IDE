import { describe, expect, it } from 'vitest'
import {
  abandonAshClaudeHookInstall,
  AshHookOwnershipConflict,
  confirmAshClaudeHookInstall,
  emptyAshHookOwnershipLedger,
  planAshClaudeHookInstall,
  planAshClaudeHookRemoval,
  validateAshHookOwnershipLedger
} from './ash-hook-ownership-plan'

const configPath = '/fixture/claude-account/settings.json'
const foreign = () => ({
  hooks: {
    Stop: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'foreign-stop.sh', timeout: 3 }] }
    ],
    SessionStart: [{ hooks: [{ type: 'command', command: 'orca-session-start.sh' }] }]
  },
  enabledPlugins: { 'foreign/plugin': true },
  statusLine: { command: 'user-statusline.sh' }
})

function prepared(config: unknown = foreign()) {
  return planAshClaudeHookInstall({
    ledger: emptyAshHookOwnershipLedger(),
    config,
    configPath,
    event: 'Stop',
    command: '/fixture/ash-owned-hook.sh'
  })
}

describe('Ash hook ownership plans: exact identity, rollback, foreign preservation', () => {
  it('prepares a unique entry, confirms only after installation, and removes only its exact entry', () => {
    const initial = foreign()
    const plan = prepared(initial)
    expect(plan.claim.state).toBe('prepared')
    expect(plan.config.hooks).not.toBe(initial.hooks)
    expect(initial.hooks.Stop).toHaveLength(1)
    const withThirdPartyChange = structuredClone(plan.config)
    const hooks = (withThirdPartyChange.hooks as Record<string, unknown[]>).Stop
    hooks.unshift({
      matcher: 'Write',
      hooks: [{ type: 'command', command: 'later-third-party.sh' }]
    })
    const ledger = confirmAshClaudeHookInstall({
      ledger: plan.ledger,
      config: withThirdPartyChange,
      configPath,
      id: plan.claim.id
    })
    expect(ledger.claims).toEqual([expect.objectContaining({ state: 'installed' })])
    const removed = planAshClaudeHookRemoval({
      ledger,
      config: withThirdPartyChange,
      configPath,
      id: plan.claim.id
    })
    expect((removed.config.hooks as Record<string, unknown>).Stop).toEqual([
      hooks[0],
      initial.hooks.Stop[0]
    ])
    expect((removed.config.hooks as Record<string, unknown>).SessionStart).toEqual(
      initial.hooks.SessionStart
    )
    expect(removed.config.enabledPlugins).toEqual(initial.enabledPlugins)
    expect(removed.config.statusLine).toEqual(initial.statusLine)
    expect(removed.ledger.claims).toEqual([])
  })

  it('allows safe abort when a provider write never happened', () => {
    const plan = prepared()
    const abandoned = abandonAshClaudeHookInstall({
      ledger: plan.ledger,
      config: foreign(),
      configPath,
      id: plan.claim.id
    })
    expect(abandoned.claims).toEqual([])
    expect(() =>
      abandonAshClaudeHookInstall({
        ledger: plan.ledger,
        config: plan.config,
        configPath,
        id: plan.claim.id
      })
    ).toThrow(AshHookOwnershipConflict)
  })

  it('allows removal of an exact prepared entry when interrupted before confirmation', () => {
    const plan = prepared()
    const removed = planAshClaudeHookRemoval({
      ledger: plan.ledger,
      config: plan.config,
      configPath,
      id: plan.claim.id
    })
    expect((removed.config.hooks as Record<string, unknown>).Stop).toEqual(foreign().hooks.Stop)
    expect(removed.ledger.claims).toEqual([])
  })

  it('refuses to remove a provider entry whose command has changed', () => {
    const plan = prepared()
    const altered = structuredClone(plan.config)
    const definitions = (altered.hooks as Record<string, unknown[]>).Stop as {
      hooks: { command: string }[]
    }[]
    definitions.at(-1)!.hooks[0].command += ' --modified'
    expect(() =>
      planAshClaudeHookRemoval({
        ledger: plan.ledger,
        config: altered,
        configPath,
        id: plan.claim.id
      })
    ).toThrow('modified after installation')
  })

  it('refuses duplicate ownership markers rather than deleting either one', () => {
    const plan = prepared()
    const duplicated = structuredClone(plan.config)
    const definitions = (duplicated.hooks as Record<string, unknown[]>).Stop
    definitions.push(structuredClone(definitions.at(-1)))
    expect(() =>
      planAshClaudeHookRemoval({
        ledger: plan.ledger,
        config: duplicated,
        configPath,
        id: plan.claim.id
      })
    ).toThrow('ambiguous')
  })

  it('refuses to delete when the same marker was copied into a different event', () => {
    const plan = prepared()
    const copied = structuredClone(plan.config)
    const hooks = copied.hooks as Record<string, unknown[]>
    hooks.SessionStart.push(structuredClone(hooks.Stop.at(-1)))
    expect(() =>
      planAshClaudeHookRemoval({
        ledger: plan.ledger,
        config: copied,
        configPath,
        id: plan.claim.id
      })
    ).toThrow('duplicated or moved')
  })

  it('refuses missing ledger, relocated home, foreign marker, and unknown schema', () => {
    const plan = prepared()
    expect(() =>
      planAshClaudeHookRemoval({
        ledger: emptyAshHookOwnershipLedger(),
        config: plan.config,
        configPath,
        id: plan.claim.id
      })
    ).toThrow('missing claim')
    expect(() =>
      planAshClaudeHookRemoval({
        ledger: plan.ledger,
        config: plan.config,
        configPath: '/fixture/other-account/settings.json',
        id: plan.claim.id
      })
    ).toThrow('wrong provider home')
    expect(() =>
      planAshClaudeHookRemoval({
        ledger: plan.ledger,
        config: foreign(),
        configPath,
        id: plan.claim.id
      })
    ).toThrow('marker missing')
    expect(() => validateAshHookOwnershipLedger({ ...plan.ledger, schemaVersion: 2 })).toThrow(
      'unknown, corrupt'
    )
  })

  it('refuses ownership claim tampering and a corrupt target event', () => {
    const plan = prepared()
    expect(() =>
      validateAshHookOwnershipLedger({
        ...plan.ledger,
        claims: [plan.claim, plan.claim]
      })
    ).toThrow('duplicate')
    expect(() =>
      planAshClaudeHookInstall({
        ledger: emptyAshHookOwnershipLedger(),
        config: { hooks: { Stop: { matcher: 'corrupt' } } },
        configPath,
        event: 'Stop',
        command: '/fixture/ash-owned-hook.sh'
      })
    ).toThrow('malformed')
    expect(() =>
      planAshClaudeHookInstall({
        ledger: emptyAshHookOwnershipLedger(),
        config: { hooks: { Stop: [{ hooks: 'corrupt' }] } },
        configPath,
        event: 'Stop',
        command: '/fixture/ash-owned-hook.sh'
      })
    ).toThrow('malformed hook definitions')
    expect(() =>
      planAshClaudeHookInstall({
        ledger: emptyAshHookOwnershipLedger(),
        config: foreign(),
        configPath: '../fake/settings.json',
        event: 'Stop',
        command: '/fixture/ash-owned-hook.sh'
      })
    ).toThrow('invalid provider target')
  })

  it('cannot replace an existing entry merely because its command resembles Ash', () => {
    const input = foreign()
    input.hooks.Stop.push({
      matcher: 'Read',
      hooks: [{ type: 'command', command: 'ash-owned-hook.sh', timeout: 3 }]
    })
    const plan = prepared(input)
    const removed = planAshClaudeHookRemoval({
      ledger: plan.ledger,
      config: plan.config,
      configPath,
      id: plan.claim.id
    })
    expect((removed.config.hooks as Record<string, unknown>).Stop).toEqual(input.hooks.Stop)
  })
})
