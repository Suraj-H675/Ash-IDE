import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireOfflineUpdateFence,
  recoverOfflineUpdateTransaction,
  rollbackOfflineUpdateTransaction,
  storeOfflineUpdateGeneration,
  type OfflineUpdateBoundary,
  type OfflineUpdateGeneration
} from './offline-update-transaction'
import {
  artifact,
  cleanupFixtureRoots,
  createRoot,
  fixturePolicy,
  storeFixtureGeneration,
  tempRoot
} from './offline-update-transaction.fixture'

afterEach(cleanupFixtureRoots)

describe('offline update transaction', () => {
  it.skipIf(process.platform !== 'linux')(
    'recovers an interrupted first-ever generation with no previous pointer and safely retries',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const file = join(tempRoot, 'interrupted-first-generation.AppImage')
        const sha = artifact(file, 'first update has no previous generation')
        expect(() =>
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: file,
            artifactSha256: sha,
            onBoundary(boundary) {
              if (boundary === 'journal-preparing') {
                throw new Error('injected first-generation interruption')
              }
            }
          })
        ).toThrow('injected first-generation interruption')
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.state).toBe('previous-generation-active')
        expect(recovered.activeGeneration).toBeNull()
        const journal = JSON.parse(
          readFileSync(join(dataRoot, '.ash-offline-update', 'transaction.json'), 'utf8')
        )
        expect(journal).toMatchObject({ phase: 'rolled-back', previousGenerationId: null })
        const retried = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: file,
          artifactSha256: sha
        })
        expect(retried.artifactSha256).toBe(sha)
        expect(
          recoverOfflineUpdateTransaction(installRoot, dataRoot, fence).activeGeneration
            ?.generationId
        ).toBe(retried.generationId)
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'refuses a new store when committed or rolled-back journals disagree with the pointer',
    () => {
      for (const mismatch of [
        'committed-missing',
        'rolled-back-missing',
        'rolled-back-candidate-pointer'
      ] as const) {
        const { installRoot, dataRoot } = createRoot()
        const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
        try {
          const firstPath = join(tempRoot, 'consistent-first.AppImage')
          const secondPath = join(tempRoot, 'consistent-second.AppImage')
          const thirdPath = join(tempRoot, 'consistent-third.AppImage')
          const first = storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: firstPath,
            artifactSha256: artifact(firstPath, 'first immutable generation')
          })
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: secondPath,
            artifactSha256: artifact(secondPath, 'second immutable generation')
          })
          const control = join(dataRoot, '.ash-offline-update')
          const pointer = join(control, 'active-generation.json')
          const journal = join(control, 'transaction.json')
          const candidatePointerBytes = readFileSync(pointer)
          if (mismatch !== 'committed-missing') {
            rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence)
          }
          if (mismatch === 'rolled-back-candidate-pointer') {
            writeFileSync(pointer, candidatePointerBytes)
          } else {
            unlinkSync(pointer)
          }
          const priorJournalBytes = readFileSync(journal)
          expect(() =>
            storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: thirdPath,
              artifactSha256: artifact(thirdPath, 'third immutable generation')
            })
          ).toThrow(/journal and active pointer disagree/)
          expect(readFileSync(journal).equals(priorJournalBytes)).toBe(true)
          if (mismatch === 'rolled-back-candidate-pointer') {
            const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
            expect(recovered.activeGeneration?.generationId).toBe(first.generationId)
          }
        } finally {
          fence.release()
        }
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'bounds retained generation slots without deleting recovery history',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const generations: OfflineUpdateGeneration[] = []
        for (let index = 0; index < 4; index += 1) {
          const imagePath = join(tempRoot, `retained-${index}.AppImage`)
          generations.push(
            storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: imagePath,
              artifactSha256: artifact(imagePath, `retained artifact ${index}`)
            })
          )
        }
        const imagePath = join(tempRoot, 'fifth.AppImage')
        expect(() =>
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: imagePath,
            artifactSha256: artifact(imagePath, 'fifth artifact')
          })
        ).toThrow(/retained generation limit reached/)
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.activeGeneration?.generationId).toBe(generations[3].generationId)
        const previous = rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(previous.generationId).toBe(generations[2].generationId)
        for (const generation of generations) {
          expect(lstatSync(generation.artifactPath).isFile()).toBe(true)
        }
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'seals binary generation directories and preserves the AppImage execute bit',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const imagePath = join(tempRoot, 'sealed-binary-directory.AppImage')
        const generation = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: imagePath,
          artifactSha256: artifact(imagePath, 'sealed binary directory fixture bytes')
        })
        expect(lstatSync(dirname(generation.artifactPath)).mode & 0o222).toBe(0)
        expect(lstatSync(generation.artifactPath).mode & 0o222).toBe(0)
        expect(lstatSync(generation.artifactPath).mode & 0o100).not.toBe(0)
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'rejects a linked AppImage input before creating transaction state',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const imagePath = join(tempRoot, 'candidate.AppImage')
        const linkedPath = join(tempRoot, 'linked-candidate.AppImage')
        const imageHash = artifact(imagePath, 'controlled image bytes')
        symlinkSync(imagePath, linkedPath)
        expect(() =>
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: linkedPath,
            artifactSha256: imageHash
          })
        ).toThrow(/owned, bounded, regular single-link/)
        expect(() => lstatSync(join(dataRoot, '.ash-offline-update'))).toThrow()
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'recovers every journal boundary and retries the same immutable generation',
    () => {
      const boundaries: OfflineUpdateBoundary[] = [
        'journal-preparing',
        'binary-slot-durable',
        'state-slot-durable',
        'journal-prepared',
        'pointer-durable',
        'journal-committed'
      ]
      for (const boundary of boundaries) {
        const { installRoot, dataRoot } = createRoot()
        const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
        try {
          const firstPath = join(tempRoot, 'fixture-old.AppImage')
          const nextPath = join(tempRoot, 'fixture-next.AppImage')
          const firstHash = artifact(firstPath, 'fixture old image bytes')
          const nextHash = artifact(nextPath, `fixture next image bytes at ${boundary}`)
          const previous = storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: firstPath,
            artifactSha256: firstHash
          })
          writeFileSync(
            join(dataRoot, 'fixture', 'browser-extensions', 'state.json'),
            JSON.stringify({ schemaVersion: 1, entries: { fixture: `changed-${boundary}` } }),
            { mode: 0o600 }
          )
          expect(() =>
            storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: nextPath,
              artifactSha256: nextHash,
              onBoundary(observed) {
                if (observed === boundary) {
                  throw new Error('injected fixture interruption')
                }
              }
            })
          ).toThrow('injected fixture interruption')

          const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
          const candidateCommitted =
            boundary === 'pointer-durable' || boundary === 'journal-committed'
          expect(recovered.state).toBe(
            candidateCommitted ? 'candidate-generation-active' : 'previous-generation-active'
          )
          if (candidateCommitted) {
            expect(recovered.activeGeneration?.generationId).not.toBe(previous.generationId)
          } else {
            expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)
          }
          if (!candidateCommitted) {
            const retried = storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: nextPath,
              artifactSha256: nextHash
            })
            expect(retried.artifactSha256).toBe(nextHash)
          }
        } finally {
          fence.release()
        }
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'recovers the prior generation after a real permission error blocks slot creation',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      const binarySlots = join(installRoot, '.ash-offline-update', 'slots')
      try {
        const oldPath = join(tempRoot, 'old.AppImage')
        const nextPath = join(tempRoot, 'next.AppImage')
        const oldHash = artifact(oldPath, 'old permission fixture bytes')
        const nextHash = artifact(nextPath, 'new permission fixture bytes')
        const previous = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: oldPath,
          artifactSha256: oldHash
        })
        writeFileSync(
          join(dataRoot, 'fixture', 'browser-extensions', 'state.json'),
          JSON.stringify({ schemaVersion: 1, entries: { fixture: 'newer' } }),
          { mode: 0o600 }
        )
        chmodSync(binarySlots, 0o500)
        expect(() =>
          storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: nextPath,
            artifactSha256: nextHash
          })
        ).toThrow()
        chmodSync(binarySlots, 0o700)
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.state).toBe('previous-generation-active')
        expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)
      } finally {
        try {
          chmodSync(binarySlots, 0o700)
        } catch {}
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'reverses a committed storage pointer and preserves both exact state generations after interrupted rollback',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const originalStatePath = join(dataRoot, 'fixture', 'browser-extensions', 'state.json')
        const originalBytes = readFileSync(originalStatePath)
        const oldPath = join(tempRoot, 'old.AppImage')
        const nextPath = join(tempRoot, 'next.AppImage')
        const oldHash = artifact(oldPath, 'old controlled fixture bytes')
        const nextHash = artifact(nextPath, 'new controlled fixture bytes')
        const previous = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: oldPath,
          artifactSha256: oldHash
        })
        writeFileSync(
          originalStatePath,
          JSON.stringify({ schemaVersion: 1, entries: { fixture: 'newer' } }),
          {
            mode: 0o600
          }
        )
        const candidate = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: nextPath,
          artifactSha256: nextHash
        })
        expect(candidate.generationId).not.toBe(previous.generationId)

        expect(() =>
          rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence, (boundary) => {
            if (boundary === 'rollback-pointer-durable') {
              throw new Error('injected rollback interruption')
            }
          })
        ).toThrow('injected rollback interruption')
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.state).toBe('previous-generation-active')
        expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)
        expect(rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence).generationId).toBe(
          previous.generationId
        )

        const oldSnapshotBytes = readFileSync(
          join(previous.statePath, 'browser-extension-state', 'state.json')
        )
        const newerSnapshotBytes = readFileSync(
          join(candidate.statePath, 'browser-extension-state', 'state.json')
        )
        expect(oldSnapshotBytes.equals(originalBytes)).toBe(true)
        expect(JSON.parse(newerSnapshotBytes.toString('utf8')).entries.fixture).toBe('newer')
        expect(JSON.parse(readFileSync(originalStatePath, 'utf8')).entries.fixture).toBe('newer')
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'cannot start a new generation until an interrupted rollback is recovered',
    () => {
      for (const interruptedAt of [
        'rollback-journal-durable',
        'rollback-pointer-durable'
      ] as const) {
        const { installRoot, dataRoot } = createRoot()
        const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
        try {
          const originalPath = join(tempRoot, 'rollback-original.AppImage')
          const candidatePath = join(tempRoot, 'rollback-candidate.AppImage')
          const replacementPath = join(tempRoot, 'rollback-replacement.AppImage')
          const previous = storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: originalPath,
            artifactSha256: artifact(originalPath, 'original generation')
          })
          const candidate = storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: candidatePath,
            artifactSha256: artifact(candidatePath, 'candidate generation')
          })
          expect(() =>
            rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence, (boundary) => {
              if (boundary === interruptedAt) {
                throw new Error('simulated rollback interruption')
              }
            })
          ).toThrow('simulated rollback interruption')
          expect(() =>
            storeFixtureGeneration({
              installRoot,
              dataRoot,
              fence,
              artifactPath: replacementPath,
              artifactSha256: artifact(replacementPath, 'replacement generation')
            })
          ).toThrow(/Recover the interrupted offline update transaction/)
          const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
          expect(recovered.state).toBe('previous-generation-active')
          expect(recovered.activeGeneration?.generationId).toBe(previous.generationId)
          const replacement = storeFixtureGeneration({
            installRoot,
            dataRoot,
            fence,
            artifactPath: replacementPath,
            artifactSha256: artifact(replacementPath, 'replacement generation')
          })
          expect(replacement.generationId).not.toBe(candidate.generationId)
          expect(replacement.generationId).not.toBe(previous.generationId)
        } finally {
          fence.release()
        }
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'rejects rollback when retained generation bytes no longer match its derived identity',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const previousPath = join(tempRoot, 'identity-old.AppImage')
        const candidatePath = join(tempRoot, 'identity-candidate.AppImage')
        const previousHash = artifact(previousPath, 'original retained generation bytes')
        const candidateHash = artifact(candidatePath, 'candidate generation bytes')
        const previous = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: previousPath,
          artifactSha256: previousHash
        })
        storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: candidatePath,
          artifactSha256: candidateHash
        })
        chmodSync(previous.artifactPath, 0o600)
        writeFileSync(previous.artifactPath, 'altered retained generation bytes', { mode: 0o600 })
        chmodSync(previous.artifactPath, 0o500)
        expect(() => rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence)).toThrow(
          /generation ID does not match/
        )
        expect(recoverOfflineUpdateTransaction(installRoot, dataRoot, fence).state).toBe(
          'candidate-generation-active'
        )
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(
    process.platform !== 'linux' ||
      !process.env.ASH_M8_FIXTURE_APPIMAGE_PREVIOUS ||
      !process.env.ASH_M8_FIXTURE_APPIMAGE_CANDIDATE
  )(
    'stores genuine local Ash AppImage bytes and rolls the isolated generation pointer back',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const previousPath = process.env.ASH_M8_FIXTURE_APPIMAGE_PREVIOUS
        const candidatePath = process.env.ASH_M8_FIXTURE_APPIMAGE_CANDIDATE
        if (!previousPath || !candidatePath) {
          throw new Error('Real AppImage fixture paths must be supplied by the test runner')
        }
        const previousHash = createHash('sha256').update(readFileSync(previousPath)).digest('hex')
        const candidateHash = createHash('sha256').update(readFileSync(candidatePath)).digest('hex')
        expect(previousHash).not.toBe(candidateHash)
        // Independently inspect and pin each real AppImage's embedded version
        // before passing these optional fixture versions into the storage test.
        const previousVersion = process.env.ASH_M8_FIXTURE_APPIMAGE_PREVIOUS_VERSION ?? '0.1.0'
        const candidateVersion =
          process.env.ASH_M8_FIXTURE_APPIMAGE_CANDIDATE_VERSION ?? previousVersion
        if (process.env.ASH_M8_FIXTURE_APPIMAGE_CANDIDATE_VERSION) {
          expect(
            candidateVersion.localeCompare(previousVersion, 'en', { numeric: true })
          ).toBeGreaterThan(0)
          // These reports must be generated by the real embedded-payload QA
          // verifier against the exact fixture bytes before this test runs.
          for (const [reportPath, expectedHash, version] of [
            [
              process.env.ASH_M8_FIXTURE_APPIMAGE_PREVIOUS_IDENTITY_REPORT,
              previousHash,
              previousVersion
            ],
            [
              process.env.ASH_M8_FIXTURE_APPIMAGE_CANDIDATE_IDENTITY_REPORT,
              candidateHash,
              candidateVersion
            ]
          ]) {
            if (!reportPath) {
              throw new Error('Two-version fixture requires both embedded identity QA reports')
            }
            const report = JSON.parse(readFileSync(reportPath, 'utf8'))
            expect(report.checkpoint).toMatchObject({ id: 'PK-05', outcome: 'matched' })
            expect(report.outerArtifact.sha256).toBe(expectedHash)
            expect(report.embeddedIdentity.version).toBe(version)
            expect(report.ashPackageIdentityVerified).toBe(false)
            expect(report.activationAvailable).toBe(false)
          }
        }
        const policy = {
          ...fixturePolicy(),
          sourceProductVersion: previousVersion,
          targetProductVersion: previousVersion
        }
        const first = storeOfflineUpdateGeneration({
          installRoot,
          dataRoot,
          artifactPath: previousPath,
          artifactSha256: previousHash,
          statePolicy: policy,
          fence
        })
        writeFileSync(
          join(dataRoot, 'fixture', 'browser-extensions', 'state.json'),
          JSON.stringify({ schemaVersion: 1, entries: { fixture: 'candidate-state' } }),
          { mode: 0o600 }
        )
        const candidate = storeOfflineUpdateGeneration({
          installRoot,
          dataRoot,
          artifactPath: candidatePath,
          artifactSha256: candidateHash,
          statePolicy: { ...policy, targetProductVersion: candidateVersion },
          fence
        })
        expect(readFileSync(first.artifactPath).equals(readFileSync(previousPath))).toBe(true)
        expect(readFileSync(candidate.artifactPath).equals(readFileSync(candidatePath))).toBe(true)
        expect(lstatSync(first.artifactPath).mode & 0o111).not.toBe(0)
        const originalManifest = JSON.parse(
          readFileSync(join(first.statePath, 'state-manifest.json'), 'utf8')
        )
        const candidateManifest = JSON.parse(
          readFileSync(join(candidate.statePath, 'state-manifest.json'), 'utf8')
        )
        expect(originalManifest).toMatchObject({
          sourceProductVersion: previousVersion,
          targetProductVersion: previousVersion
        })
        expect(candidateManifest).toMatchObject({
          sourceProductVersion: previousVersion,
          targetProductVersion: candidateVersion
        })
        const rolledBack = rollbackOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(rolledBack.generationId).toBe(first.generationId)
        expect(rolledBack.stateManifestSha256).toBe(first.stateManifestSha256)
        expect(rolledBack.artifactSha256).toBe(previousHash)
        expect(
          recoverOfflineUpdateTransaction(installRoot, dataRoot, fence).activeGeneration
            ?.generationId
        ).toBe(first.generationId)
        expect(
          readFileSync(join(first.statePath, 'browser-extension-state', 'state.json')).toString()
        ).toContain('original')
        expect(
          readFileSync(
            join(candidate.statePath, 'browser-extension-state', 'state.json')
          ).toString()
        ).toContain('candidate-state')
      } finally {
        fence.release()
      }
    }
  )
})
