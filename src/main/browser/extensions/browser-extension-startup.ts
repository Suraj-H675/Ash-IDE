import { removeRetiredBrowserExtensionProfileStorage } from './profile-storage/browser-extension-retired-profile-storage'
import { app, webContents } from 'electron'
import { isBrowserExtensionNativePage } from './api-runtime/browser-extension-native-page'
import { BROWSER_EXTENSIONS_CHANGED_CHANNEL } from '../../../shared/browser/extensions/browser-extension-types'
import {
  installBrowserExtensionApiHost,
  getBrowserExtensionProfileIdForSession
} from './api-runtime/browser-extension-api-host'
import {
  drainBrowserExtensionMutations,
  getBrowserExtensionSupportStatus,
  setBrowserExtensionSupportDesired,
  setBrowserExtensionSupportEnabled,
  setBrowserExtensionSupportRuntime
} from './browser-extension-support'
import { browserSessionRegistry } from '../sessions/browser-session-registry'
import {
  attachBrowserExtensionsToProfileSession,
  detachBrowserExtensionsFromAllProfileSessions,
  whenBrowserExtensionProfileRestored
} from './profile-sessions/browser-extension-session-loader'
import { notifyBrowserExtensionActionsChanged } from './actions/browser-extension-action-registry'
import { registerBrowserExtensionNamespaces } from './register-browser-extension-namespaces'
import { observeBrowserExtensionTabLifecycle } from './api/tabs-lifecycle'
import { observeBrowserExtensionWebNavigation } from './api/web-navigation'
import { observeBrowserExtensionCommands } from './api/commands'
import { observeBrowserExtensionDnrContents } from './declarative-net-request/session/browser-extension-dnr-contents'
import { installBrowserExtensionSessionServices } from './profile-sessions/browser-extension-session-services'
import { installBrowserExtensionToolbarNotifications } from './actions/browser-extension-toolbar'
import { installChromeWebStoreBridgeHost } from './web-store/browser-extension-webstore-bridge-host'
import { startBrowserExtensionUpdateChecks } from './web-store/browser-extension-webstore-updater'
import {
  notifyBrowserExtensionListChanged,
  setBrowserExtensionListChangedListener
} from './installation/browser-extension-list-changes'
import { getBrowserExtensionMainWindow } from './tabs-and-windows/browser-extension-window-model'
import {
  setSavedBrowserTabsSource,
  type SavedBrowserTabsSource
} from './tabs-and-windows/browser-extension-discarded-tabs'

let initialized = false
let switching = Promise.resolve()
let enablingAbortController: AbortController | null = null
let savedBrowserTabs: SavedBrowserTabsSource | null = null

/** Runs before browser sessions are set up; with the setting off nothing is registered or loaded. */
export function initializeBrowserExtensionSupport(options: {
  enabled: boolean
  /** The saved workspace session, which names browser pages not loaded yet (discarded tabs). */
  savedBrowserTabs?: SavedBrowserTabsSource
}): void {
  void removeRetiredBrowserExtensionProfileStorage().catch((error: unknown) => {
    console.warn('[browser-extensions] Could not remove retired profile storage:', error)
  })
  savedBrowserTabs = options.savedBrowserTabs ?? null
  setBrowserExtensionSupportEnabled(options.enabled)
  if (options.enabled) {
    installBrowserExtensionSupport()
  }
}

/**
 * The experimental setting changed while Orca runs. Off unloads every profile's extensions and
 * keeps their data; on loads them into every open profile, as a launch would.
 */
export function switchBrowserExtensionSupport(enabled: boolean): Promise<void> {
  const current = getBrowserExtensionSupportStatus()
  if (
    enabled === current.desiredEnabled &&
    ((enabled && current.runtime === 'enabled') || (!enabled && current.runtime === 'disabled'))
  ) {
    return switching
  }

  if (!enabled) {
    enablingAbortController?.abort()
  }
  setBrowserExtensionSupportDesired(enabled)
  if (!enabled) {
    setBrowserExtensionSupportRuntime('disabling')
  } else if (
    current.runtime === 'disabling' ||
    current.runtime === 'unload-failed' ||
    current.runtime === 'enable-failed'
  ) {
    setBrowserExtensionSupportRuntime('disabling')
  } else if (current.runtime === 'disabled') {
    setBrowserExtensionSupportRuntime('enabling')
  }

  const transition = switching.then(reconcileBrowserExtensionSupport)
  switching = transition.catch(() => {
    const runtime = getBrowserExtensionSupportStatus().runtime
    setBrowserExtensionSupportRuntime(
      runtime === 'disabling' || runtime === 'unload-failed' ? 'unload-failed' : 'enable-failed'
    )
    console.warn('[browser-extensions] Support transition failed; recovery is required')
    notifyBrowserExtensionSupportViews()
  })
  return switching
}

/** Retries the current desired state, including a disable that already failed once. */
export function retryBrowserExtensionSupportTransition(): Promise<void> {
  const current = getBrowserExtensionSupportStatus()
  if (current.runtime !== 'unload-failed' && current.runtime !== 'enable-failed') {
    return switching
  }
  return switchBrowserExtensionSupport(current.desiredEnabled)
}

