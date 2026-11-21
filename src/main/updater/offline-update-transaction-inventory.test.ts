import { linkSync, mkdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireOfflineUpdateFence,
  captureOfflineUpdateStateManifest,
  recoverOfflineUpdateTransaction,
  type OfflineUpdateStatePolicy
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

describe('offline update transaction inventory', () => {
  it.skipIf(process.platform !== 'linux')(
    'stores nested paths and recovers them in canonical path order',
    () => {
      const { installRoot, dataRoot } = createRoot()
      const fence = acquireOfflineUpdateFence({ installRoot, userDataPath: dataRoot })
      try {
        const browserState = join(dataRoot, 'fixture', 'browser-extensions')
        mkdirSync(join(browserState, 'a'), { mode: 0o700 })
        writeFileSync(join(browserState, 'a-b.json'), '{}', { mode: 0o600 })
        writeFileSync(join(browserState, 'a', 'x.json'), '{}', { mode: 0o600 })
        const manifest = captureOfflineUpdateStateManifest(dataRoot, fixturePolicy())
        const browserDomain = manifest.domains.find(
          (domain) => domain.id === 'browser-extension-state'
        )
        expect(browserDomain?.files.map((file) => file.path)).toEqual([
          'a-b.json',
          'a/x.json',
          'state.json'
        ])
        const imagePath = join(tempRoot, 'nested-state.AppImage')
        const generation = storeFixtureGeneration({
          installRoot,
          dataRoot,
          fence,
          artifactPath: imagePath,
          artifactSha256: artifact(imagePath, 'nested state fixture bytes')
        })
        const recovered = recoverOfflineUpdateTransaction(installRoot, dataRoot, fence)
        expect(recovered.activeGeneration?.generationId).toBe(generation.generationId)
      } finally {
        fence.release()
      }
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'rejects missing domains, directory aliases, symlinks, and hardlinks',
    () => {
      const { dataRoot } = createRoot()
      const policy = fixturePolicy()
      const incompletePolicy: OfflineUpdateStatePolicy = {
        ...policy,
        requiredDomains: [policy.requiredDomains[0]]
      }
      expect(() => captureOfflineUpdateStateManifest(dataRoot, incompletePolicy)).toThrow(
        /missing a declared required domain/
      )
      const missingDirectoryPolicy: OfflineUpdateStatePolicy = {
        ...policy,
        requiredDomainIds: [...policy.requiredDomainIds, 'missing-domain'],
        requiredDomains: [
          ...policy.requiredDomains,
          {
            id: 'missing-domain',
            directory: 'fixture/missing-domain',
            schemaVersion: 1,
            inspectSchema: () => 1
          }
        ]
      }
      expect(() => captureOfflineUpdateStateManifest(dataRoot, missingDirectoryPolicy)).toThrow()
      const outsideFixturePolicy: OfflineUpdateStatePolicy = {
        ...policy,
        requiredDomainIds: ['provider-home'],
        requiredDomains: [
          {
            id: 'provider-home',
            directory: 'provider-home',
            schemaVersion: 1,
            inspectSchema: () => 1
          }
        ]
      }
      expect(() => captureOfflineUpdateStateManifest(dataRoot, outsideFixturePolicy)).toThrow(
        /invalid or excluded required domain/
      )
      const browserDirectory = join(dataRoot, 'fixture', 'browser-extensions')
      const stateFile = join(browserDirectory, 'state.json')
      const alias = join(browserDirectory, 'linked-state.json')
      linkSync(stateFile, alias)
      expect(() => captureOfflineUpdateStateManifest(dataRoot, fixturePolicy())).toThrow(
        /hard-linked/
      )
      rmSync(alias)
      rmSync(stateFile)
      symlinkSync(
        join(dataRoot, 'fixture', 'profile-state'),
        join(dataRoot, 'fixture', 'browser-extensions', 'state.json')
      )
      expect(() => captureOfflineUpdateStateManifest(dataRoot, fixturePolicy())).toThrow()

      rmSync(stateFile)
      rmdirSync(browserDirectory)
      const realBrowserDirectory = join(dataRoot, 'fixture', 'browser-real')
      mkdirSync(realBrowserDirectory, { mode: 0o700 })
      writeFileSync(
        join(realBrowserDirectory, 'state.json'),
        JSON.stringify({ schemaVersion: 1, entries: { fixture: 'real-directory' } }),
        { mode: 0o600 }
      )
      symlinkSync(realBrowserDirectory, browserDirectory, 'dir')
      expect(() => captureOfflineUpdateStateManifest(dataRoot, fixturePolicy())).toThrow(/linked/)
    }
  )
})
