import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canAshWriteProviderGlobalHooks } from '../ash-hook-ownership-policy'
import {
  emptyAshHookOwnershipLedger,
  planAshClaudeHookInstall,
  type AshHookPlan
} from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'
import {
  ashProviderFileSha256,
  heldPathForAshProviderSwap,
  stagedPathForAshProviderSwap
} from './ash-provider-json-guard'
import {
  installStagedAshClaudeHookInFile,
  recoverStagedAshClaudeHookInstall
} from './ash-provider-hook-transaction'

let root = ''
let userData = ''
let providerConfig = ''
let oldRaw = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-provider-txn-fixture-'))
  userData = join(root, 'ash-private-profile')
  const providerHome = join(root, 'disposable-provider-home')
  mkdirSync(userData, { mode: 0o700 })
  mkdirSync(providerHome, { mode: 0o700 })
  providerConfig = join(providerHome, 'settings.json')
  oldRaw = `${JSON.stringify(
    {
      hooks: {
        Stop: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'orca-still-owned.sh' }] }]
      },
      enabledPlugins: { 'unknown/plugin': true },
      permissions: { defaultMode: 'default' }
    },
    null,
    2
  )}\n`
  writeFileSync(providerConfig, oldRaw, { mode: 0o600 })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function stagedPlan(raw: string | null = oldRaw): Promise<AshHookPlan> {
  const snapshot = await readAshHookOwnershipLedger(userData)
  const plan = planAshClaudeHookInstall({
    ledger: snapshot.ledger,
    config: raw === null ? {} : JSON.parse(raw),
    configPath: providerConfig,
    event: 'Stop',
    command: '/tmp/disposable-ash-hook.sh'
  })
  await saveAshHookOwnershipLedger(userData, plan.ledger, snapshot.revision)
  return plan
}

