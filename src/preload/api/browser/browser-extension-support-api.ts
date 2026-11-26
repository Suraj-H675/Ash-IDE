import type { BrowserExtensionSupportStatus } from '../../../shared/browser/extensions/browser-extension-types'

export type BrowserExtensionSupportApi = {
  extensionsSupportStatus: () => Promise<BrowserExtensionSupportStatus | null>
  extensionsRetrySupportTransition: () => Promise<BrowserExtensionSupportStatus | null>
  onExtensionsSupportStatusChanged: (
    callback: (status: BrowserExtensionSupportStatus) => void
  ) => () => void
}
