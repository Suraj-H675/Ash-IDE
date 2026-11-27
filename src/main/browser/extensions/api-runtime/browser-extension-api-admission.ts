import { BrowserExtensionApiError } from './browser-extension-namespace-registry'
import type { HostSessionState } from './browser-extension-contexts'

const retired = new WeakSet<HostSessionState>()
const pending = new WeakMap<Electron.Session, Set<Promise<void>>>()
const API_DRAIN_TIMEOUT_MS = 10_000

export function isBrowserExtensionApiStateRetired(state: HostSessionState): boolean {
  return retired.has(state)
}

export function retireBrowserExtensionApiState(state: HostSessionState): void {
  retired.add(state)
}

/** Track every admitted API method until its actual promise settles, not just management calls. */
export function beginBrowserExtensionApiCall(
  session: Electron.Session,
  state: HostSessionState
): () => void {
  if (retired.has(state)) {
    throw new BrowserExtensionApiError('Browser extension session is retiring')
  }
  const calls = pending.get(session) ?? new Set<Promise<void>>()
  pending.set(session, calls)
  let resolve!: () => void
  const settled = new Promise<void>((finish) => {
    resolve = finish
  })
  calls.add(settled)
  return () => {
    calls.delete(settled)
    resolve()
  }
}

/** A timeout is a failure, not permission to erase state while an admitted write is still active. */
export async function drainBrowserExtensionApiCalls(session: Electron.Session): Promise<void> {
  const calls = pending.get(session)
  if (!calls?.size) {
    return
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(calls),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Browser extension API retirement timed out')),
          API_DRAIN_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}
