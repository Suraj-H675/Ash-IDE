import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { SettingsUpdate } from '../../../../shared/rpc-contract/client-settings-params'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { RuntimeStore } from '../../runtime-store-contract'
import { partialRuntimeStore } from '../../orca-runtime-tests/runtime-store-partial-fixture'

vi.mock('electron', () => ({
  app: { getPath: () => '/orca-state', isPackaged: true }
}))

function runtimeWithLegacySettings(values: {
  artifactSharingEnabled?: unknown
  agentSkillSharingEnabled?: unknown
}): OrcaRuntimeService {
  const store: Pick<RuntimeStore, 'getSettings'> = {
    getSettings: () => {
      const settings = getDefaultSettings('/tmp')
      // Persisted settings may contain non-booleans despite the declared schema.
      for (const [key, value] of Object.entries(values)) {
        Reflect.set(settings, key, value)
      }
      return settings
    }
  }
  const runtime = new OrcaRuntimeService(partialRuntimeStore(store))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: settings.get only checks that an artifact service is registered, never calls it.
  runtime.setArtifactService({} as never)
  return runtime
}

// Legacy persisted sharing flags cannot be used to create Cloud publishing permissions.
describe.each(['artifactSharingEnabled', 'agentSkillSharingEnabled'] as const)(
  '%s cannot be granted over RPC',
  (capability) => {
    it('rejects settings.update attempts to enable it', () => {
      expect(SettingsUpdate.safeParse({ [capability]: true }).success).toBe(false)
    })
  }
)

describe('retained artifact sharing', () => {
  it('publishes the capability read-only through settings.get', () => {
    expect(
      runtimeWithLegacySettings({ artifactSharingEnabled: true }).getClientSettings()
        .artifactSharingEnabled
    ).toBe(true)
    expect(
      runtimeWithLegacySettings({ artifactSharingEnabled: false }).getClientSettings()
        .artifactSharingEnabled
    ).toBe(false)
    expect(
      runtimeWithLegacySettings({ artifactSharingEnabled: undefined }).getClientSettings()
        .artifactSharingEnabled
    ).toBe(false)
  })

  it('fails closed for truthy non-booleans', () => {
    expect(
      runtimeWithLegacySettings({ artifactSharingEnabled: 'yes' }).getClientSettings()
        .artifactSharingEnabled
    ).toBe(false)
  })
})

it('never exposes the removed skill Cloud capability or publisher even if a legacy flag is enabled', () => {
  const runtime = runtimeWithLegacySettings({ agentSkillSharingEnabled: true })
  expect(runtime.getClientSettings()).not.toHaveProperty('agentSkillSharingEnabled')
  expect('setSkillCloudService' in runtime).toBe(false)
  expect('publishDiscoveredSkillsFromAgent' in runtime).toBe(false)
  expect('publishSkillPackage' in runtime).toBe(false)
  expect('listOwnedSkillShares' in runtime).toBe(false)
})

it('omits the artifact sharing toggle when the host has no service', () => {
  const runtime = new OrcaRuntimeService(
    partialRuntimeStore({ getSettings: () => getDefaultSettings('/tmp') })
  )

  const settings = runtime.getClientSettings()

  expect(settings).not.toHaveProperty('artifactSharingEnabled')
  expect(settings).not.toHaveProperty('agentSkillSharingEnabled')
})
