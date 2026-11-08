import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canAshWriteProviderGlobalHooks } from '../ash-hook-ownership-policy'
import {
  planAshClaudeHookInstall,
  planAshClaudeHookRemoval,
  type AshHookOwnershipClaim
} from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'
import {
  ashProviderFileSha256,
  heldPathForAshProviderSwap,
  swapAshClaudeSettingsIfUnchanged
} from './ash-provider-json-guard'
import { installStagedAshClaudeHookInFile } from './ash-provider-hook-transaction'
import {
  recoverOwnedAshClaudeHookRemoval,
  removeOwnedAshClaudeHookFromFile
} from './ash-provider-hook-removal'
import {
  createAshProviderWriteReceipt,
  type AshProviderWriteReceipt
} from './ash-provider-transaction-receipt'

let root = ''
let userData = ''
let configPath = ''
let original = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-owned-hook-removal-'))
  userData = join(root, 'ash-profile')
  const provider = join(root, 'disposable-claude')
  mkdirSync(userData, { mode: 0o700 })
  mkdirSync(provider, { mode: 0o700 })
  configPath = join(provider, 'settings.json')
  original = `${JSON.stringify(
    {
      hooks: {
        Stop: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'orca-owned-hook.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'unknown-provider-hook.sh' }] }]
      },
      enabledPlugins: { 'another-app/extension': true },
      permissions: { defaultMode: 'default' }
    },
    null,
    2
  )}\n`
  writeFileSync(configPath, original, { mode: 0o600 })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function installed(): Promise<AshHookOwnershipClaim> {
  const initial = await readAshHookOwnershipLedger(userData)
  const planned = planAshClaudeHookInstall({
    ledger: initial.ledger,
    config: JSON.parse(original),
    configPath,
    event: 'Stop',
    command: '/tmp/ash-guard-fixture-hook.sh'
  })
  await saveAshHookOwnershipLedger(userData, planned.ledger, initial.revision)
  await installStagedAshClaudeHookInFile({
    ashUserData: userData,
    plan: planned,
    expectedRaw: original
  })
  return planned.claim
}

function raw(): string {
  return readFileSync(configPath, 'utf8')
}

function privateReceiptPath(id: string): string {
  return join(userData, 'provider-hook-ownership', `pending-${id}.json`)
}

async function stagedRemoval(claim: AshHookOwnershipClaim): Promise<{
  receipt: AshProviderWriteReceipt
  nextRaw: string
  beforeRaw: string
}> {
  const snapshot = await readAshHookOwnershipLedger(userData)
  const beforeRaw = raw()
  const plan = planAshClaudeHookRemoval({
    ledger: snapshot.ledger,
    config: JSON.parse(beforeRaw),
    configPath,
    id: claim.id
  })
  const nextRaw = `${JSON.stringify(plan.config, null, 2)}\n`
  const receipt: AshProviderWriteReceipt = {
    schemaVersion: 1,
    owner: 'ash-ide',
    provider: 'claude',
    action: 'remove',
    id: claim.id,
    operationId: randomUUID(),
    definitionSha256: claim.definitionSha256,
    configPath,
    beforeSha256: ashProviderFileSha256(beforeRaw),
    afterSha256: ashProviderFileSha256(nextRaw)!
  }
  await createAshProviderWriteReceipt(userData, receipt)
  return { receipt, nextRaw, beforeRaw }
}

const currentClaims = async () => (await readAshHookOwnershipLedger(userData)).ledger.claims

