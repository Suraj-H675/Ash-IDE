import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_RPC_METHODS, ASH_RPC_METHODS } from './index'
import { ASH_RUNTIME_CONTROL_METHODS } from './ash-runtime-control'
import { MANAGED_SERVER_METHODS } from './managed-server'
import { EMULATOR_METHODS } from './emulator'
import { MOBILE_PROJECT_SECTIONS_METHODS } from './mobile-project-sections'
import { MOBILE_RELAY_HOSTS_METHODS } from './mobile-relay-hosts'
import { MOBILE_WEB_BUNDLE_METHODS } from './mobile-web-bundle'
import { PAIRING_METHODS } from './pairing'
import { PLUGIN_DEV_EMIT_METHODS } from './plugin-dev-emit'
import { PLUGIN_DEV_REQUEST_METHODS } from './plugin-dev-request'
import { PLUGIN_METHODS } from './plugins'
import { PLUGIN_VIEW_METHODS } from './plugin-view'
import { SKILL_METHODS } from './skills'
import { SPEECH_METHODS } from './speech'
import { SSH_METHODS } from './ssh'

const methodNames = new Set<string>(ASH_RPC_METHODS.map(({ name }) => name))
const allMethodNames = new Set<string>(ALL_RPC_METHODS.map(({ name }) => name))

describe('Ash authenticated RPC surface', () => {
  it('does not load or register the retired mobile-only RPC groups in the full server manifest', () => {
    const excludedGroups = [
      EMULATOR_METHODS,
      MOBILE_PROJECT_SECTIONS_METHODS,
      MOBILE_RELAY_HOSTS_METHODS,
      MOBILE_WEB_BUNDLE_METHODS,
      PAIRING_METHODS
    ]
    const fullManifestSource = readFileSync(
      resolve(process.cwd(), 'src/main/runtime/rpc/methods/index.ts'),
      'utf8'
    )
    for (const symbol of [
      'EMULATOR_METHODS',
      'MOBILE_PROJECT_SECTIONS_METHODS',
      'MOBILE_RELAY_HOSTS_METHODS',
      'MOBILE_WEB_BUNDLE_METHODS',
      'PAIRING_METHODS'
    ]) {
      expect(fullManifestSource, symbol).not.toContain(symbol)
    }
    for (const group of excludedGroups) {
      for (const { name } of group) {
        expect(allMethodNames.has(name), `${name} must not enter the full server manifest`).toBe(
          false
        )
        expect(methodNames.has(name), `${name} must not enter Ash RPC`).toBe(false)
      }
    }
    expect(allMethodNames.has('browser.tabCreate')).toBe(true)
    expect(allMethodNames.has('orchestration.run')).toBe(true)
  })

  it('does not load or register excluded SSH, managed server, speech, plugin, or skill RPC groups', () => {
    const excludedGroups = [
      { symbol: 'SSH_METHODS', prefix: 'ssh.', methods: SSH_METHODS },
      {
        symbol: 'MANAGED_SERVER_METHODS',
        prefix: 'managedServer.',
        methods: MANAGED_SERVER_METHODS
      },
      { symbol: 'SPEECH_METHODS', prefix: 'speech.', methods: SPEECH_METHODS },
      { symbol: 'PLUGIN_METHODS', prefix: 'plugins.', methods: PLUGIN_METHODS },
      { symbol: 'PLUGIN_VIEW_METHODS', prefix: 'plugins.', methods: PLUGIN_VIEW_METHODS },
      {
        symbol: 'PLUGIN_DEV_EMIT_METHODS',
        prefix: 'plugins.',
        methods: PLUGIN_DEV_EMIT_METHODS
      },
      {
        symbol: 'PLUGIN_DEV_REQUEST_METHODS',
        prefix: 'plugins.',
        methods: PLUGIN_DEV_REQUEST_METHODS
      },
      { symbol: 'SKILL_METHODS', prefix: 'skills.', methods: SKILL_METHODS }
    ]
    const fullManifestSource = readFileSync(
      resolve(process.cwd(), 'src/main/runtime/rpc/methods/index.ts'),
      'utf8'
    )
    for (const { symbol, prefix, methods } of excludedGroups) {
      expect(fullManifestSource, `${symbol} import`).not.toContain(`import { ${symbol} } from`)
      expect(fullManifestSource, `${symbol} registration`).not.toContain(`...${symbol}`)
      for (const { name } of methods) {
        expect(name.startsWith(prefix), `${symbol} must contain only excluded methods`).toBe(true)
        expect(allMethodNames.has(name), `${name} must not enter the full server manifest`).toBe(
          false
        )
        expect(methodNames.has(name), `${name} must not enter Ash RPC`).toBe(false)
      }
    }
    expect(allMethodNames.has('browser.tabCreate')).toBe(true)
    expect(methodNames.has('browser.tabCreate')).toBe(true)
    expect(allMethodNames.has('orchestration.run')).toBe(true)
    expect(methodNames.has('orchestration.run')).toBe(true)
    expect([...methodNames].some((name) => name.startsWith('terminal.'))).toBe(true)
    expect(allMethodNames.has('git.status')).toBe(true)
    expect(methodNames.has('git.status')).toBe(true)
  })

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
      'notifications.registerPush',
      'notifications.testPush',
      'notifications.unregisterPush',
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

  it('omits scheduled automation methods from the registered RPC manifest and keeps orchestration Runs', () => {
    for (const name of [...allMethodNames, ...methodNames]) {
      expect(name.startsWith('automation.'), `${name} must not be registered`).toBe(false)
      expect(name.startsWith('automations.'), `${name} must not be registered`).toBe(false)
    }
    expect(allMethodNames.has('orchestration.run')).toBe(true)
    expect(methodNames.has('orchestration.run')).toBe(true)
  })

  it('does not even import excluded Jira or Linear methods into the broad server manifest', () => {
    for (const name of [...allMethodNames, ...methodNames]) {
      expect(name.startsWith('jira.'), `${name} must not enter server RPC manifests`).toBe(false)
      expect(name.startsWith('linear.'), `${name} must not enter server RPC manifests`).toBe(false)
    }
    expect(allMethodNames.has('git.status')).toBe(true)
    expect(allMethodNames.has('orchestration.run')).toBe(true)
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
