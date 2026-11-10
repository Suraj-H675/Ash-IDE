import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { orcadServeArgs } from '../../shared/orcad-serve-argv'
import {
  assertOrcadLocalOnlyOptions,
  ORCAD_LOOPBACK_BIND_HOST,
  resolveOrcadBindHost
} from './orcad-bind-address'
import { ORCAD_USAGE, parseArgs } from './orcad-command-arguments'
import { buildOrcadServeReadiness } from './orcad-serve-readiness'
import type { OrcadHealth } from './orcad-health'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Ash local-only Orcad network admission', () => {
  it('accepts default and explicit loopback-only socket hosts', () => {
    expect(resolveOrcadBindHost()).toBe(ORCAD_LOOPBACK_BIND_HOST)
    for (const address of ['localhost', '127.0.0.1', '127.0.0.2', '::1']) {
      const host = resolveOrcadBindHost(address)
      expect(host === ORCAD_LOOPBACK_BIND_HOST || host === address).toBe(true)
      expect(parseArgs(['--bind', address]).bind).toBe(address)
    }
  })

  it('refuses wildcard, external, and mapped IPv6 binds before startup', () => {
    for (const address of [
      '0.0.0.0',
      '::',
      '192.168.1.20',
      '8.8.8.8',
      'fe80::2',
      '::ffff:127.0.0.1',
      'example.com'
    ]) {
      expect(() => resolveOrcadBindHost(address), address).toThrow()
      expect(() => parseArgs(['--bind', address]), address).toThrow()
      expect(() => assertOrcadLocalOnlyOptions({ bind: address }), address).toThrow()
    }
  })

  it('rejects mobile, remote pairing, and desktop-control options at both boundaries', () => {
    for (const args of [
      ['--mobile-pairing'],
      ['--pairing-address', 'localhost'],
      ['--grant-desktop-control']
    ]) {
      expect(() => parseArgs(args)).toThrow()
    }
    for (const options of [
      { mobilePairing: true },
      { pairingAddress: 'localhost' },
      { grantDesktopControl: true }
    ]) {
      expect(() => assertOrcadLocalOnlyOptions(options)).toThrow(/does not support/)
    }
    expect(parseArgs(['--no-pairing']).noPairing).toBe(true)
    expect(ORCAD_USAGE).not.toContain('Create a mobile-scoped pairing offer')
    expect(ORCAD_USAGE).toContain('Loopback-only bind')
  })

  it('uses a loopback default in the legacy serve CLI builder', () => {
    expect(orcadServeArgs({})).toEqual(['--bind', '127.0.0.1'])
    expect(parseArgs(orcadServeArgs({})).bind).toBe('127.0.0.1')
    expect(() => parseArgs(orcadServeArgs({}, undefined, '0.0.0.0'))).toThrow(
      /loopback addresses only/
    )
  })

  it('publishes local readiness and health without minting startup pairing credentials', async () => {
    const health = {} as OrcadHealth
    const readiness = await buildOrcadServeReadiness({
      options: {},
      runtimeId: 'ash-runtime-1',
      rpc: { getWebSocketEndpoint: () => 'ws://127.0.0.1:6768' },
      collectHealth: async () => health
    })
    expect(readiness).toEqual({
      runtimeId: 'ash-runtime-1',
      boundEndpoint: 'ws://127.0.0.1:6768',
      advertisedEndpoint: null,
      pairing: {
        available: false,
        reason: 'disabled_by_product',
        guidance: 'Ash IDE does not support client pairing.'
      },
      managedWslCliReconciliation: 'settled',
      health
    })
    expect(source('src/main/orcad/orcad-serve-readiness.ts')).not.toContain(
      'buildServePairingReadiness'
    )
  })

  it('guards direct Orcad startup before any user-data or process side effects', () => {
    const entry = source('src/main/orcad/orcad-entry.ts')
    expect(entry).toMatch(
      /export async function startOrcad\([^]*?assertOrcadLocalOnlyOptions\(options\)[^]*?installOrcadHostAdapters\(\)/
    )
    expect(entry).not.toContain('DesktopPushService')
    expect(entry).not.toContain('resolvePushGatewayOrigin')
  })
})
