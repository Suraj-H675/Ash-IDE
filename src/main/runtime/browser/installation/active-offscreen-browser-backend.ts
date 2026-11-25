import type { BrowserBackend } from '../../../browser/browser-backend'

/** Runtime slices share the backend accessor through the composed RuntimeService type. */
export function activeOffscreenBrowserBackend(runtime: object): BrowserBackend | null {
  const host = runtime as unknown as {
    getOffscreenBrowserBackend(): BrowserBackend | null
  }
  return host.getOffscreenBrowserBackend()
}
