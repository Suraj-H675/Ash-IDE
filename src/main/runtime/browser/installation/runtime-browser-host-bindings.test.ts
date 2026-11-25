import { describe, expect, it } from 'vitest'
import type { BrowserBackend } from '../../../browser/browser-backend'
import { RuntimeBrowserHostBindings } from './runtime-browser-host-bindings'

describe('RuntimeBrowserHostBindings offscreen backend access', () => {
  it('exposes the installed backend only while no authoritative window is available', () => {
    const backend = {} as BrowserBackend
    let authoritativeWindowAvailable = false
    // This binding is tested without constructing the runtime's unrelated service graph.
    const runtime = Object.create(
      RuntimeBrowserHostBindings.prototype
    ) as RuntimeBrowserHostBindings
    Object.assign(runtime as unknown as Record<string, unknown>, {
      offscreenBrowserBackend: backend,
      getAvailableAuthoritativeWindow: () =>
        authoritativeWindowAvailable ? { isDestroyed: () => false } : null
    })

    expect(runtime.getOffscreenBrowserBackend()).toBe(backend)
    expect(runtime.getInstalledOffscreenBrowserBackend()).toBe(backend)

    authoritativeWindowAvailable = true
    expect(runtime.getOffscreenBrowserBackend()).toBeNull()
    expect(runtime.getInstalledOffscreenBrowserBackend()).toBe(backend)
  })
})
