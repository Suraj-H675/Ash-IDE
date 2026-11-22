import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcadBrowserProviderOptions } from './orcad-browser-provider'
import {
  observedHostedBrowserBackend,
  registerHostedBrowserBackendProbe
} from './orcad-browser-backend-positive-evidence'
import { startOrcadBrowserProvider } from './orcad-browser-startup'

type ParkHelper = {
  stop(): Promise<void>
  start(signal: AbortSignal): Promise<void>
}

const fixture = vi.hoisted(() => ({
  available: false,
  stopStarted: 0,
  stopFails: false,
  cleanupUncertainAfterStop: false,
  cleanupUncertain: false,
  stopGate: null as (() => Promise<void>) | null,
  parkHelper: null as ParkHelper | null
}))

vi.mock('./electron-serve-browser-process', () => ({
  ElectronServeBrowserProcess: class {
    async start() {
      fixture.available = true
    }
    async stop() {
      fixture.stopStarted += 1
      // Actual ElectronServeBrowserProcess.stop clears its metadata first.
      fixture.available = false
      await fixture.stopGate?.()
      if (fixture.stopFails) {
        fixture.cleanupUncertain = true
        throw new Error('park-browser-stop-failed')
      }
      fixture.cleanupUncertain = fixture.cleanupUncertainAfterStop
    }
    isAvailable() {
      return fixture.available
    }
    pid() {
      return fixture.available ? 1234 : null
    }
    hasHostOwnedCleanup() {
      return fixture.cleanupUncertain
    }
    supportsGoogleCookieClear() {
      return false
    }
    createCommands() {
      return {}
    }
  }
}))

vi.mock('./orcad-browser-install-park', () => ({
  openOrcadBrowserInstallPark: (_executable: string, helper: ParkHelper) => {
    fixture.parkHelper = helper
    return { close: async () => {} }
  }
}))

vi.mock('../runtime/browser/installation/runtime-browser-commands-factory', () => ({
  setRuntimeBrowserUnavailableCause: vi.fn(),
  setRuntimeBrowserCommandsFactory: vi.fn(),
  browserUnavailableError: () => new Error('browser-unavailable')
}))

const roots: string[] = []
const handles: ReturnType<typeof startOrcadBrowserProvider>[] = []

async function startFixtureHost() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ash-browser-park-observation-'))
  roots.push(userDataPath)
  const options: OrcadBrowserProviderOptions = {
    userDataPath,
    resolveInstalledElectronExecutable: async () => '/fixture/ash-electron'
  }
  const handle = startOrcadBrowserProvider(options)
  handles.push(handle)
  await handle.ready
  expect(fixture.parkHelper).not.toBeNull()
  return handle
}

afterEach(async () => {
  fixture.stopGate = null
  fixture.stopFails = false
  fixture.cleanupUncertainAfterStop = false
  fixture.cleanupUncertain = false
  await Promise.allSettled(handles.splice(0).map((handle) => handle.stop()))
  // An intentional failed-stop probe remains installed until a successor or
  // process exit. Reset only the isolated test registry between fixtures.
  registerHostedBrowserBackendProbe(() => false)()
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
  fixture.parkHelper = null
  fixture.available = false
  fixture.stopStarted = 0
})

describe('Electron browser install-park hosted-backend evidence', () => {
  it('retains positive evidence through an internal park stop even after availability flips false', async () => {
    await startFixtureHost()
    expect(observedHostedBrowserBackend()).toBe(1)
    let release!: () => void
    const heldStop = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.stopGate = () => heldStop
    const helper = fixture.parkHelper!
    const stopping = helper.stop()
    try {
      await vi.waitFor(() => expect(fixture.stopStarted).toBe(1))
      expect(fixture.available).toBe(false)
      expect(observedHostedBrowserBackend()).toBe(1)
    } finally {
      release()
    }
    await stopping
    expect(observedHostedBrowserBackend()).toBe(0)
    fixture.stopGate = null
    await helper.start(new AbortController().signal)
    expect(observedHostedBrowserBackend()).toBe(1)
  })

  it('retains an uncertain park-stop failure until the helper restarts or the host exits', async () => {
    await startFixtureHost()
    fixture.stopFails = true
    const helper = fixture.parkHelper!
    await expect(helper.stop()).rejects.toThrow('park-browser-stop-failed')
    expect(fixture.available).toBe(false)
    expect(observedHostedBrowserBackend()).toBe(1)
    fixture.stopFails = false
    await helper.start(new AbortController().signal)
    expect(observedHostedBrowserBackend()).toBe(1)
  })

  it('keeps a resolved stop positive until the process handle confirms cleanup', async () => {
    await startFixtureHost()
    const helper = fixture.parkHelper!
    fixture.cleanupUncertainAfterStop = true

    await helper.stop()
    expect(observedHostedBrowserBackend()).toBe(1)

    fixture.cleanupUncertainAfterStop = false
    await helper.stop()
    expect(observedHostedBrowserBackend()).toBe(0)
  })
})
