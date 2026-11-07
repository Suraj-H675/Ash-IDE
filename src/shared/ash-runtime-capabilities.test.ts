import { describe, expect, it } from 'vitest'
import { ashRuntimeCapabilities } from './ash-runtime-capabilities'
import { RUNTIME_CAPABILITIES } from './protocol-version'

describe('Ash runtime capability reporting', () => {
  it('filters unsupported product surfaces and retains local terminal and browser capabilities', () => {
    const reported = ashRuntimeCapabilities(RUNTIME_CAPABILITIES)
    const excluded = /^(accounts\.|artifacts\.|automation\.|automations\.|browser\.desktopBridge\.|cloud\.|device\.|device-key\.|emulator\.|github\.|gitlab\.|hostedReview\.|jira\.|linear\.|managed-runtime\.|managedServer\.|mobile\.|mobileRelay\.|mobileWeb\.|network\.browserTunnel\.|notifications\.remote-|orcad\.|orchestration\.federation|pairing\.|plugin\.|plugins\.|project-host-setup\.|remote-runtime\.|remote-server\.|relay\.|runtime\.automatic-work\.|runtime\.environments\.|runtime\.status\.compat\.|skills\.|speech\.|ssh\.|task-source\.|telemetry\.|updater\.)/
    expect(reported.filter((capability) => excluded.test(capability))).toEqual([])
    expect(reported.some((capability) => capability.startsWith('terminal.'))).toBe(true)
    expect(reported.some((capability) => capability.startsWith('browser.'))).toBe(true)
    expect(reported.some((capability) => capability.startsWith('aiVault.'))).toBe(true)
  })

  it('filters capabilities added after the imported capability list', () => {
    expect(
      ashRuntimeCapabilities([
        'mobileWeb.bundle.v1',
        'network.browserTunnel.v1',
        'automations.surface.v1',
        'cloud.login.v1',
        'browser.desktopBridge.v1',
        'orchestration.federation-control-mail.v1',
        'relay.host.v1',
        'telemetry.enabled.v1',
        'managedServer.v1',
        'aiVault.v1',
        'browser.screencast.v1'
      ])
    ).toEqual(['aiVault.v1', 'browser.screencast.v1'])
  })
})
