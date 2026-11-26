import type { BrowserExtensionSessionHooks } from './browser-extension-session-hooks'
import {
  throwIfBrowserExtensionLoadCancelled,
  type BrowserExtensionProfileLoad
} from './browser-extension-profile-loads'
import { removeBrowserExtensionFromSession } from './browser-extension-worker-registration'
import { clearBrowserExtensionRuntimeQuarantine } from '../api-runtime/browser-extension-runtime-quarantine'
import { recordBrowserExtensionLoadFailure } from './browser-extension-load-errors'

/** Completes restore hooks, rolling native state back before clearing persisted enablement. */
export async function finishBrowserExtensionLoad(
  sess: Electron.Session,
  profileId: string,
  extension: Electron.Extension,
  load: BrowserExtensionProfileLoad,
  hooks: BrowserExtensionSessionHooks | null
): Promise<Electron.Extension> {
  try {
    throwIfBrowserExtensionLoadCancelled(load)
    await hooks?.loaded(sess, profileId, extension)
    throwIfBrowserExtensionLoadCancelled(load)
    return extension
  } catch (error) {
    const rollbackErrors: unknown[] = []
    let nativeAbsent = false
    try {
      if (sess.extensions.getExtension(extension.id)) {
        removeBrowserExtensionFromSession(sess, extension.id)
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    try {
      nativeAbsent = !sess.extensions.getExtension(extension.id)
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    if (nativeAbsent) {
      clearBrowserExtensionRuntimeQuarantine(sess, extension.id)
    }
    if (load.cancelledBy === null && nativeAbsent) {
      try {
        hooks?.postLoadFailed(sess, profileId, extension.id)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    const failure =
      rollbackErrors.length > 0
        ? new AggregateError(
            [error, ...rollbackErrors],
            `Restore failed for ${extension.id}; native rollback failed: ${rollbackErrors.map((item) => (item instanceof Error ? item.message : String(item))).join('; ')}`
          )
        : error
    if (load.cancelledBy === null) {
      recordBrowserExtensionLoadFailure(profileId, extension.id, failure)
    }
    throw failure
  }
}