const receiptPath = (id: string) => join(userData, 'provider-hook-ownership', `pending-${id}.json`)
function publishFixtureReceipt(plan: AshHookPlan, baseline: string | null = oldRaw): string {
  const nextRaw = `${JSON.stringify(plan.config, null, 2)}\n`
  const receipt = {
    schemaVersion: 1,
    owner: 'ash-ide',
    provider: 'claude',
    action: 'install',
    id: plan.claim.id,
    operationId: plan.claim.id,
    definitionSha256: plan.claim.definitionSha256,
    configPath: providerConfig,
    beforeSha256: ashProviderFileSha256(baseline),
    afterSha256: ashProviderFileSha256(nextRaw)
  }
  writeFileSync(receiptPath(plan.claim.id), `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
  return nextRaw
}

describe.skipIf(process.platform === 'win32')(
  'prepared Ash claim + private receipt + guarded provider-file publication',
  () => {
    it('does not enable the production global-hook installation policy', () => {
      expect(canAshWriteProviderGlobalHooks()).toBe(false)
    })

    it('installs only after a durable prepared claim and finalizes its private receipt', async () => {
      const plan = await stagedPlan()
      const installed = await installStagedAshClaudeHookInFile({
        ashUserData: userData,
        plan,
        expectedRaw: oldRaw
      })
      expect(installed.id).toBe(plan.claim.id)
      const current = JSON.parse(readFileSync(providerConfig, 'utf8'))
      expect(current.hooks.Stop).toHaveLength(2)
      expect(current.hooks.Stop[0].hooks[0].command).toBe('orca-still-owned.sh')
      expect(current.enabledPlugins).toEqual({ 'unknown/plugin': true })
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims).toEqual([
        expect.objectContaining({ id: plan.claim.id, state: 'installed' })
      ])
      expect(existsSync(receiptPath(plan.claim.id))).toBe(false)
      expect(existsSync(`${providerConfig}.ash-ide-write.lock`)).toBe(false)
      expect(existsSync(heldPathForAshProviderSwap(providerConfig, plan.claim.id))).toBe(false)
      expect(lstatSync(providerConfig).mode & 0o777).toBe(0o600)
    })

    it('refuses to write an unstaged plan or modified third-party settings', async () => {
      const plan = planAshClaudeHookInstall({
        ledger: emptyAshHookOwnershipLedger(),
        config: JSON.parse(oldRaw),
        configPath: providerConfig,
        event: 'Stop',
        command: '/tmp/disposable-ash-hook.sh'
      })
      await expect(
        installStagedAshClaudeHookInFile({
          ashUserData: userData,
          plan,
          expectedRaw: oldRaw
        })
      ).rejects.toThrow('not first durably staged')
      expect(readFileSync(providerConfig, 'utf8')).toBe(oldRaw)
      const staged = await stagedPlan()
      const edited = oldRaw.replace('orca-still-owned.sh', 'orca-edited-by-provider.sh')
      writeFileSync(providerConfig, edited)
      await expect(
        installStagedAshClaudeHookInFile({
          ashUserData: userData,
          plan: staged,
          expectedRaw: oldRaw
        })
      ).rejects.toThrow()
      expect(readFileSync(providerConfig, 'utf8')).toBe(edited)
    })

    it('retains an incomplete claim/receipt on lock contention, then safely abandons it', async () => {
      const plan = await stagedPlan()
      const externalLock = `${providerConfig}.ash-ide-write.lock`
      writeFileSync(externalLock, 'other-writer', { flag: 'wx', mode: 0o600 })
      await expect(
        installStagedAshClaudeHookInFile({
          ashUserData: userData,
          plan,
          expectedRaw: oldRaw
        })
      ).rejects.toThrow('locked by another Ash writer')
      expect(existsSync(receiptPath(plan.claim.id))).toBe(true)
      expect(readFileSync(externalLock, 'utf8')).toBe('other-writer')
      rmSync(externalLock) // fixture-only: actual stale-lock reclamation is not automated
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData: userData,
          id: plan.claim.id
        })
      ).resolves.toBe('abandoned')
      expect(readFileSync(providerConfig, 'utf8')).toBe(oldRaw)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims).toEqual([])
    })

    it('recovers a crash after moving the old provider file but before publishing the new one', async () => {
      const plan = await stagedPlan()
      publishFixtureReceipt(plan)
      const held = heldPathForAshProviderSwap(providerConfig, plan.claim.id)
      renameSync(providerConfig, held) // reproducible on-disk state at crash boundary
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData: userData,
          id: plan.claim.id
        })
      ).resolves.toBe('abandoned')
      expect(readFileSync(providerConfig, 'utf8')).toBe(oldRaw)
      expect(existsSync(held)).toBe(false)
      expect(existsSync(receiptPath(plan.claim.id))).toBe(false)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims).toEqual([])
    })

    it('recovers publication after crash before the ledger could be marked installed', async () => {
      const plan = await stagedPlan()
      const publishedRaw = publishFixtureReceipt(plan)
      const held = heldPathForAshProviderSwap(providerConfig, plan.claim.id)
      renameSync(providerConfig, held)
      writeFileSync(providerConfig, publishedRaw, { mode: 0o600 })
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData: userData,
          id: plan.claim.id
        })
      ).resolves.toBe('installed')
      expect(readFileSync(providerConfig, 'utf8')).toBe(publishedRaw)
      expect(existsSync(held)).toBe(false)
      expect(existsSync(receiptPath(plan.claim.id))).toBe(false)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims[0].state).toBe('installed')
    })

    it('confirms an interrupted stage that is hardlinked to the published target', async () => {
      const plan = await stagedPlan()
      const publishedRaw = publishFixtureReceipt(plan)
      const held = heldPathForAshProviderSwap(providerConfig, plan.claim.id)
      const stage = stagedPathForAshProviderSwap(providerConfig, plan.claim.id)
      renameSync(providerConfig, held)
      writeFileSync(stage, publishedRaw, { mode: 0o600 })
      linkSync(stage, providerConfig)
      expect(lstatSync(providerConfig).nlink).toBe(2)
      await expect(
        recoverStagedAshClaudeHookInstall({ ashUserData: userData, id: plan.claim.id })
      ).resolves.toBe('installed')
      expect(existsSync(stage)).toBe(false)
      expect(existsSync(held)).toBe(false)
      expect(lstatSync(providerConfig).nlink).toBe(1)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims[0].state).toBe('installed')
    })

    it('preserves third-party settings changed after an interrupted publication', async () => {
      const plan = await stagedPlan()
      const publishedRaw = publishFixtureReceipt(plan)
      const held = heldPathForAshProviderSwap(providerConfig, plan.claim.id)
      renameSync(providerConfig, held)
      const foreignEdit = publishedRaw.replace('orca-still-owned.sh', 'modified-by-another-app.sh')
      writeFileSync(providerConfig, foreignEdit, { mode: 0o600 })
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData: userData,
          id: plan.claim.id
        })
      ).rejects.toThrow('changed after interrupted swap')
      expect(readFileSync(providerConfig, 'utf8')).toBe(foreignEdit)
      expect(readFileSync(held, 'utf8')).toBe(oldRaw)
      expect(existsSync(receiptPath(plan.claim.id))).toBe(true)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims[0].state).toBe('prepared')
    })

    it('refuses a tampered/symlinked private receipt instead of touching the provider file', async () => {
      const plan = await stagedPlan()
      symlinkSync(providerConfig, receiptPath(plan.claim.id))
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData: userData,
          id: plan.claim.id
        })
      ).rejects.toThrow('not a private, bounded file')
      expect(readFileSync(providerConfig, 'utf8')).toBe(oldRaw)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims[0].state).toBe('prepared')
    })

    it('aborts an interrupted install when original provider configuration was absent', async () => {
      rmSync(providerConfig)
      const plan = await stagedPlan(null)
      publishFixtureReceipt(plan, null)
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData: userData,
          id: plan.claim.id
        })
      ).resolves.toBe('abandoned')
      expect(existsSync(providerConfig)).toBe(false)
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims).toEqual([])
    })

    it('creates a missing provider settings file without overwriting another file', async () => {
      rmSync(providerConfig)
      const plan = await stagedPlan(null)
      await expect(
        installStagedAshClaudeHookInFile({
          ashUserData: userData,
          plan,
          expectedRaw: null
        })
      ).resolves.toMatchObject({ id: plan.claim.id })
      expect((await readAshHookOwnershipLedger(userData)).ledger.claims[0].state).toBe('installed')
      expect(readFileSync(providerConfig, 'utf8')).toContain(`ASH_IDE_HOOK_OWNER=${plan.claim.id}`)
      expect(lstatSync(providerConfig).mode & 0o777).toBe(0o600)
    })

    it('refuses world-readable transaction receipts without trusting their contents', async () => {
      const plan = await stagedPlan()
      publishFixtureReceipt(plan)
      const receipt = receiptPath(plan.claim.id)
      // Test modifies only a disposable file; no real provider account is accessed.
      const raw = readFileSync(receipt, 'utf8')
      rmSync(receipt)
      writeFileSync(receipt, raw, { mode: 0o644 })
      if (process.platform !== 'win32') {
        await expect(
          recoverStagedAshClaudeHookInstall({ ashUserData: userData, id: plan.claim.id })
        ).rejects.toThrow('not a private, bounded file')
        expect(readFileSync(providerConfig, 'utf8')).toBe(oldRaw)
        expect(existsSync(receipt)).toBe(true)
      }
    })
  }
)
