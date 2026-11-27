import { afterEach, describe, expect, it } from 'vitest'
import {
  isBrowserExtensionMutationPaused,
  pauseBrowserExtensionMutations,
  setBrowserExtensionSupportEnabled,
  withBrowserExtensionMutation
} from './browser-extension-support'

afterEach(() => setBrowserExtensionSupportEnabled(false))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe('profile-scoped extension mutation retirement', () => {
  it('retires only the selected profile and shared operations without blocking an unrelated profile', async () => {
    setBrowserExtensionSupportEnabled(true)
    const a = deferred()
    const b = deferred()
    const global = deferred()
    let aSignal!: AbortSignal
    let bSignal!: AbortSignal
    let globalSignal!: AbortSignal
    const activeA = withBrowserExtensionMutation(async (signal) => {
      aSignal = signal
      await a.promise
    }, 'profile-a')
    const activeB = withBrowserExtensionMutation(async (signal) => {
      bSignal = signal
      await b.promise
    }, 'profile-b')
    const activeGlobal = withBrowserExtensionMutation(async (signal) => {
      globalSignal = signal
      await global.promise
    })
    await Promise.resolve()
    let resume: (() => void) | undefined
    const pausing = pauseBrowserExtensionMutations('profile-a').then((release) => {
      resume = release
    })
    try {
      expect(aSignal.aborted).toBe(true)
      expect(globalSignal.aborted).toBe(true)
      expect(bSignal.aborted).toBe(false)
      expect(isBrowserExtensionMutationPaused('profile-a')).toBe(true)
      expect(isBrowserExtensionMutationPaused('profile-b')).toBe(false)
      await expect(withBrowserExtensionMutation(async () => 'a', 'profile-a')).rejects.toThrow()
      await expect(withBrowserExtensionMutation(async () => 'global')).rejects.toThrow()
      await expect(withBrowserExtensionMutation(async () => 'b', 'profile-b')).resolves.toBe('b')
      a.resolve()
      global.resolve()
      await pausing
      expect(bSignal.aborted).toBe(false)
      expect(resume).toBeTypeOf('function')
    } finally {
      a.resolve()
      b.resolve()
      global.resolve()
      await Promise.all([activeA, activeB, activeGlobal, pausing])
      resume?.()
    }
    expect(isBrowserExtensionMutationPaused('profile-a')).toBe(false)
  })

  it('preserves independent retirement barriers and still cancels all mutations on global disable', async () => {
    setBrowserExtensionSupportEnabled(true)
    const releaseA = await pauseBrowserExtensionMutations('profile-a')
    const releaseB = await pauseBrowserExtensionMutations('profile-b')
    const releaseA2 = await pauseBrowserExtensionMutations('profile-a')
    const c = deferred()
    let signal!: AbortSignal
    const activeC = withBrowserExtensionMutation(async (current) => {
      signal = current
      await c.promise
    }, 'profile-c')
    await Promise.resolve()
    try {
      releaseA()
      releaseA()
      expect(isBrowserExtensionMutationPaused('profile-a')).toBe(true)
      releaseA2()
      expect(isBrowserExtensionMutationPaused('profile-a')).toBe(false)
      expect(isBrowserExtensionMutationPaused('profile-b')).toBe(true)
      await expect(withBrowserExtensionMutation(async () => true, 'profile-a')).resolves.toBe(true)
      expect(signal.aborted).toBe(false)
      setBrowserExtensionSupportEnabled(false)
      expect(signal.aborted).toBe(true)
      releaseB()
      await expect(withBrowserExtensionMutation(async () => true, 'profile-a')).rejects.toThrow()
    } finally {
      releaseA()
      releaseA2()
      releaseB()
      c.resolve()
      await activeC
    }
  })
})
