import { describe, expect, it } from 'vitest'
import { ASH_RPC_METHODS } from './index'
import { ASH_RUNTIME_CONTROL_METHODS } from './ash-runtime-control'

const methodNames = new Set<string>(ASH_RPC_METHODS.map(({ name }) => name))

describe('Ash authenticated RPC surface', () => {
  it('retains local status, terminal, Git, and agent launch methods', () => {
    expect(methodNames.has('status.get')).toBe(true)
    expect([...methodNames].some((name) => name.startsWith('terminal.'))).toBe(true)
    expect(methodNames.has('git.status')).toBe(true)
    expect([...methodNames].some((name) => name.toLowerCase().includes('agentlaunch'))).toBe(true)
    expect(methodNames.has('runtime.stop')).toBe(true)
    expect(methodNames.has('aiVault.listSessions')).toBe(true)
  })

  it('does not register excluded remote, cloud, scheduled, or marketplace methods', () => {
    const excluded = [
      'automation.list',
      'automations.list',
      'accounts.list',
      'artifacts.publish',
      'cloud.login',
      'connector.start',
      'desktopBrowserBridge.attach',
      'emulator.list',
      'github.listIssues',
      'jira.status',
      'linear.status',
      'mobile.tasks.list',
      'pairing.getEndpoints',
      'pairing.registerDeviceKey',
      'host.peerDesktops',
      'host.declareClient',
      'mobileWeb.bundle.manifest',
      'mobileRelay.projectSections',
      'network.browserTunnel',
      'orchestration.federationFleetSnapshot',
      'projectHostSetup.create',
      'plugins.open',
      'relay.host.start',
      'remoteRuntime.status',
      'skills.install',
      'speech.transcribe',
      'ssh.listTargets',
      'telemetry.send',
      'updater.check'
    ]
    for (const name of excluded) {
      expect(methodNames.has(name), `${name} must not be registered`).toBe(false)
    }
    expect(methodNames.has('layout.getRemoteSnapshots')).toBe(false)
    expect(methodNames.has('layout.subscribe')).toBe(true)
    expect(methodNames.has('orchestration.run')).toBe(true)
  })

  it('requires explicit confirmation for runtime shutdown RPC', () => {
    const stopMethod = ASH_RUNTIME_CONTROL_METHODS[0]!
    expect(
      stopMethod.params.safeParse({
        confirmed: true,
        expectedRuntimeId: 'runtime-a',
        mode: 'graceful'
      }).success
    ).toBe(true)
    expect(
      stopMethod.params.safeParse({ expectedRuntimeId: 'runtime-a', mode: 'graceful' }).success
    ).toBe(false)
  })
})
