import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalChromiumLaunch } from './external-chromium-browser-session'
import { ExternalChromiumBrowserProcess } from './external-chromium-browser-process'
import { resolveOrcadBrowserProvider } from './orcad-browser-provider'

const fixture = vi.hoisted(() => ({
  stopOutcome: 'confirmed' as 'confirmed' | 'unresolved',
  startFails: false
}))

vi.mock('./external-chromium-browser-session', () => ({
  ExternalChromiumBrowserSession: class {
    async start() {
      if (fixture.startFails) {
        throw new Error('fixture-browser-start-failed')
      }
      return 'agent-browser-page'
    }

    async stop() {
      return fixture.stopOutcome
    }
  }
}))

afterEach(() => {
  fixture.stopOutcome = 'confirmed'
  fixture.startFails = false
})

describe('external Chromium cleanup evidence', () => {
  it('keeps failed close uncertainty separate from command availability', async () => {
    const launch: ExternalChromiumLaunch = {
      executablePath: '/fixture/chromium',
      provider: 'chromium'
    }
    const browser = new ExternalChromiumBrowserProcess(
      '/fixture/agent-browser',
      launch,
      '/tmp/profile'
    )

    await browser.start()
    expect(browser.isAvailable()).toBe(true)
    expect(browser.hasHostOwnedCleanup()).toBe(false)

    fixture.stopOutcome = 'unresolved'
    await browser.stop()
    expect(browser.isAvailable()).toBe(false)
    expect(browser.hasHostOwnedCleanup()).toBe(true)

    fixture.stopOutcome = 'confirmed'
    await browser.stop()
    expect(browser.hasHostOwnedCleanup()).toBe(false)
  })

  it('clears prior uncertainty after a successful restart', async () => {
    const launch: ExternalChromiumLaunch = {
      executablePath: '/fixture/chromium',
      provider: 'chromium'
    }
    const browser = new ExternalChromiumBrowserProcess(
      '/fixture/agent-browser',
      launch,
      '/tmp/profile'
    )

    await browser.start()
    fixture.stopOutcome = 'unresolved'
    await browser.stop()
    expect(browser.hasHostOwnedCleanup()).toBe(true)

    await browser.start()
    expect(browser.isAvailable()).toBe(true)
    expect(browser.hasHostOwnedCleanup()).toBe(false)
  })

  it('reports unresolved cleanup when provider startup fails before it can return', async () => {
    fixture.startFails = true
    fixture.stopOutcome = 'unresolved'
    const userDataPath = mkdtempSync(join(tmpdir(), 'ash-browser-startup-cleanup-'))
    const reportUnresolvedCleanup = vi.fn()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(
        resolveOrcadBrowserProvider({
          userDataPath,
          environment: { ORCA_BROWSER_EXECUTABLE: process.execPath },
          resolveInstalledElectronExecutable: async () => null,
          resolveAgentBrowserBinary: () => process.execPath,
          onUnresolvedStartupCleanup: reportUnresolvedCleanup
        })
      ).resolves.toBeNull()
      expect(reportUnresolvedCleanup).toHaveBeenCalledOnce()
    } finally {
      warning.mockRestore()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
