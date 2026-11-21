import { hostname } from 'node:os'
import { lstatSync, mkdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireOfflineUpdateFence,
  recoverOfflineUpdateTransaction
} from './offline-update-transaction'
import { cleanupFixtureRoots, createRoot, tempRoot } from './offline-update-transaction.fixture'
import {
  acquireProfileStateRuntimeAdmission,
  ProfileStateAccessError
} from '../persistence/profile-state/profile-state-access'
import { acquireOrcadInstanceLock } from '../orcad/orcad-instance-lock'
import { profileStateAccessPaths } from '../persistence/profile-state/profile-state-access-owner'

afterEach(cleanupFixtureRoots)

describe('offline update transaction fence', () => {
  it.skipIf(process.platform !== 'linux')(
    'rejects a structurally forged or cloned fence even when the paths match',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const authentic = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const forged = {
          installRoot,
          userDataPath: dataRoot,
          coverage: 'ash-process-and-profile-state-only' as const,
          assertActive() {},
          release() {}
        }
        const cloned = { ...authentic }
        expect(Object.isFrozen(authentic)).toBe(true)
        expect(() => recoverOfflineUpdateTransaction(installRoot, dataRoot, forged)).toThrow(
          /fence was not acquired/
        )
        expect(() => recoverOfflineUpdateTransaction(installRoot, dataRoot, cloned)).toThrow(
          /fence was not acquired/
        )
        expect(authentic.assertActive()).toBeUndefined()
      } finally {
        authentic.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'holds existing Ash locks and refuses competing starts and profile writers',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        expect(() => acquireOrcadInstanceLock(dataRoot)).toThrow()
        expect(() => acquireOrcadInstanceLock(installRoot)).toThrow()
        expect(() => acquireProfileStateRuntimeAdmission(dataRoot)).toThrow(ProfileStateAccessError)
        expect(() => acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })).toThrow()
        const competingDataRoot = join(tempRoot, 'other-user-data')
        mkdirSync(competingDataRoot, { mode: 0o700 })
        expect(() =>
          acquireOfflineUpdateFence({ installRoot, userDataPath: competingDataRoot })
        ).toThrow()
        expect(() => fence.assertActive()).not.toThrow()
      } finally {
        fence.release()
        fence.release()
      }

      const runtime = acquireProfileStateRuntimeAdmission(dataRoot)
      try {
        expect(() => acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })).toThrow()
      } finally {
        runtime.release()
      }
      const processLock = acquireOrcadInstanceLock(dataRoot)
      processLock.release()
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'reclaims a proven stale PID and refuses malformed or mismatched owner tokens',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const paths = profileStateAccessPaths(dataRoot)
      const staleToken = '11111111-1111-4111-8111-111111111111'
      const staleOwnerDirectory = join(paths.participants, `${staleToken}.owner`)
      mkdirSync(staleOwnerDirectory, { mode: 0o700 })
      writeFileSync(
        join(staleOwnerDirectory, `${staleToken}.owner`),
        JSON.stringify({
          token: staleToken,
          pid: 2_147_483_647,
          host: hostname(),
          platform: 'linux',
          pidNamespace: readlinkSync('/proc/self/ns/pid')
        }),
        { mode: 0o600 }
      )
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      fence.release()
      expect(() => lstatSync(staleOwnerDirectory)).toThrow()

      const mismatchToken = '22222222-2222-4222-8222-222222222222'
      const mismatchDirectory = join(paths.participants, `${mismatchToken}.owner`)
      mkdirSync(mismatchDirectory, { mode: 0o700 })
      writeFileSync(
        join(mismatchDirectory, `${mismatchToken}.owner`),
        JSON.stringify({
          token: '33333333-3333-4333-8333-333333333333',
          pid: 2_147_483_647,
          host: hostname(),
          platform: 'linux',
          pidNamespace: readlinkSync('/proc/self/ns/pid')
        }),
        { mode: 0o600 }
      )
      expect(() => acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })).toThrow(
        ProfileStateAccessError
      )
    }
  )
})
