import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planAshClaudeHookInstall, type AshHookPlan } from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'
import {
  ashProviderWriterLockPath,
  reclaimDeadAshProviderWriterLock,
  withAshProviderLock
} from './ash-provider-file-lock'
import { heldPathForAshProviderSwap, stagedPathForAshProviderSwap } from './ash-provider-json-guard'
import {
  installStagedAshClaudeHookInFile,
  recoverStagedAshClaudeHookInstall
} from './ash-provider-hook-transaction'
import { recoverOwnedAshClaudeHookRemoval } from './ash-provider-hook-removal'

type CrashPhase = 'stage-synced' | 'original-held' | 'replacement-linked' | 'held-cleaned'
type ChildCrashArgs = {
  action: 'install' | 'remove'
  ashUserData: string
  pauseAt: CrashPhase
  plan?: AshHookPlan
  id?: string
  expectedRaw?: string
}

const crashChildPath = fileURLToPath(
  new URL('./fixtures/ash-provider-writer-crash-child.mjs', import.meta.url)
)
let root = ''
let ashUserData = ''
let configPath = ''
let oldRaw = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-guarded-real-sigkill-'))
  ashUserData = join(root, 'ash-private')
  const provider = join(root, 'disposable-provider')
  mkdirSync(ashUserData, { mode: 0o700 })
  mkdirSync(provider, { mode: 0o700 })
  configPath = join(provider, 'settings.json')
  oldRaw = `${JSON.stringify(
    {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'orca-owned.sh' }] }] },
      enabledPlugins: { 'unknown/foreign': true },
      permissions: { defaultMode: 'default' }
    },
    null,
    2
  )}\n`
  writeFileSync(configPath, oldRaw, { mode: 0o600 })
})

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function preparedPlan(): Promise<AshHookPlan> {
  const snapshot = await readAshHookOwnershipLedger(ashUserData)
  const plan = planAshClaudeHookInstall({
    ledger: snapshot.ledger,
    config: JSON.parse(oldRaw),
    configPath,
    event: 'Stop',
    command: '/tmp/disposable-ash-only-hook.sh'
  })
  await saveAshHookOwnershipLedger(ashUserData, plan.ledger, snapshot.revision)
  return plan
}

async function installedHook(): Promise<AshHookPlan> {
  const plan = await preparedPlan()
  await installStagedAshClaudeHookInFile({ ashUserData, plan, expectedRaw: oldRaw })
  return plan
}

/** Kill exactly the child PID, never the provider, session, or unrelated daemon. */
async function killRealGuardedWriterAt(
  args: ChildCrashArgs,
  beforeKill?: (pid: number) => Promise<void>
): Promise<number> {
  const child: ChildProcess = spawn('node', ['--import', 'tsx', crashChildPath], {
    cwd: process.cwd(),
    env: { ...process.env, ASH_DISPOSABLE_CRASH_TEST: JSON.stringify(args) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-3500)
  })
  let reached = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const checkpoint = new Promise<void>((resolve, reject) => {
    child.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'kind' in message &&
        message.kind === 'guarded-writer-checkpoint' &&
        'phase' in message &&
        message.phase === args.pauseAt &&
        'pid' in message &&
        message.pid === child.pid
      ) {
        reached = true
        resolve()
      } else {
        reject(new Error(`unexpected guarded-writer IPC: ${JSON.stringify(message)}`))
      }
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (!reached) {
        reject(new Error(`guarded writer exited before checkpoint: ${code}/${signal}; ${stderr}`))
      }
    })
  })
  try {
    await Promise.race([
      checkpoint,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`child checkpoint timeout: ${stderr}`)), 12000)
      })
    ])
    if (!child.pid || child.pid < 2) {
      throw new Error('guarded child process identity is missing')
    }
    const pid = child.pid
    const lock = JSON.parse(readFileSync(ashProviderWriterLockPath(configPath), 'utf8')) as {
      schemaVersion: number
      owner: string
      pid: number
    }
    expect(lock).toMatchObject({ schemaVersion: 1, owner: 'ash-ide', pid })
    await beforeKill?.(pid)
    expect(child.kill('SIGKILL')).toBe(true)
    const outcome = await exited
    expect(outcome.signal).toBe('SIGKILL')
    return pid
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exited
    }
  }
}