async function reconcileBrowserExtensionSupport(): Promise<void> {
  let current = getBrowserExtensionSupportStatus()
  if (
    (current.runtime === 'enabled' && current.desiredEnabled) ||
    (current.runtime === 'disabled' && !current.desiredEnabled)
  ) {
    return
  }

  if (
    current.runtime === 'disabling' ||
    current.runtime === 'unload-failed' ||
    current.runtime === 'enable-failed'
  ) {
    setBrowserExtensionSupportRuntime('disabling')
    await drainBrowserExtensionMutations()
    try {
      await detachBrowserExtensionsFromAllProfileSessions()
    } catch {
      setBrowserExtensionSupportRuntime('unload-failed')
      notifyBrowserExtensionSupportViews()
      return
    }
  }

  current = getBrowserExtensionSupportStatus()
  if (current.desiredEnabled) {
    setBrowserExtensionSupportRuntime('enabling')
    const abortController = new AbortController()
    enablingAbortController = abortController
    try {
      installBrowserExtensionSupport()
      while (!abortController.signal.aborted) {
        const profiles = browserSessionRegistry.listProfiles()
        for (const profile of profiles) {
          attachBrowserExtensionsToProfileSession(
            profile,
            browserSessionRegistry.getEnabledExtensionIds(profile.id)
          )
        }
        webContents.getAllWebContents().forEach(observeExtensionContents)

        let cancelReadiness!: () => void
        const cancelled = new Promise<null>((resolve) => {
          cancelReadiness = () => resolve(null)
          abortController.signal.addEventListener('abort', cancelReadiness, { once: true })
        })
        let results: PromiseSettledResult<void>[] | null
        try {
          results = await Promise.race([
            Promise.allSettled(
              profiles.map((profile) => whenBrowserExtensionProfileRestored(profile))
            ),
            cancelled
          ])
        } finally {
          abortController.signal.removeEventListener('abort', cancelReadiness)
        }
        if (results === null || abortController.signal.aborted) {
          return
        }

        const failures = [
          ...new Set(
            results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
          )
        ]
        if (failures.length === 1) {
          throw failures[0]
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Could not restore extensions for every profile')
        }

        const currentProfiles = browserSessionRegistry.listProfiles()
        if (
          profiles.some(
            (profile) =>
              !currentProfiles.some(
                (currentProfile) =>
                  currentProfile.id === profile.id && currentProfile.partition === profile.partition
              )
          )
        ) {
          throw new Error('A browser profile changed while extension support was enabling')
        }
        if (
          currentProfiles.some(
            (currentProfile) =>
              !profiles.some(
                (profile) =>
                  profile.id === currentProfile.id && profile.partition === currentProfile.partition
              )
          )
        ) {
          continue
        }

        const latest = getBrowserExtensionSupportStatus()
        if (latest.runtime === 'enabling' && latest.desiredEnabled) {
          setBrowserExtensionSupportRuntime('enabled')
        }
        break
      }
    } catch {
      if (getBrowserExtensionSupportStatus().runtime !== 'enabling') {
        return
      }
      setBrowserExtensionSupportRuntime('disabling')
      await drainBrowserExtensionMutations()
      try {
        await detachBrowserExtensionsFromAllProfileSessions()
        setBrowserExtensionSupportRuntime(
          getBrowserExtensionSupportStatus().desiredEnabled ? 'enable-failed' : 'disabled'
        )
      } catch {
        setBrowserExtensionSupportRuntime('unload-failed')
      }
    } finally {
      if (enablingAbortController === abortController) {
        enablingAbortController = null
      }
    }
  } else if (getBrowserExtensionSupportStatus().runtime === 'disabling') {
    setBrowserExtensionSupportRuntime('disabled')
  }

  notifyBrowserExtensionSupportViews()
}

function notifyBrowserExtensionSupportViews(): void {
  notifyBrowserExtensionListChanged()
  for (const profile of browserSessionRegistry.listProfiles()) {
    notifyBrowserExtensionActionsChanged(profile.id)
  }
}

/** Process-wide hosts and listeners; each one checks per session, so they stay once installed. */
function installBrowserExtensionSupport(): void {
  if (initialized) {
    return
  }
  initialized = true
  setSavedBrowserTabsSource(savedBrowserTabs)
  registerBrowserExtensionNamespaces()
  installBrowserExtensionApiHost()
  installBrowserExtensionSessionServices()
  installBrowserExtensionToolbarNotifications()
  installChromeWebStoreBridgeHost()
  setBrowserExtensionListChangedListener(() => {
    const window = getBrowserExtensionMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(BROWSER_EXTENSIONS_CHANGED_CHANNEL)
    }
  })
  startBrowserExtensionUpdateChecks()
  // Why synchronous: loadURL right after construction emits did-start-loading before a microtask runs.
  app.on('web-contents-created', (_event, contents) => observeExtensionContents(contents))
}

const observedContents = new WeakSet<Electron.WebContents>()

/** Tabs (webview guests) and extension popouts in a session that runs extensions. */
function observeExtensionContents(contents: Electron.WebContents): void {
  const type = contents.getType()
  if (
    (type !== 'webview' && type !== 'window') ||
    isBrowserExtensionNativePage(contents) ||
    observedContents.has(contents) ||
    !getBrowserExtensionProfileIdForSession(contents.session)
  ) {
    return
  }
  observedContents.add(contents)
  observeBrowserExtensionWebNavigation(contents)
  observeBrowserExtensionTabLifecycle(contents)
  observeBrowserExtensionDnrContents(contents)
  observeBrowserExtensionCommands(contents)
}
