import { session } from 'electron'
import { forgetBrowserExtensionActionProfile } from '../actions/browser-extension-action-registry'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'
import type { InstalledBrowserExtension } from '../../../../shared/browser/extensions/browser-extension-types'
import {
  isBrowserExtensionMutationPaused,
  isBrowserExtensionSupportEnabled,
  pauseBrowserExtensionMutations
} from '../browser-extension-support'
import { getBrowserExtensionInstallStore } from '../installation/browser-extension-install-store'
import { getBrowserExtensionProfileStateStore } from '../profile-storage/browser-extension-profile-state-store'
import { getBrowserExtensionSyncStorageStore } from '../profile-storage/browser-extension-sync-storage-store'
import { getBrowserExtensionDnrStore } from '../declarative-net-request/session/browser-extension-dnr-store'
import { retireBrowserExtensionProfileStorage } from '../profile-storage/browser-extension-retired-profile-storage'
import {
  attachBrowserExtensionApiHostToSession,
  forgetBrowserExtensionContexts
} from '../api-runtime/browser-extension-api-host'
import type { BrowserExtensionLoadKind } from './browser-extension-runtime-lifecycle'
import type { BrowserExtensionSessionHooks } from './browser-extension-session-hooks'
import { removeUninstalledBrowserExtensionData } from '../profile-storage/browser-extension-data-removal'
import {
  BROWSER_EXTENSION_PROFILE_UNAVAILABLE,
  type BrowserExtensionLoadCancellation,
  BrowserExtensionProfileLoads,
  throwIfBrowserExtensionLoadCancelled
} from './browser-extension-profile-loads'
import { throwIfBrowserExtensionRuntimeQuarantined } from '../api-runtime/browser-extension-runtime-quarantine'
import {
  BrowserExtensionSessionRetirement,
  trackBrowserExtensionStartupReadiness,
  type ProfileSessionState
} from './browser-extension-session-retirement'
import { finishBrowserExtensionLoad } from './browser-extension-session-completion'
import {
  unloadBrowserExtensionFromState,
  unloadBrowserExtensionFromStates
} from './browser-extension-session-unload'
import {
  loadBrowserExtensionIntoSession,
  loadInstalledBrowserExtensionIntoSession
} from './browser-extension-session-load'

export type { BrowserExtensionSessionHooks } from './browser-extension-session-hooks'

let sessionHooks: BrowserExtensionSessionHooks | null = null

export function setBrowserExtensionSessionHooks(hooks: BrowserExtensionSessionHooks): void {
  sessionHooks = hooks
}

const stateByProfileId = new Map<string, ProfileSessionState>()
const retirement = new BrowserExtensionSessionRetirement(stateByProfileId, {
  forgetContexts: forgetBrowserExtensionContexts,
  unregisterPreload: unregisterExtensionPreload,
  detached: (sess) => sessionHooks?.detached(sess)
})
const PRELOAD_FILE_NAME = 'browser-extension-preload.js'
const PRELOAD_ID = 'orca-browser-extension-frame'
const preloadedSessions = new WeakSet<Electron.Session>()

function registerExtensionPreload(sess: Electron.Session): void {
  if (preloadedSessions.has(sess)) {
    return
  }
  // Why the parent too: this module can land in out/main/chunks, one level below the preload entry.
  const filePath = [
    join(__dirname, PRELOAD_FILE_NAME),
    join(__dirname, '..', PRELOAD_FILE_NAME)
  ].find((candidate) => existsSync(candidate))
  if (!filePath) {
    console.warn(
      '[browser-extensions] Extension preload is missing; extension APIs are unavailable'
    )
    return
  }
  // Why frame only: a service-worker preload crashes the renderer during GC (electron#52310).
  // Workers load Orca's API shim through the background wrapper instead.
  sess.registerPreloadScript({ id: PRELOAD_ID, type: 'frame', filePath })
  preloadedSessions.add(sess)
}

function unregisterExtensionPreload(sess: Electron.Session): void {
  if (preloadedSessions.has(sess)) {
    sess.unregisterPreloadScript(PRELOAD_ID)
    preloadedSessions.delete(sess)
  }
}

