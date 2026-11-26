import { isAbsolute } from 'node:path'
import type {
  BrowserExtensionActionResult,
  BrowserExtensionListResult,
  InstalledBrowserExtension
} from '../../../shared/browser/extensions/browser-extension-types'
import { browserSessionRegistry } from '../sessions/browser-session-registry'
import { openBrowserExtensionOptionsPage } from './api/runtime'
import { getBrowserExtensionInstallStore } from './installation/browser-extension-install-store'
import { reloadBrowserExtensionWhereEnabled } from './profile-sessions/browser-extension-profile-reload'
import {
  readBrowserExtensionIconDataUrl,
  readBrowserExtensionManifest
} from './installation/browser-extension-manifest'
import {
  getBrowserExtensionSessionForProfile,
  listBrowserExtensionSessions,
  loadBrowserExtensionFolderIntoProfile,
  loadBrowserExtensionIntoProfile,
  unloadBrowserExtensionEverywhere,
  unloadBrowserExtensionFromProfile
} from './profile-sessions/browser-extension-session-loader'
import { clearBrowserExtensionSessionData } from './profile-storage/browser-extension-data-removal'
import {
  forgetHeldBrowserExtensionUpdate,
  getHeldBrowserExtensionUpdate
} from './web-store/browser-extension-held-updates'
import { browserExtensionIdForUnpackedFolder } from './installation/browser-extension-load-directory'
import {
  forgetBrowserExtensionLoadFailures,
  getBrowserExtensionLoadFailure
} from './profile-sessions/browser-extension-load-errors'
import { notifyBrowserExtensionListChanged } from './installation/browser-extension-list-changes'
import { reviewHeldBrowserExtensionUpdate } from './web-store/browser-extension-webstore-updater'
import { withBrowserExtensionLock } from './installation/browser-extension-webstore-install'
import {
  isBrowserExtensionSupportEnabled,
  withBrowserExtensionMutation
} from './browser-extension-support'
import {
  withExtensionEnabled,
  withoutExtension
} from './profile-sessions/browser-extension-profile-enablement'
import { forgetPinnedBrowserExtension } from './actions/browser-extension-toolbar-pins'
import { getBrowserExtensionProfileStateStore } from './profile-storage/browser-extension-profile-state-store'
import { getBrowserExtensionSyncStorageStore } from './profile-storage/browser-extension-sync-storage-store'
import { getBrowserExtensionDnrStore } from './declarative-net-request/session/browser-extension-dnr-store'
import { notifyChromeWebStoreUninstalled } from './web-store/browser-extension-webstore-events'
import { getBrowserExtensionRuntimeQuarantine } from './api-runtime/browser-extension-runtime-quarantine'

/** Settings actions. Each returns a result instead of throwing so the renderer can show the reason. */

