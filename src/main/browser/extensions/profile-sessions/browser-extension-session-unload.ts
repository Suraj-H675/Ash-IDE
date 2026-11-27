import {
  clearBrowserExtensionLoadFailure,
  forgetBrowserExtensionLoadFailures,
  recordBrowserExtensionLoadFailure
} from './browser-extension-load-errors'
import type {
  BrowserExtensionLoadCancellation,
  BrowserExtensionProfileLoads
} from './browser-extension-profile-loads'
import { removeBrowserExtensionFromSession } from './browser-extension-worker-registration'
import {
  clearBrowserExtensionRuntimeQuarantine,
  getBrowserExtensionRuntimeQuarantine
} from '../api-runtime/browser-extension-runtime-quarantine'

export type BrowserExtensionUnloadState = {
  session: Electron.Session
  loads: BrowserExtensionProfileLoads
}

export type BrowserExtensionProfileUnloadState = BrowserExtensionUnloadState & {
  profile: { id: string }
  loading: Promise<void>
}

export async function unloadBrowserExtensionSession(
  state: BrowserExtensionProfileUnloadState,
  cleanup: {
    forgetContexts: (sess: Electron.Session) => void
    unregisterPreload: (sess: Electron.Session) => void
    detached: (sess: Electron.Session) => void
  }
): Promise<void> {
  forgetBrowserExtensionLoadFailures({ profileId: state.profile.id })
  await Promise.all([state.loading.catch(() => {}), state.loads.close('detached')])
  const unloadErrors: unknown[] = []
  let extensions: Electron.Extension[] = []
  try {
    extensions = state.session.extensions.getAllExtensions()
  } catch (error) {
    // Unknown native inventory is not native absence, but cannot skip Ash cleanup.
    unloadErrors.push(error)
  }
  for (const extension of extensions) {
    try {
      removeBrowserExtensionFromSession(state.session, extension.id)
    } catch (error) {
      unloadErrors.push(error)
      try {
        recordBrowserExtensionLoadFailure(state.profile.id, extension.id, error)
      } catch (reportError) {
        unloadErrors.push(reportError)
      }
    }
  }
  for (const finalize of [
    () => cleanup.forgetContexts(state.session),
    () => cleanup.unregisterPreload(state.session),
    () => cleanup.detached(state.session)
  ]) {
    try {
      finalize()
    } catch (error) {
      unloadErrors.push(error)
    }
  }
  if (unloadErrors.length === 1) {
    throw unloadErrors[0]
  }
  if (unloadErrors.length > 1) {
    throw new AggregateError(
      unloadErrors,
      `Could not fully unload extensions from profile ${state.profile.id}: ${unloadErrors.map((error) => (error instanceof Error ? error.message : String(error))).join('; ')}`
    )
  }
}

export function unloadBrowserExtensionFromState(
  state: BrowserExtensionUnloadState | undefined,
  profileId: string,
  extensionId: string,
  cancelledBy: BrowserExtensionLoadCancellation
): Promise<void> {
  return unloadAndCancel(state, profileId, extensionId, cancelledBy)
}

async function unloadAndCancel(
  state: BrowserExtensionUnloadState | undefined,
  profileId: string,
  extensionId: string,
  cancelledBy: BrowserExtensionLoadCancellation
): Promise<void> {
  if (!state) {
    clearBrowserExtensionLoadFailure(profileId, extensionId)
    return
  }
  const stopped = state.loads.cancel(extensionId, cancelledBy)
  let removalError: unknown = null
  try {
    if (state.session.extensions.getExtension(extensionId)) {
      removeBrowserExtensionFromSession(state.session, extensionId)
    }
  } catch (error) {
    removalError = error
  }
  await stopped

  let remaining: Electron.Extension | null | undefined
  let verificationError: unknown = null
  try {
    remaining = state.session.extensions.getExtension(extensionId)
  } catch (error) {
    verificationError = error
  }
  if (remaining || verificationError) {
    const reason =
      getBrowserExtensionRuntimeQuarantine(state.session, extensionId) ??
      (verificationError instanceof Error
        ? verificationError.message
        : removalError instanceof Error
          ? removalError.message
          : `Could not confirm extension ${extensionId} was unloaded`)
    const failure = verificationError ?? removalError ?? new Error(reason)
    recordBrowserExtensionLoadFailure(profileId, extensionId, failure)
    throw failure
  }
  clearBrowserExtensionRuntimeQuarantine(state.session, extensionId)
  clearBrowserExtensionLoadFailure(profileId, extensionId)
}

export async function unloadBrowserExtensionFromStates(
  states: Iterable<[string, BrowserExtensionUnloadState]>,
  extensionId: string
): Promise<void> {
  const results = await Promise.allSettled(
    [...states].map(([profileId, state]) =>
      unloadAndCancel(state, profileId, extensionId, 'uninstalled')
    )
  )
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (failures.length === 1) {
    throw failures[0]
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Could not unload the extension from every profile')
  }
}
