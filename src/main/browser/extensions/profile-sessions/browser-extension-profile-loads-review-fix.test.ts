import { describe, expect, it } from 'vitest'
import {
  BrowserExtensionLoadCancelledError,
  BrowserExtensionProfileLoads,
  throwIfBrowserExtensionLoadCancelled
} from './browser-extension-profile-loads'

async function cancellationAfter(
  reasons: ('user-disabled' | 'superseded' | 'detached')[]
): Promise<BrowserExtensionLoadCancelledError> {
  const loads = new BrowserExtensionProfileLoads()
  let started!: () => void
  let release!: () => void
  const loadStarted = new Promise<void>((resolve) => (started = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  const running = loads.track('extension-a', async (load) => {
    started()
    await gate
    throwIfBrowserExtensionLoadCancelled(load)
  })
  await loadStarted
  const cancellations = reasons.map((reason) => loads.cancel('extension-a', reason))
  release()
  await Promise.all(cancellations)
  try {
    await running
  } catch (error) {
    if (error instanceof BrowserExtensionLoadCancelledError) {
      return error
    }
    throw error
  }
  throw new Error('Expected the cancelled load to reject')
}

describe('browser extension load cancellation causes', () => {
  it('lets an explicit disable override an earlier reload supersession', async () => {
    const error = await cancellationAfter(['superseded', 'user-disabled'])

    expect(error.cancelledBy).toBe('user-disabled')
  })

  it('retains profile detach as its own lifecycle outcome', async () => {
    const error = await cancellationAfter(['detached'])

    expect(error.cancelledBy).toBe('detached')
  })
})
