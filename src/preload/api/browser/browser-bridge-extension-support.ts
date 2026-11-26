import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../../api-types'
import {
  BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL,
  type BrowserExtensionSupportStatus
} from '../../../shared/browser/extensions/browser-extension-types'

export const browserExtensionSupportApi = {
  extensionsSupportStatus: (): Promise<BrowserExtensionSupportStatus | null> =>
    ipcRenderer.invoke('browserExtensions:supportStatus'),
  extensionsRetrySupportTransition: (): Promise<BrowserExtensionSupportStatus | null> =>
    ipcRenderer.invoke('browserExtensions:retrySupportTransition'),
  onExtensionsSupportStatusChanged: (
    callback: (status: BrowserExtensionSupportStatus) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: BrowserExtensionSupportStatus
    ): void => callback(status)
    ipcRenderer.on(BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL, listener)
  }
} satisfies Partial<PreloadApi['browser']>
