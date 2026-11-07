import { describe, expect, it, vi } from 'vitest'

const { dockSetIcon, liveWindow, destroyedWindow, getWindows, createFromPath, image } = vi.hoisted(
  () => {
    const image = { isEmpty: vi.fn(() => false) }
    const liveWindow = { isDestroyed: vi.fn(() => false), setIcon: vi.fn() }
    const destroyedWindow = { isDestroyed: vi.fn(() => true), setIcon: vi.fn() }
    return {
      dockSetIcon: vi.fn(),
      liveWindow,
      destroyedWindow,
      getWindows: vi.fn(() => [liveWindow, destroyedWindow]),
      createFromPath: vi.fn(() => image),
      image
    }
  }
)

vi.mock('electron', () => ({
  app: { dock: { setIcon: dockSetIcon } },
  BrowserWindow: { getAllWindows: getWindows },
  nativeImage: { createFromPath }
}))

vi.mock('../../../../resources/ash-build/icon.png?asset', () => ({ default: 'ash-bundle-icon' }))

import { applyAppIcon, createAppIconImage, getAppIconPath } from './app-icon'

describe('Ash app icon', () => {
  it('uses the Ash-owned bundle image for current and legacy setting values', () => {
    expect(getAppIconPath()).toBe('ash-bundle-icon')
    expect(getAppIconPath('watercolor')).toBe('ash-bundle-icon')
    expect(createAppIconImage('blue')).toBe(image)
    expect(createFromPath).toHaveBeenCalledWith('ash-bundle-icon')
  })

  it('applies the Ash image to every live desktop window', () => {
    applyAppIcon('classic')

    expect(liveWindow.setIcon).toHaveBeenCalledWith(image)
    expect(destroyedWindow.setIcon).not.toHaveBeenCalled()
  })
})
