import { ipcMain, webContents } from 'electron'
import {
  BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL,
  type BrowserExtensionSupportStatus
} from '../../../shared/browser/extensions/browser-extension-types'
import {
  getBrowserExtensionSupportStatus,
  onBrowserExtensionSupportStatusChanged
} from '../../browser/extensions/browser-extension-support'
import { retryBrowserExtensionSupportTransition } from '../../browser/extensions/browser-extension-startup'
import { isTrustedBrowserRenderer } from './browser-renderer-trust'

const STATUS_CHANNEL = 'browserExtensions:supportStatus'
const RETRY_CHANNEL = 'browserExtensions:retrySupportTransition'

let unsubscribe: (() => void) | null = null

/** Only the trusted Orca renderer can read support status or retry native retirement. */
export function registerBrowserExtensionSupportHandlers(): void {
  ipcMain.removeHandler(STATUS_CHANNEL)
  ipcMain.removeHandler(RETRY_CHANNEL)
  unsubscribe?.()

  ipcMain.handle(STATUS_CHANNEL, (event): BrowserExtensionSupportStatus | null =>
    isTrustedBrowserRenderer(event.sender) ? getBrowserExtensionSupportStatus() : null
  )
  ipcMain.handle(RETRY_CHANNEL, async (event): Promise<BrowserExtensionSupportStatus | null> => {
    if (!isTrustedBrowserRenderer(event.sender)) {
      return null
    }
    await retryBrowserExtensionSupportTransition()
    return getBrowserExtensionSupportStatus()
  })

  unsubscribe = onBrowserExtensionSupportStatusChanged((status) => {
    for (const contents of webContents.getAllWebContents()) {
      if (isTrustedBrowserRenderer(contents) && !contents.isDestroyed()) {
        try {
          contents.send(BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL, status)
        } catch {
          // A trusted renderer can close between enumeration and delivery.
        }
      }
    }
  })
}