/** Session setup hook for a local browser profile: wire the host, register the preload, load what's enabled. */
export function attachBrowserExtensionsToProfileSession(
  profile: BrowserSessionProfile,
  enabledExtensionIds: string[]
): void {
  if (
    !isBrowserExtensionSupportEnabled() ||
    isBrowserExtensionMutationPaused() ||
    stateByProfileId.has(profile.id) ||
    retirement.blocksAttachment(profile)
  ) {
    return
  }
  const sess = session.fromPartition(profile.partition)
  registerExtensionPreload(sess)
  attachBrowserExtensionApiHostToSession(sess, profile.id)
  sessionHooks?.attached(sess, profile.id, enabledExtensionIds)
  const store = getBrowserExtensionInstallStore()
  const loads = new BrowserExtensionProfileLoads()
  const swept = removeUninstalledBrowserExtensionData(
    sess,
    profile.id,
    new Set(store.list().map((extension) => extension.id)),
    (stale) => sessionHooks?.uninstalled(profile.id, stale)
  )
  const startupLoads = enabledExtensionIds.map((extensionId) =>
    loads
      .track(extensionId, async (load) => {
        const stale = await swept
        const installed = store.get(extensionId)
        throwIfBrowserExtensionLoadCancelled(load)
        if (!installed || stale.has(extensionId)) {
          return
        }
        const loaded = await loadInstalledBrowserExtensionIntoSession(
          sess,
          profile.id,
          installed,
          'startup',
          load
        )
        await finishBrowserExtensionLoad(sess, profile.id, loaded, load, sessionHooks)
      })
      .catch((error: unknown) => {
        console.warn(`[browser-extensions] Failed to load ${extensionId}:`, error)
        throw error
      })
  )
  const { loading, startupReadiness } = trackBrowserExtensionStartupReadiness(
    profile.id,
    swept,
    startupLoads
  )
  stateByProfileId.set(profile.id, {
    profile,
    session: sess,
    loading,
    startupReadiness,
    retirement: new AbortController(),
    loads
  })
}

/** Profile delete retires saved extension data only after native extensions are confirmed absent. */
export async function detachBrowserExtensionsFromProfileSession(
  profile: BrowserSessionProfile
): Promise<void> {
  const resumeMutations = await pauseBrowserExtensionMutations()
  try {
    await detachAndClearBrowserExtensionProfileSession(profile)
  } finally {
    resumeMutations()
  }
}

async function detachAndClearBrowserExtensionProfileSession(
  profile: BrowserSessionProfile
): Promise<void> {
  const state = stateByProfileId.get(profile.id) ?? retirement.get(profile.id)
  if (state && state.profile.partition !== profile.partition) {
    throw new Error('Cannot retire a different browser profile incarnation')
  }
  const sess = state?.session ?? session.fromPartition(profile.partition)
  try {
    await retirement.retire(
      state ?? {
        profile,
        session: sess,
        loading: Promise.resolve(),
        startupReadiness: Promise.resolve(),
        retirement: new AbortController(),
        loads: new BrowserExtensionProfileLoads()
      }
    )
  } finally {
    forgetBrowserExtensionActionProfile(profile.id)
  }
  await retireBrowserExtensionProfileStorage(sess, profile.partition)
  getBrowserExtensionProfileStateStore().forgetProfile(profile.id)
  getBrowserExtensionSyncStorageStore().forgetProfile(profile.id)
  getBrowserExtensionDnrStore().forgetProfile(profile.id)
}

/** The global disable is not complete until all active and previously failed retirements settle. */
export function detachBrowserExtensionsFromAllProfileSessions(): Promise<void> {
  return retirement.retireAll()
}

/** Startup callers can continue after a profile load failure or retirement. */
export function whenBrowserExtensionProfileLoaded(profileId: string): Promise<void> {
  return stateByProfileId.get(profileId)?.loading.catch(() => {}) ?? Promise.resolve()
}

