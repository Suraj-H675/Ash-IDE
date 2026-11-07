import { app, BrowserWindow, nativeImage } from 'electron'
import ashIcon from '../../../../resources/ash-build/icon.png?asset'

export function getAppIconPath(_value?: unknown): string {
  return ashIcon
}

export function createAppIconImage(_value?: unknown): Electron.NativeImage {
  return nativeImage.createFromPath(ashIcon)
}

export function applyAppIcon(_value?: unknown): void {
  const image = createAppIconImage()
  if (image.isEmpty()) {
    return
  }
  if (process.platform === 'darwin') {
    app.dock?.setIcon(image)
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.setIcon(image)
    }
  }
}