async function settle(
  action: (signal: AbortSignal) => Promise<void>
): Promise<BrowserExtensionActionResult> {
  if (!isBrowserExtensionSupportEnabled()) {
    return { ok: false, error: 'Turn on browser extensions in Settings › Experimental' }
  }
  try {
    await withBrowserExtensionMutation(action)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function preserveQuarantinedEnablement(browserProfileId: string, extensionId: string): void {
  const sess = getBrowserExtensionSessionForProfile(browserProfileId)
  if (sess && getBrowserExtensionRuntimeQuarantine(sess, extensionId)) {
    browserSessionRegistry.updateEnabledExtensionIds((byProfile) =>
      withExtensionEnabled(byProfile, browserProfileId, extensionId, true)
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function listBrowserExtensionsForProfile(
  browserProfileId: string
): Promise<BrowserExtensionListResult> {
  if (!isBrowserExtensionSupportEnabled()) {
    return { active: false, extensions: [] }
  }
  const enabled = new Set(browserSessionRegistry.getEnabledExtensionIds(browserProfileId))
  const installed = getBrowserExtensionInstallStore().list()
  const extensions = await Promise.all(
    installed.map(async (extension) => ({
      id: extension.id,
      name: extension.name,
      version: extension.version,
      source: extension.source,
      enabled: enabled.has(extension.id),
      iconDataUrl: await readBrowserExtensionIconDataUrl(extension.path, extension.iconPath),
      hasOptionsPage: extension.optionsPage !== null,
      permissions: extension.permissions,
      loadError: enabled.has(extension.id)
        ? getBrowserExtensionLoadFailure(browserProfileId, extension.id)
        : null,
      heldUpdateVersion: getHeldBrowserExtensionUpdate(extension.id)?.version ?? null
    }))
  )
  return { active: true, extensions: extensions.sort((a, b) => a.name.localeCompare(b.name)) }
}

export function setBrowserExtensionEnabled(
  browserProfileId: string,
  extensionId: string,
  enabled: boolean
): Promise<BrowserExtensionActionResult> {
  return settle(async () => {
    if (!browserSessionRegistry.getProfile(browserProfileId)) {
      throw new Error('Browser profile not found')
    }
    await withBrowserExtensionLock(extensionId, async () => {
      if (!enabled) {
        try {
          await unloadBrowserExtensionFromProfile(browserProfileId, extensionId, 'user-disabled')
        } catch (error) {
          preserveQuarantinedEnablement(browserProfileId, extensionId)
          throw error
        }
        browserSessionRegistry.updateEnabledExtensionIds((byProfile) =>
          withExtensionEnabled(byProfile, browserProfileId, extensionId, false)
        )
        return
      }
      const installed = getBrowserExtensionInstallStore().get(extensionId)
      if (!installed) {
        throw new Error('Extension is not installed')
      }
      try {
        await loadBrowserExtensionIntoProfile(browserProfileId, installed)
      } catch (error) {
        preserveQuarantinedEnablement(browserProfileId, extensionId)
        throw error
      }
      browserSessionRegistry.updateEnabledExtensionIds((byProfile) =>
        withExtensionEnabled(byProfile, browserProfileId, extensionId, true)
      )
    })
  })
}

/** Best effort per profile: leftover data must not keep the extension installed. */
async function clearBrowserExtensionDataEverywhere(
  extensionId: string,
  sessions = listBrowserExtensionSessions()
): Promise<void> {
  await Promise.all(
    sessions.map((sess) =>
      clearBrowserExtensionSessionData(sess, extensionId).catch((error: unknown) => {
        console.warn(`[browser-extensions] Could not clear data for ${extensionId}:`, error)
      })
    )
  )
}

/** Removes the extension from every profile (Orca installs once, enables per profile), data included. */
export function removeBrowserExtension(extensionId: string): Promise<BrowserExtensionActionResult> {
  // Why the lock: an update committing mid-removal would reinstall the extension.
  return settle(() =>
    withBrowserExtensionLock(extensionId, async () => {
      // Why first: a failed native unload must leave every profile's stored data intact.
      const sessions = await unloadBrowserExtensionEverywhere(extensionId)
      // Why awaited: a load still in flight would write state the lines below forget.
      // An unloaded session marks its open chrome.storage for removal on the next launch.
      await clearBrowserExtensionDataEverywhere(extensionId, sessions)
      browserSessionRegistry.updateEnabledExtensionIds((byProfile) =>
        withoutExtension(byProfile, extensionId)
      )
      forgetPinnedBrowserExtension(extensionId)
      getBrowserExtensionProfileStateStore().forgetExtension(extensionId)
      getBrowserExtensionSyncStorageStore().forgetExtension(extensionId)
      getBrowserExtensionDnrStore().forgetExtension(extensionId)
      forgetBrowserExtensionLoadFailures({ extensionId })
      forgetHeldBrowserExtensionUpdate(extensionId)
      await getBrowserExtensionInstallStore().remove(extensionId)
      notifyChromeWebStoreUninstalled(extensionId)
      notifyBrowserExtensionListChanged()
    })
  )
}

/** Settings › Review access for an update held because it asks for more. */
export function reviewBrowserExtensionUpdate(
  extensionId: string,
  renderer: Electron.WebContents
): Promise<BrowserExtensionActionResult> {
  return settle((signal) => reviewHeldBrowserExtensionUpdate(extensionId, renderer, signal))
}

/** Settings › Reload for an unpacked extension: re-copies the folder and restarts it everywhere. */
export function reloadUnpackedBrowserExtension(
  extensionId: string
): Promise<BrowserExtensionActionResult> {
  // Why the lock: a removal finishing mid-reload would be undone by the save below.
  return settle(() =>
    withBrowserExtensionLock(extensionId, async () => {
      const store = getBrowserExtensionInstallStore()
      const installed = store.get(extensionId)
      if (installed?.source !== 'unpacked') {
        throw new Error('Only unpacked extensions can be reloaded')
      }
      const summary = await readBrowserExtensionManifest(installed.path)
      const record: InstalledBrowserExtension = {
        ...installed,
        name: summary.name,
        version: summary.version,
        iconPath: summary.iconPath,
        permissions: summary.permissions,
        hostPermissions: summary.hostPermissions,
        optionsPage: summary.optionsPage
      }
      store.save(record, true)
      await reloadBrowserExtensionWhereEnabled(record, { refresh: true })
    })
  )
}

/** Developer "Load unpacked…": loaded from Orca's copy, enabled for the profile it was added from. */
export function addUnpackedBrowserExtension(
  browserProfileId: string,
  directory: string
): Promise<BrowserExtensionActionResult> {
  return settle(async () => {
    if (!isAbsolute(directory)) {
      throw new Error('Choose an extension folder')
    }
    const summary = await readBrowserExtensionManifest(directory)
    const extensionId = await browserExtensionIdForUnpackedFolder(directory)
    // Why the lock: a removal finishing mid-load would be undone by the save below.
    await withBrowserExtensionLock(extensionId, async () => {
      const store = getBrowserExtensionInstallStore()
      // Why before loading: a refused folder must leave no loaded copy and no rewritten profile records.
      const existing = store.get(extensionId)
      if (existing?.source === 'webstore') {
        throw new Error(`${existing.name} is already installed from the Chrome Web Store`)
      }
      const record: InstalledBrowserExtension = {
        id: extensionId,
        name: summary.name,
        version: summary.version,
        path: directory,
        source: 'unpacked',
        iconPath: summary.iconPath,
        permissions: summary.permissions,
        hostPermissions: summary.hostPermissions,
        optionsPage: summary.optionsPage
      }
      // Native load emits extension-loaded; precedence must already be durable then.
      if (!existing) {
        store.save(record)
      }
      let loaded: Electron.Extension
      try {
        loaded = await loadBrowserExtensionFolderIntoProfile(
          browserProfileId,
          extensionId,
          directory,
          { refresh: existing === null }
        )
      } catch (error) {
        if (!existing) {
          try {
            await unloadBrowserExtensionFromProfile(browserProfileId, extensionId, 'user-disabled')
            await store.remove(extensionId)
          } catch (rollbackError) {
            preserveQuarantinedEnablement(browserProfileId, extensionId)
            throw new AggregateError(
              [error, rollbackError],
              `Could not clean up ${summary.name} after loading failed: ${errorMessage(error)}; ${errorMessage(rollbackError)}`
            )
          }
        }
        throw error
      }
      store.save({ ...record, version: loaded.version })
      browserSessionRegistry.updateEnabledExtensionIds((byProfile) =>
        withExtensionEnabled(byProfile, browserProfileId, loaded.id, true)
      )
    })
    notifyBrowserExtensionListChanged()
  })
}

export function openBrowserExtensionOptions(
  browserProfileId: string,
  extensionId: string
): Promise<BrowserExtensionActionResult> {
  return settle(async () => {
    const extension =
      getBrowserExtensionSessionForProfile(browserProfileId)?.extensions.getExtension(extensionId)
    if (!extension) {
      throw new Error('Turn the extension on to open its options')
    }
    await openBrowserExtensionOptionsPage(browserProfileId, extension)
  })
}