// A user-visible release must not turn this experimental transaction on.
describe.skipIf(process.platform === 'win32')(
  'journaled removal of only Ash-owned Claude hooks',
  () => {
    it('keeps the production provider-global hook write policy disabled', () => {
      expect(canAshWriteProviderGlobalHooks()).toBe(false)
    })

    it('removes one exact Ash entry and retains Orca, unknown hooks and unrelated settings', async () => {
      const claim = await installed()
      const result = await removeOwnedAshClaudeHookFromFile({ ashUserData: userData, id: claim.id })
      expect(result.id).toBe(claim.id)
      expect(JSON.parse(raw())).toEqual(JSON.parse(original))
      expect(await currentClaims()).toEqual([])
      expect(existsSync(privateReceiptPath(claim.id))).toBe(false)
      expect(existsSync(`${configPath}.ash-ide-write.lock`)).toBe(false)
    })

    it('removes one Ash entry without deleting another Ash-owned hook in the same event', async () => {
      const first = await installed()
      const secondSnapshot = await readAshHookOwnershipLedger(userData)
      const secondBefore = raw()
      const secondPlan = planAshClaudeHookInstall({
        ledger: secondSnapshot.ledger,
        config: JSON.parse(secondBefore),
        configPath,
        event: 'Stop',
        command: '/tmp/another-distinct-ash-hook.sh'
      })
      await saveAshHookOwnershipLedger(userData, secondPlan.ledger, secondSnapshot.revision)
      await installStagedAshClaudeHookInFile({
        ashUserData: userData,
        plan: secondPlan,
        expectedRaw: secondBefore
      })

      await removeOwnedAshClaudeHookFromFile({ ashUserData: userData, id: first.id })
      const remaining = await currentClaims()
      expect(remaining).toEqual([
        expect.objectContaining({ id: secondPlan.claim.id, state: 'installed' })
      ])
      const commands = (JSON.parse(raw()).hooks.Stop as { hooks: { command: string }[] }[]).map(
        (entry) => entry.hooks[0].command
      )
      expect(commands).toEqual([
        'orca-owned-hook.sh',
        `ASH_IDE_HOOK_OWNER=${secondPlan.claim.id} /tmp/another-distinct-ash-hook.sh`
      ])
      expect(raw()).not.toContain(`ASH_IDE_HOOK_OWNER=${first.id}`)
    })

    it('rejects a foreign or nonexistent ownership identity without changing provider JSON', async () => {
      await installed()
      const before = raw()
      await expect(
        removeOwnedAshClaudeHookFromFile({
          ashUserData: userData,
          id: randomUUID()
        })
      ).rejects.toThrow('no verified installed Ash hook claim')
      expect(raw()).toBe(before)
    })

    it('refuses to remove a user-modified Ash hook while keeping the ownership claim', async () => {
      const claim = await installed()
      const edited = raw().replace('/tmp/ash-guard-fixture-hook.sh', '/tmp/changed-by-user.sh')
      writeFileSync(configPath, edited)
      await expect(
        removeOwnedAshClaudeHookFromFile({
          ashUserData: userData,
          id: claim.id
        })
      ).rejects.toThrow('modified after installation')
      expect(raw()).toBe(edited)
      expect((await currentClaims()).map((entry) => entry.id)).toEqual([claim.id])
      expect(existsSync(privateReceiptPath(claim.id))).toBe(false)
    })

    it('refuses ambiguous duplicated ownership markers across provider events', async () => {
      const claim = await installed()
      const config = JSON.parse(raw())
      config.hooks.SessionStart.push(config.hooks.Stop.at(-1))
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
      await expect(
        removeOwnedAshClaudeHookFromFile({
          ashUserData: userData,
          id: claim.id
        })
      ).rejects.toThrow('duplicated or moved')
      expect((await currentClaims()).map((entry) => entry.id)).toEqual([claim.id])
    })

    it('preserves a protected lock on failure and allows a later safe recovery', async () => {
      const claim = await installed()
      const locked = `${configPath}.ash-ide-write.lock`
      writeFileSync(locked, 'another Ash writer', { flag: 'wx', mode: 0o600 })
      const before = raw()
      await expect(
        removeOwnedAshClaudeHookFromFile({
          ashUserData: userData,
          id: claim.id
        })
      ).rejects.toThrow('locked by another Ash writer')
      expect(raw()).toBe(before)
      expect(existsSync(privateReceiptPath(claim.id))).toBe(true)
      expect(readFileSync(locked, 'utf8')).toBe('another Ash writer')
      rmSync(locked) // fixture-only cleanup; application must NOT clear another writer's lock
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).resolves.toBe('preserved')
      expect((await currentClaims())[0].state).toBe('installed')
      expect(existsSync(privateReceiptPath(claim.id))).toBe(false)
    })

    it('recovers a durable removal intent before any provider-file write', async () => {
      const claim = await installed()
      const { beforeRaw } = await stagedRemoval(claim)
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).resolves.toBe('preserved')
      expect(raw()).toBe(beforeRaw)
      expect((await currentClaims())[0].state).toBe('installed')
      expect(existsSync(privateReceiptPath(claim.id))).toBe(false)
    })

    it('restores original provider JSON after an interrupted hold, preserving installed ownership', async () => {
      const claim = await installed()
      const { receipt, beforeRaw } = await stagedRemoval(claim)
      const held = heldPathForAshProviderSwap(configPath, receipt.operationId)
      renameSync(configPath, held)
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).resolves.toBe('preserved')
      expect(raw()).toBe(beforeRaw)
      expect(existsSync(held)).toBe(false)
      expect((await currentClaims())[0].state).toBe('installed')
    })

    it('confirms exactly published removal after a crash before private ledger update', async () => {
      const claim = await installed()
      const { receipt, nextRaw } = await stagedRemoval(claim)
      const held = heldPathForAshProviderSwap(configPath, receipt.operationId)
      renameSync(configPath, held)
      writeFileSync(configPath, nextRaw, { mode: 0o600 })
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).resolves.toBe('removed')
      expect(raw()).toBe(nextRaw)
      expect(JSON.parse(raw())).toEqual(JSON.parse(original))
      expect(await currentClaims()).toEqual([])
      expect(existsSync(held)).toBe(false)
      expect(existsSync(privateReceiptPath(claim.id))).toBe(false)
    })

    it('finishes an already-committed removal after a crash before receipt deletion', async () => {
      const claim = await installed()
      const { receipt, nextRaw } = await stagedRemoval(claim)
      const held = heldPathForAshProviderSwap(configPath, receipt.operationId)
      renameSync(configPath, held)
      writeFileSync(configPath, nextRaw, { mode: 0o600 })
      const snapshot = await readAshHookOwnershipLedger(userData)
      await saveAshHookOwnershipLedger(
        userData,
        {
          ...snapshot.ledger,
          claims: snapshot.ledger.claims.filter((entry) => entry.id !== claim.id)
        },
        snapshot.revision
      )
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).resolves.toBe('removed')
      expect(await currentClaims()).toEqual([])
      expect(raw()).toBe(nextRaw)
      expect(existsSync(privateReceiptPath(claim.id))).toBe(false)
    })

    it('refuses third-party edits after interrupted publication, preserving held original and receipt', async () => {
      const claim = await installed()
      const { receipt, nextRaw, beforeRaw } = await stagedRemoval(claim)
      const held = heldPathForAshProviderSwap(configPath, receipt.operationId)
      renameSync(configPath, held)
      const foreign = nextRaw.replace('orca-owned-hook.sh', 'changed-by-another-app.sh')
      writeFileSync(configPath, foreign)
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).rejects.toThrow('changed after interrupted swap')
      expect(raw()).toBe(foreign)
      expect(readFileSync(held, 'utf8')).toBe(beforeRaw)
      expect(existsSync(privateReceiptPath(claim.id))).toBe(true)
      expect((await currentClaims())[0].state).toBe('installed')
    })

    it('fails closed if a third-party process writes a stale-snapshot replacement first', async () => {
      const claim = await installed()
      const previous = raw()
      const writer = spawnSync(
        process.execPath,
        [
          '-e',
          'require("fs").writeFileSync(process.argv[1],process.argv[2])',
          configPath,
          previous.replace('orca-owned-hook.sh', 'external-process-hook.sh')
        ],
        { encoding: 'utf8', timeout: 3000 }
      )
      expect(writer.status).toBe(0)
      const modified = raw()
      await expect(
        swapAshClaudeSettingsIfUnchanged({
          configPath,
          operationId: randomUUID(),
          expectedRaw: previous,
          nextRaw: JSON.stringify(JSON.parse(original))
        })
      ).rejects.toThrow('changed since plan creation')
      expect(raw()).toBe(modified)
      expect((await currentClaims())[0].id).toBe(claim.id)
    })

    it('rejects a forged install-action receipt when asked to recover a removal', async () => {
      const claim = await installed()
      const { receipt } = await stagedRemoval(claim)
      const forged = { ...receipt, action: 'install' }
      writeFileSync(privateReceiptPath(claim.id), `${JSON.stringify(forged)}\n`, { mode: 0o600 })
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).rejects.toThrow('not an Ash-owned removal')
      expect((await currentClaims())[0].state).toBe('installed')
    })

    it('rejects a receipt whose claimed entry hash no longer matches the ledger', async () => {
      const claim = await installed()
      const { receipt } = await stagedRemoval(claim)
      const forged = { ...receipt, definitionSha256: 'a'.repeat(64) }
      writeFileSync(privateReceiptPath(claim.id), `${JSON.stringify(forged)}\n`, { mode: 0o600 })
      await expect(
        recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
      ).rejects.toThrow('does not match the Ash ownership claim')
      expect((await currentClaims())[0].state).toBe('installed')
    })

    it('actually terminates a disposable writer between rename and publication, then recovers', async () => {
      const claim = await installed()
      const { receipt, beforeRaw } = await stagedRemoval(claim)
      const held = heldPathForAshProviderSwap(configPath, receipt.operationId)
      const child = spawn(
        process.execPath,
        [
          '-e',
          'require("fs").renameSync(process.argv[1], process.argv[2]);process.stdout.write("HELD\\n");setInterval(()=>{},1000)',
          configPath,
          held
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', () => reject(new Error('fixture writer exited before SIGKILL')))
          child.stdout!.once('data', (data: Buffer) => {
            if (data.toString().includes('HELD')) {
              resolve()
            } else {
              reject(new Error('fixture writer did not acknowledge hold'))
            }
          })
        })
        expect(existsSync(held)).toBe(true)
        expect(child.kill('SIGKILL')).toBe(true)
        const { signal } = await new Promise<{ signal: NodeJS.Signals | null }>((resolve) => {
          child.once('exit', (_, signal) => resolve({ signal }))
        })
        expect(signal).toBe('SIGKILL')
        await expect(
          recoverOwnedAshClaudeHookRemoval({ ashUserData: userData, id: claim.id })
        ).resolves.toBe('preserved')
        expect(raw()).toBe(beforeRaw)
        expect((await currentClaims())[0].state).toBe('installed')
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }
    })
  }
)
