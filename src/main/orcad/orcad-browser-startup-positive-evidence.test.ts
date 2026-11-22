import { describe, expect, it, vi } from 'vitest'
import { observedHostedBrowserBackend } from './orcad-browser-backend-positive-evidence'
import { startOrcadBrowserProvider } from './orcad-browser-startup'

const fixture = vi.hoisted(() => ({
  available: true,
  stopStarted: false,
  stopFails: false,
  cleanupUncertainAfterStop: false,
  failStartupWithUncertainCleanup: false,
  stopGate: null as (() => Promise<void>) | null
}))

vi.mock('./orcad-browser-provider', () => ({
  resolveOrcadBrowserProvider: async (options: { onUnresolvedStartupCleanup?: () => void }) => {
    if (fixture.failStartupWithUncertainCleanup) {
      options.onUnresolvedStartupCleanup?.()
      throw new Error('fixture-startup-with-unresolved-cleanup')
    }
    let cleanupUncertain = false
    return {
      kind: 'electron',
      factory: () => ({}),
      isAvailable: () => fixture.available,
      hasHostOwnedCleanup: () => cleanupUncertain,
      stop: async () => {
        fixture.stopStarted = true
        // Real Chromium and Electron providers flip availability before waiting.
        fixture.available = false
        await fixture.stopGate?.()
        if (fixture.stopFails) {
          throw new Error('fixture-browser-stop-failed')
        }
        cleanupUncertain = fixture.cleanupUncertainAfterStop
      }
    }
  }
}))

vi.mock('../runtime/browser/installation/runtime-browser-commands-factory', () => ({
  setRuntimeBrowserCommandsFactory: vi.fn(),
  browserUnavailableError: () => new Error('no-browser')
}))

describe('real orcad browser provider lifecycle publication', () => {
  it('reports its resolved backend and relinquishes only after successful stop', async () => {
    fixture.available = true
    fixture.stopStarted = false
    fixture.stopFails = false
    fixture.cleanupUncertainAfterStop = false
    fixture.failStartupWithUncertainCleanup = false
    fixture.stopGate = null
    const handle = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    try {
      await handle.ready
      expect(observedHostedBrowserBackend()).toBe(1)
      fixture.available = false
      expect(observedHostedBrowserBackend()).toBe(0)
      fixture.available = true
      expect(observedHostedBrowserBackend()).toBe(1)
    } finally {
      await handle.stop()
    }
    expect(fixture.stopStarted).toBe(true)
    expect(observedHostedBrowserBackend()).toBe(0)
  })

  it('retains backend-positive evidence while asynchronous cleanup has not settled', async () => {
    fixture.available = true
    fixture.stopStarted = false
    fixture.stopFails = false
    fixture.cleanupUncertainAfterStop = false
    fixture.failStartupWithUncertainCleanup = false
    let finish!: () => void
    const pendingStop = new Promise<void>((resolve) => {
      finish = resolve
    })
    fixture.stopGate = () => pendingStop
    const handle = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    try {
      await handle.ready
      expect(observedHostedBrowserBackend()).toBe(1)
      const stopping = handle.stop()
      await vi.waitFor(() => expect(fixture.stopStarted).toBe(true))
      expect(fixture.available).toBe(false)
      expect(observedHostedBrowserBackend()).toBe(1)
      finish()
      await stopping
    } finally {
      finish()
      await handle.stop()
    }
    expect(observedHostedBrowserBackend()).toBe(0)
  })

  it('retains positive evidence after failed cleanup until that owner confirms cleanup', async () => {
    fixture.available = true
    fixture.stopFails = true
    fixture.cleanupUncertainAfterStop = false
    fixture.failStartupWithUncertainCleanup = false
    fixture.stopGate = null
    const broken = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    await broken.ready
    expect(observedHostedBrowserBackend()).toBe(1)
    await expect(broken.stop()).rejects.toThrow('fixture-browser-stop-failed')
    // The external helper might still exist: its cleanup failure is not safe idle proof.
    expect(observedHostedBrowserBackend()).toBe(1)

    fixture.stopFails = false
    fixture.available = true
    const next = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    try {
      await next.ready
      expect(observedHostedBrowserBackend()).toBe(1)
      await broken.stop().catch(() => {})
      fixture.available = true
      expect(observedHostedBrowserBackend()).toBe(1)
    } finally {
      await next.stop()
    }
    expect(observedHostedBrowserBackend()).toBe(0)
  })

  it('keeps evidence after a resolved stop reports uncertain helper cleanup', async () => {
    fixture.available = true
    fixture.stopStarted = false
    fixture.stopFails = false
    fixture.cleanupUncertainAfterStop = true
    fixture.failStartupWithUncertainCleanup = false
    fixture.stopGate = null
    const uncertain = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    await uncertain.ready
    await uncertain.stop()
    expect(fixture.available).toBe(false)
    expect(observedHostedBrowserBackend()).toBe(1)

    fixture.cleanupUncertainAfterStop = false
    fixture.available = true
    const successor = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    try {
      await successor.ready
      expect(observedHostedBrowserBackend()).toBe(1)
      await uncertain.stop()
      fixture.available = true
      expect(observedHostedBrowserBackend()).toBe(1)
      await successor.stop()
    } finally {
      await successor.stop()
    }
    expect(observedHostedBrowserBackend()).toBe(0)
  })

  it('retains an unresolved predecessor while a failing successor registers, then clears on confirmed retry', async () => {
    fixture.available = true
    fixture.stopStarted = false
    fixture.stopFails = true
    fixture.cleanupUncertainAfterStop = false
    fixture.failStartupWithUncertainCleanup = false
    fixture.stopGate = null

    const predecessor = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    await predecessor.ready
    expect(observedHostedBrowserBackend()).toBe(1)
    await expect(predecessor.stop()).rejects.toThrow('fixture-browser-stop-failed')

    fixture.available = false
    const successor = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    try {
      await successor.ready
      expect(observedHostedBrowserBackend()).toBe(1)

      fixture.stopFails = false
      await predecessor.stop()
      expect(observedHostedBrowserBackend()).toBe(0)
    } finally {
      fixture.stopFails = false
      await Promise.allSettled([predecessor.stop(), successor.stop()])
      fixture.available = true
    }
  })

  it('retains positive evidence when startup cleanup is unresolved before a provider returns', async () => {
    fixture.failStartupWithUncertainCleanup = true
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failedStartup = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
    try {
      await failedStartup.ready
      expect(observedHostedBrowserBackend()).toBe(1)
      await expect(failedStartup.stop()).rejects.toThrow('fixture-startup-with-unresolved-cleanup')
      expect(observedHostedBrowserBackend()).toBe(1)

      fixture.failStartupWithUncertainCleanup = false
      fixture.available = true
      const successor = startOrcadBrowserProvider({ userDataPath: '/disposable-fixture' })
      await successor.ready
      await successor.stop()
      expect(observedHostedBrowserBackend()).toBe(1)
    } finally {
      warning.mockRestore()
      fixture.failStartupWithUncertainCleanup = false
    }
  })
})
