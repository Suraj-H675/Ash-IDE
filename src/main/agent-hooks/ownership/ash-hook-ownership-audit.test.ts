import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  confirmAshClaudeHookInstall,
  planAshClaudeHookInstall,
  type AshHookPlan
} from './ash-hook-ownership-plan'
import { auditAshClaudeHookOwnership } from './ash-hook-ownership-audit'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'

let fixture = ''
let ashUserData = ''
let providerConfig = ''
let original = ''

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'ash-ownership-audit-'))
  ashUserData = join(fixture, 'ash-owned')
  const claude = join(fixture, 'isolated-claude-home')
  mkdirSync(ashUserData, { mode: 0o700 })
  mkdirSync(claude, { mode: 0o700 })
  providerConfig = join(claude, 'settings.json')
  original = `${JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'foreign-preserved.sh' }] }] },
    permissions: { defaultMode: 'default' }
  })}\n`
  writeFileSync(providerConfig, original, { mode: 0o600 })
})

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true })
})

async function stageClaim(): Promise<AshHookPlan> {
  const snapshot = await readAshHookOwnershipLedger(ashUserData)
  const plan = planAshClaudeHookInstall({
    ledger: snapshot.ledger,
    config: JSON.parse(original),
    configPath: providerConfig,
    event: 'Stop',
    command: '/fixture/ash-owned-claude-hook.sh'
  })
  await saveAshHookOwnershipLedger(ashUserData, plan.ledger, snapshot.revision)
  return plan
}

const audit = () => auditAshClaudeHookOwnership({ ashUserData, approvedConfigPath: providerConfig })

describe.skipIf(process.platform === 'win32')('read-only Ash Claude hook ownership audit', () => {
  it('does not create ownership state or alter provider metadata when no claim exists', async () => {
    const before = statSync(providerConfig)
    const result = await audit()
    const after = statSync(providerConfig)
    expect(result).toEqual({ ledgerRevision: null, claims: [] })
    expect(existsSync(join(ashUserData, 'provider-hook-ownership'))).toBe(false)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.mode).toBe(before.mode)
    expect(readFileSync(providerConfig, 'utf8')).toBe(original)
  })

  it('distinguishes prepared, published-but-unconfirmed, and fully verified claims', async () => {
    const plan = await stageClaim()
    const initial = await audit()
    expect(initial.claims).toEqual([
      expect.objectContaining({ id: plan.claim.id, event: 'Stop', state: 'pending' })
    ])
    expect(readFileSync(providerConfig, 'utf8')).toBe(original)
    const published = `${JSON.stringify(plan.config, null, 2)}\n`
    writeFileSync(providerConfig, published)
    expect((await audit()).claims[0].state).toBe('published_unconfirmed')
    const staged = await readAshHookOwnershipLedger(ashUserData)
    const installed = confirmAshClaudeHookInstall({
      ledger: staged.ledger,
      config: plan.config,
      configPath: providerConfig,
      id: plan.claim.id
    })
    await saveAshHookOwnershipLedger(ashUserData, installed, staged.revision)
    expect((await audit()).claims[0].state).toBe('verified')
    const before = readFileSync(providerConfig, 'utf8')
    await audit()
    expect(readFileSync(providerConfig, 'utf8')).toBe(before)
  })

  it('allows unrelated provider settings changes while rejecting modification to the owned entry', async () => {
    const plan = await stageClaim()
    writeFileSync(providerConfig, `${JSON.stringify(plan.config)}\n`)
    const staged = await readAshHookOwnershipLedger(ashUserData)
    await saveAshHookOwnershipLedger(
      ashUserData,
      confirmAshClaudeHookInstall({
        ledger: staged.ledger,
        config: plan.config,
        configPath: providerConfig,
        id: plan.claim.id
      }),
      staged.revision
    )
    const otherSetting = { ...plan.config, unrelatedProviderSetting: true }
    writeFileSync(providerConfig, `${JSON.stringify(otherSetting)}\n`)
    expect((await audit()).claims[0].state).toBe('verified')
    const changed = JSON.parse(readFileSync(providerConfig, 'utf8'))
    changed.hooks.Stop[1].hooks[0].command = 'altered-foreign-command'
    writeFileSync(providerConfig, `${JSON.stringify(changed)}\n`)
    const before = readFileSync(providerConfig, 'utf8')
    expect((await audit()).claims[0].state).toBe('conflict')
    expect(readFileSync(providerConfig, 'utf8')).toBe(before)
  })

  it('rejects an ambiguous duplicate owner marker without repairing provider configuration', async () => {
    const plan = await stageClaim()
    const changed = structuredClone(plan.config)
    const hooks = (changed.hooks as Record<string, unknown[]>).Stop
    hooks.push(structuredClone(hooks[1]))
    writeFileSync(providerConfig, `${JSON.stringify(changed)}\n`)
    const before = readFileSync(providerConfig, 'utf8')
    expect((await audit()).claims[0].state).toBe('conflict')
    expect(readFileSync(providerConfig, 'utf8')).toBe(before)
  })

  it('never opens a different provider target embedded in an Ash claim', async () => {
    const plan = await stageClaim()
    const approved = join(fixture, 'another-claude-home')
    mkdirSync(approved, { mode: 0o700 })
    const alternate = join(approved, 'settings.json')
    const result = await auditAshClaudeHookOwnership({
      ashUserData,
      approvedConfigPath: alternate
    })
    expect(result.claims).toEqual([
      expect.objectContaining({ id: plan.claim.id, state: 'conflict' })
    ])
    expect(existsSync(alternate)).toBe(false)
    expect(readFileSync(providerConfig, 'utf8')).toBe(original)
  })

  it('reports an unsafe provider symlink as a conflict without following or rewriting it', async () => {
    await stageClaim()
    const foreign = join(fixture, 'foreign-provider-settings.json')
    writeFileSync(foreign, original)
    rmSync(providerConfig)
    symlinkSync(foreign, providerConfig)
    expect((await audit()).claims[0].state).toBe('conflict')
    expect(readFileSync(foreign, 'utf8')).toBe(original)
  })
})
