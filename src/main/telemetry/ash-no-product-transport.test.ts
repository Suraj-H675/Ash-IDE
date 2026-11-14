import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { initTelemetry, isTelemetryEnabled, setOptIn, shutdownTelemetry, track } from './client'

const repoRoot = resolve(import.meta.dirname, '../../..')

describe('Ash excludes product analytics by construction', () => {
  it('cannot initialize product telemetry even for a historically opted-in profile', async () => {
    const settings = { telemetry: { optedIn: true, installId: 'historic-id' } }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn()
    }
    const scheduler = vi.fn()
    initTelemetry(store as never, scheduler)
    expect(scheduler).not.toHaveBeenCalled()
    expect(isTelemetryEnabled()).toBe(false)
    expect(track('telemetry_opted_in', { via: 'settings' })).toBe(false)
    await setOptIn('settings', false)
    expect(store.updateSettings).not.toHaveBeenCalled()
    expect(settings.telemetry.optedIn).toBe(true)
    await expect(shutdownTelemetry()).resolves.toBeUndefined()
  })

  it('has no PostHog SDK, network transport, or unused telemetry IPC registration source', () => {
    const removed = [
      'src/main/telemetry/posthog-transport.ts',
      'src/main/telemetry/posthog-client-start.ts',
      'src/main/telemetry/client-test-harness.ts',
      'src/main/ipc/telemetry.ts'
    ]
    for (const relative of removed) {
      expect(existsSync(resolve(repoRoot, relative)), relative).toBe(false)
    }
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(manifest.dependencies).not.toHaveProperty('posthog-node')
    const client = readFileSync(resolve(repoRoot, 'src/main/telemetry/client.ts'), 'utf8')
    expect(client).not.toMatch(/posthog-node|createPostHogClient|http[s]?:\/\/us\.i\.posthog\.com/)
    const build = readFileSync(resolve(repoRoot, 'electron.vite.config.ts'), 'utf8')
    expect(build).not.toContain('ORCA_POSTHOG_WRITE_KEY')
    const release = readFileSync(
      resolve(
        repoRoot,
        'config/scripts/release/javascript-artifacts/release-javascript-artifact.mjs'
      ),
      'utf8'
    )
    expect(release).toContain('Ash release must not include a product telemetry key')
    expect(release).toContain('telemetryKeySha256: null')
  })
})
