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
import {
  confirmAshClaudeHookInstall,
  emptyAshHookOwnershipLedger,
  planAshClaudeHookInstall,
  planAshClaudeHookRemoval
} from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'
import { ashProviderFileSha256, heldPathForAshProviderSwap } from './ash-provider-json-guard'
import { recoverOwnedAshClaudeHookRemoval } from './ash-provider-hook-removal'
import { createAshProviderWriteReceipt } from './ash-provider-transaction-receipt'

let root = ''
let ashUserData = ''
let configPath = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-removal-negative-'))
  ashUserData = join(root, 'ash-profile')
  const providerHome = join(root, 'disposable-provider-home')
  mkdirSync(ashUserData, { mode: 0o700 })
  mkdirSync(providerHome, { mode: 0o700 })
  configPath = join(providerHome, 'settings.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function fixture(trackClaim: boolean) {
  const installedPlan = planAshClaudeHookInstall({
    ledger: emptyAshHookOwnershipLedger(),
    config: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'orca-owned.sh' }] }] } },
    configPath,
    event: 'Stop',
    command: '/tmp/disposable-ash-hook.sh'
  })
  const installedLedger = confirmAshClaudeHookInstall({
    ledger: installedPlan.ledger,
    config: installedPlan.config,
    configPath,
    id: installedPlan.claim.id
  })
  const removal = planAshClaudeHookRemoval({
    ledger: installedLedger,
    config: installedPlan.config,
    configPath,
    id: installedPlan.claim.id
  })
  const beforeRaw = `${JSON.stringify(installedPlan.config, null, 2)}\n`
  const afterRaw = `${JSON.stringify(removal.config, null, 2)}\n`
  writeFileSync(configPath, beforeRaw, { mode: 0o600 })
  const initial = await readAshHookOwnershipLedger(ashUserData)
  if (trackClaim) {
    await saveAshHookOwnershipLedger(ashUserData, installedLedger, initial.revision)
  }
  return { claim: installedPlan.claim, beforeRaw, afterRaw }
}

describe.skipIf(process.platform === 'win32')('SEC-04 invalid journaled removal recovery', () => {
  it('must not restore a held provider file when no installed Ash claim exists', async () => {
    const { claim, beforeRaw, afterRaw } = await fixture(false)
    // A read-only ledger lookup no longer creates this directory. This test
    // deliberately forges a receipt without a claim to exercise recovery.
    mkdirSync(join(ashUserData, 'provider-hook-ownership'), { mode: 0o700 })
    const operationId = randomUUID()
    const held = heldPathForAshProviderSwap(configPath, operationId)
    renameSync(configPath, held)
    await createAshProviderWriteReceipt(ashUserData, {
      schemaVersion: 1,
      owner: 'ash-ide',
      provider: 'claude',
      action: 'remove',
      id: claim.id,
      operationId,
      definitionSha256: claim.definitionSha256,
      configPath,
      beforeSha256: ashProviderFileSha256(beforeRaw),
      afterSha256: ashProviderFileSha256(afterRaw)!
    })

    await expect(recoverOwnedAshClaudeHookRemoval({ ashUserData, id: claim.id })).rejects.toThrow(
      'no installed Ash claim'
    )
    expect(existsSync(configPath)).toBe(false)
    expect(readFileSync(held, 'utf8')).toBe(beforeRaw)
    expect((await readAshHookOwnershipLedger(ashUserData)).ledger.claims).toEqual([])
  })

  it('must not forget an installed hook when a removal receipt claims the unchanged file is published', async () => {
    const { claim, beforeRaw } = await fixture(true)
    await createAshProviderWriteReceipt(ashUserData, {
      schemaVersion: 1,
      owner: 'ash-ide',
      provider: 'claude',
      action: 'remove',
      id: claim.id,
      operationId: randomUUID(),
      definitionSha256: claim.definitionSha256,
      configPath,
      beforeSha256: ashProviderFileSha256('{}\n'),
      afterSha256: ashProviderFileSha256(beforeRaw)!
    })

    await expect(recoverOwnedAshClaudeHookRemoval({ ashUserData, id: claim.id })).rejects.toThrow(
      'owned hook marker remains'
    )
    expect(readFileSync(configPath, 'utf8')).toBe(beforeRaw)
    expect((await readAshHookOwnershipLedger(ashUserData)).ledger.claims).toEqual([
      expect.objectContaining({ id: claim.id, state: 'installed' })
    ])
  })
})
