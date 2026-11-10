import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { NOTIFICATION_METHODS } from './notifications'
import { ALL_RPC_METHODS, ASH_RPC_METHODS } from './index'

const excludedPushMethods = [
  'notifications.registerPush',
  'notifications.testPush',
  'notifications.unregisterPush'
] as const

describe('Ash desktop-only notifications and mobile push exclusion', () => {
  it('does not register any mobile push RPC in the full source manifest or active Ash dispatch', () => {
    for (const manifest of [NOTIFICATION_METHODS, ALL_RPC_METHODS, ASH_RPC_METHODS]) {
      const names = new Set<string>(manifest.map(({ name }) => name))
      for (const method of excludedPushMethods) {
        expect(names.has(method), method).toBe(false)
      }
      // Local notification delivery and reconnection remain part of the product.
      for (const method of [
        'notifications.subscribe',
        'notifications.unsubscribe',
        'notifications.getMissedSince',
        'notifications.reportDesktopPresence'
      ]) {
        expect(names.has(method), method).toBe(true)
      }
    }
  })

  it('returns method_not_found for mobile push even to a local owner or previously paired client', async () => {
    const dispatcher = new RpcDispatcher({ runtime: new OrcaRuntimeService() })
    for (const scope of [
      { kind: 'owner' } as const,
      { kind: 'runtime-paired', grants: [] } as const
    ]) {
      for (const method of excludedPushMethods) {
        const response = await dispatcher.dispatch(
          { id: `excluded-${scope.kind}-${method}`, authToken: 'unused', method, params: {} },
          { callerScope: scope }
        )
        expect(response.ok, method).toBe(false)
        if (!response.ok) {
          expect(response.error.code, method).toBe('method_not_found')
        }
      }
    }
  })

  it('does not retain a hidden desktop startup path to a vendor mobile push gateway', () => {
    const root = process.cwd()
    expect(existsSync(resolve(root, 'src/main/startup/main-process-push-startup.ts'))).toBe(false)
    const state = readFileSync(resolve(root, 'src/main/startup/main-process-state.ts'), 'utf8')
    const quit = readFileSync(resolve(root, 'src/main/startup/main-process-quit.ts'), 'utf8')
    const headless = readFileSync(resolve(root, 'src/main/orcad/orcad-entry.ts'), 'utf8')
    for (const source of [state, quit, headless]) {
      expect(source).not.toContain('desktopPushService')
      expect(source).not.toContain('DesktopPushService')
      expect(source).not.toContain('resolvePushGatewayOrigin')
    }
  })
})
