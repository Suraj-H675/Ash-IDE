import { chmodSync, lstatSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireOfflineUpdateFence,
  captureOfflineUpdateStateManifest,
  recoverOfflineUpdateTransaction,
  storeOfflineUpdateGeneration,
  type OfflineUpdateBoundary
} from './offline-update-transaction'
import {
  artifact,
  cleanupFixtureRoots,
  createRoot,
  fixturePolicy,
  interceptDirectoryFsync,
  interceptJournalCleanupFailures,
  storeFixtureGeneration,
  tempRoot
} from './offline-update-transaction.fixture'

afterEach(cleanupFixtureRoots)

describe('offline update transaction durability', () => {
  it.skipIf(process.platform !== 'linux')(
    'rejects corrupt JSON metadata instead of confusing it with a missing journal or pointer',
    () => {
      for (const metadataFile of ['transaction.json', 'active-generation.json']) {
        for (const corrupted of ['null', '[]']) {
          const { installRoot, dataRoot } = createRoot()
          const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
          try {
            const imagePath = join(tempRoot, 'corrupt-metadata.AppImage')
            storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: imagePath,
              artifactSha256: artifact(imagePath, 'metadata corruption fixture')
            })
            writeFileSync(join(dataRoot, '.ash-offline-update', metadataFile), corrupted, {
              mode: 0o600
            })
            expect(() => recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)).toThrow(
              /JSON metadata must be a non-null object/
            )
            expect(() =>
              storeFixtureGeneration({
                installRoot,
                dataRoot,
                fence,
                artifactPath: imagePath,
                artifactSha256: artifact(imagePath, 'metadata corruption fixture')
              })
            ).toThrow(/JSON metadata must be a non-null object/)
          } finally {
            fence.release()
          }
        }
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'stores and recovers a bounded state manifest larger than the journal limit',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const browserState = join(dataRoot, 'fixture', 'browser-extensions')
        for (let index = 0; index < 240; index += 1) {
          writeFileSync(
            join(browserState, `entry-${index.toString().padStart(4, '0')}.json`),
            '{}',
            {
              mode: 0o600
            }
          )
        }
        const policy = fixturePolicy()
        const manifest = captureOfflineUpdateStateManifest(dataRoot, policy)
        expect(Buffer.byteLength(JSON.stringify(manifest), 'utf8')).toBeGreaterThan(16 * 1024)
        const imagePath = join(tempRoot, 'large-manifest.AppImage')
        const imageHash = artifact(imagePath, 'bounded large manifest fixture bytes')
        const generation = storeOfflineUpdateGeneration({
          installRoot,
          dataRoot,
          artifactPath: imagePath,
          artifactSha256: imageHash,
          statePolicy: policy,
          fence
        })
        expect(lstatSync(join(generation.statePath, 'state-manifest.json')).size).toBeGreaterThan(
          16 * 1024
        )
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.state).toBe('candidate-generation-active')
        expect(recovered.activeGeneration?.generationId).toBe(generation.generationId)
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'removes only the current failed state staging tree and recovers the previous generation',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      const sourceState = join(dataRoot, 'fixture', 'browser-extensions', 'state.json')
      const generationRoot = join(dataRoot, '.ash-offline-update', 'generations')
      const binarySlotRoot = join(installRoot, '.ash-offline-update', 'slots')
      try {
        const oldPath = join(tempRoot, 'old-staging-fixture.AppImage')
        const nextPath = join(tempRoot, 'next-staging-fixture.AppImage')
        const oldHash = artifact(oldPath, 'old staging fixture bytes')
        const nextHash = artifact(nextPath, 'next staging fixture bytes')
        const previous = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: oldPath,
          artifactSha256: oldHash
        })
        writeFileSync(
          sourceState,
          JSON.stringify({ schemaVersion: 1, entries: { fixture: 'new' } }),
          {
            mode: 0o600
          }
        )
        expect(() =>
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: nextPath,
            artifactSha256: nextHash,
            onBoundary(boundary) {
              if (boundary === 'binary-slot-durable') {
                chmodSync(sourceState, 0)
              }
            }
          })
        ).toThrow()
        chmodSync(sourceState, 0o600)
        expect(readdirSync(generationRoot).some((name) => name.includes('.staging-'))).toBe(false)
        expect(readdirSync(binarySlotRoot).some((name) => name.includes('.staging-'))).toBe(false)
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.state).toBe('previous-generation-active')
        expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)
      } finally {
        try {
          chmodSync(sourceState, 0o600)
        } catch {}
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    're-syncs a staging parent when retry finds a previously deleted staging path',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      const sourceState = join(dataRoot, 'fixture', 'browser-extensions', 'state.json')
      const stateGenerations = join(dataRoot, '.ash-offline-update', 'generations')
      try {
        const oldPath = join(tempRoot, 'old-cleanup-fsync.AppImage')
        const nextPath = join(tempRoot, 'next-cleanup-fsync.AppImage')
        const oldHash = artifact(oldPath, 'old cleanup fsync fixture bytes')
        const nextHash = artifact(nextPath, 'next cleanup fsync fixture bytes')
        const previous = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: oldPath,
          artifactSha256: oldHash
        })
        writeFileSync(
          sourceState,
          JSON.stringify({ schemaVersion: 1, entries: { fixture: 'newer' } }),
          { mode: 0o600 }
        )
        const failedCleanupSync = interceptDirectoryFsync(stateGenerations, 3)
        try {
          expect(() =>
            storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: nextPath,
              artifactSha256: nextHash,
              onBoundary(boundary) {
                if (boundary === 'binary-slot-durable') {
                  chmodSync(sourceState, 0)
                }
              }
            })
          ).toThrow(/state staging failed and cleanup needs manual recovery/)
        } finally {
          failedCleanupSync.restore()
          chmodSync(sourceState, 0o600)
        }
        expect(failedCleanupSync.count()).toBe(3)
        expect(readdirSync(stateGenerations).some((name) => name.includes('.staging-'))).toBe(false)

        const recoverySync = interceptDirectoryFsync(stateGenerations)
        try {
          const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
          expect(recovered.state).toBe('previous-generation-active')
          expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)
          expect(recoverySync.count()).toBeGreaterThanOrEqual(2)
        } finally {
          recoverySync.restore()
        }
      } finally {
        try {
          chmodSync(sourceState, 0o600)
        } catch {}
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'retries rename after directory fsync failure and syncs reused slot parents before boundaries',
    () => {
      for (const target of ['binary', 'state'] as const) {
        const { installRoot, dataRoot } = createRoot()
        const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
        const binarySlots = join(installRoot, '.ash-offline-update', 'slots')
        const stateGenerations = join(dataRoot, '.ash-offline-update', 'generations')
        try {
          const oldPath = join(tempRoot, `${target}-fsync-old.AppImage`)
          const nextPath = join(tempRoot, `${target}-fsync-next.AppImage`)
          const oldHash = artifact(oldPath, `old ${target} fsync fixture bytes`)
          const nextHash = artifact(nextPath, `next ${target} fsync fixture bytes`)
          const previous = storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: oldPath,
            artifactSha256: oldHash
          })
          writeFileSync(
            join(dataRoot, 'fixture', 'browser-extensions', 'state.json'),
            JSON.stringify({ schemaVersion: 1, entries: { fixture: `new-${target}` } }),
            { mode: 0o600 }
          )
          const parentPath = target === 'binary' ? binarySlots : stateGenerations
          const failedSync = interceptDirectoryFsync(parentPath, 3)
          const boundaries: OfflineUpdateBoundary[] = []
          try {
            expect(() =>
              storeFixtureGeneration({
                installRoot,
                dataRoot,
                fence,
                artifactPath: nextPath,
                artifactSha256: nextHash,
                onBoundary(boundary) {
                  boundaries.push(boundary)
                }
              })
            ).toThrow('injected directory fsync failure')
          } finally {
            failedSync.restore()
          }
          expect(failedSync.count()).toBeGreaterThanOrEqual(4)
          expect(
            readdirSync(target === 'binary' ? binarySlots : stateGenerations).filter((name) =>
              /^[a-f0-9]{64}$/u.test(name)
            )
          ).toHaveLength(2)
          expect(boundaries).toContain('journal-preparing')
          expect(boundaries).not.toContain(
            target === 'binary' ? 'binary-slot-durable' : 'state-slot-durable'
          )
          const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
          expect(recovered.state).toBe('previous-generation-active')
          expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)

          const retrySync = interceptDirectoryFsync(parentPath)
          try {
            const candidate = storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: nextPath,
              artifactSha256: nextHash,
              onBoundary(boundary) {
                if (boundary === 'binary-slot-durable' && target === 'binary') {
                  expect(retrySync.count()).toBeGreaterThanOrEqual(2)
                }
                if (boundary === 'state-slot-durable' && target === 'state') {
                  expect(retrySync.count()).toBeGreaterThanOrEqual(2)
                }
              }
            })
            expect(candidate.artifactSha256).toBe(nextHash)
          } finally {
            retrySync.restore()
          }
        } finally {
          fence.release()
        }
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'reports journal write and cleanup failures without masking the write failure',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      const intercept = interceptJournalCleanupFailures()
      try {
        const imagePath = join(tempRoot, 'journal-cleanup-failure.AppImage')
        const imageHash = artifact(imagePath, 'journal cleanup failure fixture bytes')
        let failure: unknown
        try {
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: imagePath,
            artifactSha256: imageHash
          })
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(AggregateError)
        const aggregate = failure as AggregateError
        expect(aggregate.message).toContain('temporary-file cleanup also failed')
        expect(aggregate.errors).toHaveLength(2)
        expect(aggregate.errors[0]).toMatchObject({ message: 'injected journal fsync failure' })
        expect(aggregate.errors[1]).toMatchObject({ message: 'injected journal cleanup failure' })
      } finally {
        intercept.restore()
        fence.release()
      }
    }
  )
})