async function assertNoGuardResidue(operationId: string, claimId: string): Promise<void> {
  expect(existsSync(ashProviderWriterLockPath(configPath))).toBe(false)
  expect(existsSync(heldPathForAshProviderSwap(configPath, operationId))).toBe(false)
  expect(existsSync(stagedPathForAshProviderSwap(configPath, operationId))).toBe(false)
  expect(existsSync(join(ashUserData, 'provider-hook-ownership', `pending-${claimId}.json`))).toBe(
    false
  )
}

describe.skipIf(process.platform === 'win32')(
  'real SIGKILL of actual guarded Claude JSON transaction in a disposable profile',
  () => {
    it.each<CrashPhase>(['stage-synced', 'original-held', 'replacement-linked', 'held-cleaned'])(
      'recovers actual install after SIGKILL at %s',
      async (phase) => {
        const plan = await preparedPlan()
        const childPid = await killRealGuardedWriterAt({
          action: 'install',
          ashUserData,
          plan,
          expectedRaw: oldRaw,
          pauseAt: phase
        })
        expect(childPid).toBeGreaterThan(1)
        const published = phase === 'replacement-linked' || phase === 'held-cleaned'
        const result = await recoverStagedAshClaudeHookInstall({ ashUserData, id: plan.claim.id })
        expect(result).toBe(published ? 'installed' : 'abandoned')
        const ledger = (await readAshHookOwnershipLedger(ashUserData)).ledger
        if (published) {
          expect(ledger.claims).toEqual([
            expect.objectContaining({ id: plan.claim.id, state: 'installed' })
          ])
          expect(readFileSync(configPath, 'utf8')).toContain(`ASH_IDE_HOOK_OWNER=${plan.claim.id}`)
        } else {
          expect(ledger.claims).toEqual([])
          expect(readFileSync(configPath, 'utf8')).toBe(oldRaw)
        }
        await assertNoGuardResidue(plan.claim.id, plan.claim.id)
      },
      20000
    )

    it.each<CrashPhase>(['stage-synced', 'original-held', 'replacement-linked', 'held-cleaned'])(
      'recovers actual removal after SIGKILL at %s',
      async (phase) => {
        const plan = await installedHook()
        const withAsh = readFileSync(configPath, 'utf8')
        await killRealGuardedWriterAt({
          action: 'remove',
          ashUserData,
          id: plan.claim.id,
          pauseAt: phase
        })
        const receipt = JSON.parse(
          readFileSync(
            join(ashUserData, 'provider-hook-ownership', `pending-${plan.claim.id}.json`),
            'utf8'
          )
        ) as { operationId: string }
        const published = phase === 'replacement-linked' || phase === 'held-cleaned'
        const result = await recoverOwnedAshClaudeHookRemoval({ ashUserData, id: plan.claim.id })
        expect(result).toBe(published ? 'removed' : 'preserved')
        const claims = (await readAshHookOwnershipLedger(ashUserData)).ledger.claims
        if (published) {
          expect(claims).toEqual([])
          expect(readFileSync(configPath, 'utf8')).not.toContain(
            `ASH_IDE_HOOK_OWNER=${plan.claim.id}`
          )
          expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(JSON.parse(oldRaw))
        } else {
          expect(claims).toEqual([
            expect.objectContaining({ id: plan.claim.id, state: 'installed' })
          ])
          expect(readFileSync(configPath, 'utf8')).toBe(withAsh)
        }
        await assertNoGuardResidue(receipt.operationId, plan.claim.id)
      },
      20000
    )

    it('refuses to reclaim a live process lock or another operation ID', async () => {
      const id = randomUUID()
      await withAshProviderLock(configPath, id, async () => {
        await expect(reclaimDeadAshProviderWriterLock(configPath, id)).rejects.toThrow('still live')
        await expect(reclaimDeadAshProviderWriterLock(configPath, randomUUID())).rejects.toThrow(
          'does not match'
        )
        expect(existsSync(ashProviderWriterLockPath(configPath))).toBe(true)
      })
      expect(existsSync(ashProviderWriterLockPath(configPath))).toBe(false)
    })

    it('does not trust a corrupt or legacy anonymous lock', async () => {
      const id = randomUUID()
      const lock = ashProviderWriterLockPath(configPath)
      writeFileSync(lock, 'unrecognized older writer', { mode: 0o600 })
      await expect(reclaimDeadAshProviderWriterLock(configPath, id)).rejects.toThrow('unreadable')
      expect(readFileSync(lock, 'utf8')).toBe('unrecognized older writer')
    })

    it('keeps a LIVE child lock while its guarded transaction is paused', async () => {
      const plan = await preparedPlan()
      await killRealGuardedWriterAt(
        {
          action: 'install',
          ashUserData,
          plan,
          expectedRaw: oldRaw,
          pauseAt: 'original-held'
        },
        async () => {
          await expect(
            recoverStagedAshClaudeHookInstall({
              ashUserData,
              id: plan.claim.id
            })
          ).rejects.toThrow('still live')
        }
      )
      expect(
        await recoverStagedAshClaudeHookInstall({
          ashUserData,
          id: plan.claim.id
        })
      ).toBe('abandoned')
      await assertNoGuardResidue(plan.claim.id, plan.claim.id)
      expect(readFileSync(configPath, 'utf8')).toBe(oldRaw)
    }, 20000)

    it('keeps an independent provider edit and prepared claim after the writer dies', async () => {
      const plan = await preparedPlan()
      const foreignEdit = oldRaw.replace('orca-owned.sh', 'edited-by-independent-provider.sh')
      await killRealGuardedWriterAt(
        {
          action: 'install',
          ashUserData,
          plan,
          expectedRaw: oldRaw,
          pauseAt: 'stage-synced'
        },
        async () => {
          // This other application deliberately ignores Ash's advisory lock.
          writeFileSync(configPath, foreignEdit, { mode: 0o600 })
        }
      )
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData,
          id: plan.claim.id
        })
      ).rejects.toThrow('does not match transaction receipt')
      expect(readFileSync(configPath, 'utf8')).toBe(foreignEdit)
      expect((await readAshHookOwnershipLedger(ashUserData)).ledger.claims).toEqual([
        expect.objectContaining({ id: plan.claim.id, state: 'prepared' })
      ])
      expect(
        existsSync(join(ashUserData, 'provider-hook-ownership', `pending-${plan.claim.id}.json`))
      ).toBe(true)
    }, 20000)

    it('does not overwrite an independent replacement published during the held-file gap', async () => {
      const plan = await preparedPlan()
      const foreignEdit = oldRaw.replace('orca-owned.sh', 'independent-new-provider-hook.sh')
      await killRealGuardedWriterAt(
        {
          action: 'install',
          ashUserData,
          plan,
          expectedRaw: oldRaw,
          pauseAt: 'original-held'
        },
        async () => {
          // A second process publishes its own file while Ash's original is held.
          writeFileSync(configPath, foreignEdit, { flag: 'wx', mode: 0o600 })
        }
      )
      await expect(
        recoverStagedAshClaudeHookInstall({
          ashUserData,
          id: plan.claim.id
        })
      ).rejects.toThrow('changed after interrupted swap')
      expect(readFileSync(configPath, 'utf8')).toBe(foreignEdit)
      expect(readFileSync(heldPathForAshProviderSwap(configPath, plan.claim.id), 'utf8')).toBe(
        oldRaw
      )
      expect((await readAshHookOwnershipLedger(ashUserData)).ledger.claims).toEqual([
        expect.objectContaining({ id: plan.claim.id, state: 'prepared' })
      ])
    }, 20000)
  }
)
