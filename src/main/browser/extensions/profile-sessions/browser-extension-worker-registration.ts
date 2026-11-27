import { getChromeExtensionOrigin } from '../../../../shared/browser/extensions/browser-extension-url'
import { quarantineBrowserExtensionContexts } from '../api-runtime/browser-extension-api-host'
import { forgetBrowserExtensionContentScriptRestore } from '../api-runtime/browser-extension-content-scripts'
import {
  quarantineBrowserExtensionRuntime,
  clearBrowserExtensionRuntimeQuarantine
} from '../api-runtime/browser-extension-runtime-quarantine'
import { revokeBrowserExtensionActiveTabInSession } from '../permissions/browser-extension-active-tab'
import { closeNativePortsWhere } from '../native-messaging/browser-extension-native-ports'
import { getDnrSessionRuntime } from '../declarative-net-request/session/browser-extension-dnr-session'
import { getBrowserExtensionProfileStateStore } from '../profile-storage/browser-extension-profile-state-store'
import type { PreparedBrowserExtensionDirectory } from '../installation/browser-extension-load-directory'

// Why: removing an extension makes Chromium unregister its worker, so its next load registers anew.
const unregisteredWorkersBySession = new WeakMap<Electron.Session, Set<string>>()

export function removeBrowserExtensionFromSession(
  sess: Electron.Session,
  extensionId: string
): void {
  let removalError: unknown = null
  try {
    sess.extensions.removeExtension(extensionId)
  } catch (error) {
    removalError = error
  }

  let remainsPresent: boolean
  let verificationError: unknown = null
  try {
    remainsPresent = Boolean(sess.extensions.getExtension(extensionId))
  } catch (error) {
    remainsPresent = true
    verificationError = error
  }

  if (remainsPresent) {
    const reason = `Could not confirm that extension ${extensionId} was unloaded; it may remain active in Chromium. Avoid browsing this profile and retry disabling it. If recovery fails, explicitly stop the Ash runtime before restarting; closing the window is not sufficient.`
    quarantineBrowserExtensionRuntime(sess, extensionId, reason)
    const cleanupErrors: unknown[] = []
    for (const cleanup of [
      () => quarantineBrowserExtensionContexts(sess, extensionId),
      () => forgetBrowserExtensionContentScriptRestore(sess, extensionId),
      () => revokeBrowserExtensionActiveTabInSession(sess, extensionId),
      () =>
        closeNativePortsWhere((port) => port.session === sess && port.extensionId === extensionId),
      () => getDnrSessionRuntime(sess)?.removeExtension(extensionId)
    ]) {
      try {
        cleanup()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    const cause = verificationError ?? removalError
    const failures = [cause, ...cleanupErrors].filter((error) => error !== null)
    const message =
      cleanupErrors.length > 0
        ? `${reason} Ash runtime cleanup was incomplete: ${cleanupErrors.map((error) => (error instanceof Error ? error.message : String(error))).join('; ')}`
        : reason
    throw new Error(message, {
      cause:
        failures.length === 1
          ? failures[0]
          : new AggregateError(failures, 'Extension unload cleanup did not complete')
    })
  }

  clearBrowserExtensionRuntimeQuarantine(sess, extensionId)
  const ids = unregisteredWorkersBySession.get(sess) ?? new Set<string>()
  ids.add(extensionId)
  unregisteredWorkersBySession.set(sess, ids)
}

/**
 * Chromium keeps running a worker's cached scripts until the extension version changes, so a new
 * wrapper or shim would never run. Dropping the registration makes the load register it afresh.
 * Returns whether the load will register the worker.
 */
export async function refreshWorkerRegistration(
  sess: Electron.Session,
  profileId: string,
  prepared: PreparedBrowserExtensionDirectory
): Promise<boolean> {
  const { extensionId, workerSignature } = prepared
  const states = getBrowserExtensionProfileStateStore()
  const unregistered = unregisteredWorkersBySession.get(sess)?.delete(extensionId) ?? false
  if (workerSignature && states.read(profileId, extensionId).workerSignature === workerSignature) {
    return unregistered
  }
  await sess.clearStorageData({
    origin: getChromeExtensionOrigin(extensionId),
    storages: ['serviceworkers']
  })
  if (workerSignature) {
    states.update(profileId, extensionId, (state) => ({
      ...state,
      workerSignature
    }))
  }
  return true
}

const WORKER_REGISTRATION_WAIT_MS = 10_000

/**
 * loadExtension resolves before Chromium has registered the worker, and until it has, every start
 * fails ("Failed to start service worker."). The load waits so Orca's lifecycle events and
 * restored tabs start a worker that exists. Listen before loading: registration can finish first.
 */
export function whenWorkerRegistered(sess: Electron.Session, extensionId: string): Promise<void> {
  const scope = `${getChromeExtensionOrigin(extensionId)}/`
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      sess.serviceWorkers.removeListener('registration-completed', onRegistered)
      resolve()
    }
    const onRegistered = (_event: Electron.Event, details: { scope: string }): void => {
      if (details.scope === scope) {
        done()
      }
    }
    const timer = setTimeout(done, WORKER_REGISTRATION_WAIT_MS)
    sess.serviceWorkers.on('registration-completed', onRegistered)
  })
}
