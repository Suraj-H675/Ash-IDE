import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PairedServerRowsProducer } from '../sidebar-inputs/paired-server-rows-producer'
import { stampServerWorktreeRows } from './server-worktree-fetch'

const removedPhoneRelayModules = [
  'delegated-phone-grant-cache.ts',
  'delegated-phone-grants.ts',
  'hosted-browser-page-route.ts',
  'mobile-desktop-relay-link.ts',
  'mobile-desktop-relay-phone.test-fixture.ts',
  'mobile-desktop-relay.ts',
  'mobile-relay-host-catalog.ts',
  'on-demand-server-worktree-rows.ts',
  'relay-github-authority.ts',
  'relayed-browser-tab-create.ts',
  'relayed-phone-frames.ts',
  'relayed-stream-carriers.ts'
] as const

const retainedSidebarHelpers = [
  'mobile-desktop-relay-hosts.ts',
  'mobile-relay-host-descriptions.ts',
  'server-worktree-fetch.ts'
] as const

describe('Ash retires the unreachable mobile-desktop relay implementation', () => {
  it('removes the phone forwarding, delegated grants and remote browser relay modules', () => {
    const root = resolve(process.cwd(), 'src/main/runtime/mobile-desktop-relay')
    for (const file of removedPhoneRelayModules) {
      expect(existsSync(resolve(root, file)), file).toBe(false)
    }
    expect(readdirSync(root).sort()).toEqual(
      [...retainedSidebarHelpers, 'ash-retired-phone-relay-implementation.test.ts'].sort()
    )
  })

  it('preserves the inactive-by-default sidebar producer without any relay host', async () => {
    const producer = new PairedServerRowsProducer({
      hasDemand: () => false,
      hostLabelOverrides: () => new Map()
    })
    expect(producer.snapshot().servers).toEqual([])
    expect(producer.catalogs()).toEqual([])
    expect(producer.rows('historical-remote-host', 'old-pairing')).toBeNull()
    await expect(producer.refresh('historical-remote-host')).resolves.toBeUndefined()
    producer.sync()
    expect(producer.snapshot().servers).toEqual([])
  })

  it('retains sidebar worktree normalization without importing a phone relay', () => {
    expect(
      stampServerWorktreeRows('local-runtime', [
        { path: '/original/repo', hostId: 'ssh:obsolete', title: 'Workspace' }
      ])
    ).toEqual([{ path: '/original/repo', hostId: 'runtime:local-runtime', title: 'Workspace' }])
  })
})