/** One exact attached profile's startup loads and restore hooks, including their failures. */
export function whenBrowserExtensionProfileRestored(profile: BrowserSessionProfile): Promise<void> {
  return retirement.whenRestored(profile)
}

/** Startup waits briefly so restored tabs get content scripts; a slow load never blocks launch. */
export async function whenBrowserExtensionSessionsLoaded(timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    Promise.all([...stateByProfileId.values()].map((state) => state.loading.catch(() => {}))),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
  ])
  clearTimeout(timer)
}

export function getBrowserExtensionSessionForProfile(profileId: string): Electron.Session | null {
  return stateByProfileId.get(profileId)?.session ?? null
}

/** Every local profile session extensions run in this launch. */
export function listBrowserExtensionSessions(): Electron.Session[] {
  return [...new Set(retirement.states().map((state) => state.session))]
}

export function getBrowserExtensionProfile(profileId: string): BrowserSessionProfile | null {
  return stateByProfileId.get(profileId)?.profile ?? null
}

export function getBrowserExtensionProfileForPartition(
  partition: string
): BrowserSessionProfile | null {
  for (const state of stateByProfileId.values()) {
    if (state.profile.partition === partition) {
      return state.profile
    }
  }
  return null
}

export async function loadBrowserExtensionIntoProfile(
  profileId: string,
  extension: InstalledBrowserExtension,
  kind: BrowserExtensionLoadKind = 'other'
): Promise<Electron.Extension> {
  const state = stateByProfileId.get(profileId)
  if (!state) {
    throw new Error(BROWSER_EXTENSION_PROFILE_UNAVAILABLE)
  }
  return state.loads.track(extension.id, async (load) => {
    await state.loading
    throwIfBrowserExtensionRuntimeQuarantined(state.session, extension.id)
    const loaded = await loadInstalledBrowserExtensionIntoSession(
      state.session,
      profileId,
      extension,
      kind,
      load
    )
    return finishBrowserExtensionLoad(state.session, profileId, loaded, load, sessionHooks)
  })
}

/**
 * Developer "Load unpacked": loads Orca's copy of the folder, whose key gives it `extensionId`.
 * `refresh` copies the folder again, so pass it only when no profile can be running the copy.
 */
export async function loadBrowserExtensionFolderIntoProfile(
  profileId: string,
  extensionId: string,
  directory: string,
  options: { refresh: boolean }
): Promise<Electron.Extension> {
  const state = stateByProfileId.get(profileId)
  if (!state) {
    throw new Error(BROWSER_EXTENSION_PROFILE_UNAVAILABLE)
  }
  return state.loads.track(extensionId, async (load) => {
    await state.loading
    throwIfBrowserExtensionRuntimeQuarantined(state.session, extensionId)
    const loaded = await loadBrowserExtensionIntoSession(
      state.session,
      profileId,
      { id: extensionId, source: 'unpacked', path: directory },
      'other',
      load,
      options
    )
    return finishBrowserExtensionLoad(state.session, profileId, loaded, load, sessionHooks)
  })
}

/** Unloads it and cancels its loads in flight, which stop at their next step. */
export function unloadBrowserExtensionFromProfile(
  profileId: string,
  extensionId: string,
  cancelledBy: BrowserExtensionLoadCancellation = 'user-disabled'
): Promise<void> {
  return unloadBrowserExtensionFromState(
    stateByProfileId.get(profileId),
    profileId,
    extensionId,
    cancelledBy
  )
}

/** Resolves once its cancelled loads have stopped, so removal can purge what they wrote. */
export async function unloadBrowserExtensionEverywhere(
  extensionId: string
): Promise<Electron.Session[]> {
  const states = retirement.states()
  const retiringStates = states.filter((state) => stateByProfileId.get(state.profile.id) !== state)
  const results = await Promise.allSettled([
    unloadBrowserExtensionFromStates(stateByProfileId, extensionId),
    ...retiringStates.map((state) => retirement.retire(state))
  ])
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (failures.length === 1) {
    throw failures[0]
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Could not unload the extension from every profile')
  }
  return [...new Set(states.map((state) => state.session))]
}
