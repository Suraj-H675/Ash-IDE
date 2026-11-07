import { describe, expect, it } from 'vitest'
import { shouldQuitWhenAllWindowsClosed } from './window-all-closed-quit-policy'

describe('Ash IDE last-window lifecycle', () => {
  it.each(['linux', 'win32', 'darwin'] as const)(
    'keeps the authenticated runtime when the last %s desktop window closes',
    (platform) => {
      expect(
        shouldQuitWhenAllWindowsClosed({
          platform,
          isQuitting: false,
          isServeMode: false,
          hasOpenedMainWindow: true
        })
      ).toBe(false)
    }
  )

  it('permits an explicitly initiated runtime quit', () => {
    expect(
      shouldQuitWhenAllWindowsClosed({
        platform: 'linux',
        isQuitting: true,
        isServeMode: false,
        hasOpenedMainWindow: true
      })
    ).toBe(true)
  })
})
