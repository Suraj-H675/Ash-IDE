import type { Session } from 'electron'
import type { BrowserSessionProfile } from '../../../shared/browser-workspace-types'
import { browserManager } from '../browser-manager'
import { isRemoteCliDrivenGuest } from '../desktop-browser-bridge/remote-cli-driven-workspaces'
import {
  hasSystemMediaAccess,
  requestSystemMediaAccess
} from '../site-settings/browser-media-access'
import { isAutoGrantedBrowserSessionPermission } from '../site-settings/browser-session-permission-policy'
import {
  answerBrowserLocalNetworkCheck,
  browserSitePermissionRequestingOrigin,
  browserSitePermissionsFor,
  decideBrowserSitePermissions,
  isBrowserSitePermissionAllowed,
  savedBrowserSitePermissions,
  sessionBrowserSitePermissions
} from '../site-settings/browser-site-permission-prompt'
import {
  allowsBrowserWebAuthnPermission,
  clearBrowserWebAuthnAccessHandlers,
  installBrowserWebAuthnAccessHandlers
} from '../webauthn/browser-webauthn-access'

const retiredSessions = new WeakSet<Session>()

export function isBrowserSessionRetired(sess: Session): boolean {
  return retiredSessions.has(sess)
}

// SSH-driven pages must not read the desktop clipboard.
function deniesRemoteCliDrivenClipboardRead(permission: string, webContentsId?: number): boolean {
  return permission === 'clipboard-read' && isRemoteCliDrivenGuest(webContentsId)
}

function resolvePermissionNoticeUrl(
  webContents: Electron.WebContents,
  details: Electron.PermissionRequest | undefined
): string {
  const requestingUrl = details?.requestingUrl
  if (!requestingUrl) {
    return webContents.getURL()
  }
  try {
    return new URL(requestingUrl).origin === 'null' ? '' : requestingUrl
  } catch {
    return ''
  }
}

export function retireBrowserSessionPermissions(sess: Session): void {
  retiredSessions.add(sess)
  const failures: unknown[] = []
  for (const revoke of [
    () => sess.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)),
    () => sess.setPermissionCheckHandler(() => false),
    () => sess.setDisplayMediaRequestHandler((_request, callback) => callback({})),
    () => clearBrowserWebAuthnAccessHandlers(sess),
    () => sess.setDevicePermissionHandler(() => false)
  ]) {
    try {
      revoke()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Could not fully revoke deleted browser session permissions')
  }
}

export function installBrowserSessionPermissions(
  sess: Session,
  profile: BrowserSessionProfile,
  options: {
    permissions?: 'browser' | 'deny'
    fileSystemAccess?: boolean
    sitePermissions?: 'saved' | 'session'
  }
): void {
  if (retiredSessions.has(sess)) {
    throw new Error('Browser session has been retired')
  }
  if (options?.permissions === 'deny') {
    sess.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    sess.setPermissionCheckHandler(() => false)
    clearBrowserWebAuthnAccessHandlers(sess)
  } else {
    // Electron answers every File System Access grant here, overriding Chromium's own;
    // the user's pick or drop is the consent, and handles a site stores keep their access.
    const grantsFileSystem = options.fileSystemAccess !== false
    const isAutoGranted = (permission: string): boolean =>
      isAutoGrantedBrowserSessionPermission(permission) ||
      (grantsFileSystem && permission === 'fileSystem')
    const memory =
      options.sitePermissions === 'session'
        ? sessionBrowserSitePermissions(profile.partition)
        : savedBrowserSitePermissions(profile.id)
    const siteMemory: typeof memory = {
      get: (...args) => (retiredSessions.has(sess) ? 'block' : memory.get(...args)),
      set: (...args) => {
        if (!retiredSessions.has(sess)) {
          memory.set(...args)
        }
      }
    }
    sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (retiredSessions.has(sess)) {
        callback(false)
        return
      }
      if (
        permission === 'openExternal' &&
        browserManager.requestExternalAppLaunch(
          webContents,
          'externalURL' in details ? details.externalURL : undefined,
          () => resolvePermissionNoticeUrl(webContents, details) || null
        )
      ) {
        // Orca launches approved apps itself; deny Chromium's duplicate launch.
        callback(false)
        return
      }
      // Capture the requesting URL before async handling; opaque frames have no named site.
      const rawUrl = resolvePermissionNoticeUrl(webContents, details)
      const notifyDenied = (): void =>
        browserManager.notifyPermissionDenied({
          guestWebContentsId: webContents.id,
          permission,
          rawUrl
        })
      if (deniesRemoteCliDrivenClipboardRead(permission, webContents.id)) {
        notifyDenied()
        callback(false)
        return
      }
      const mediaRequest = 'mediaTypes' in details ? details : undefined
      const sitePermissions = browserSitePermissionsFor(permission, mediaRequest?.mediaTypes)
      if (!sitePermissions) {
        const allowed = isAutoGranted(permission)
        if (!allowed) {
          notifyDenied()
        }
        callback(allowed)
        return
      }
      const decide = async (): Promise<boolean> => {
        const allowed = await decideBrowserSitePermissions({
          requester: webContents,
          frameOrigin: sitePermissions.includes('notifications')
            ? browserSitePermissionRequestingOrigin(webContents, details)
            : null,
          memory: siteMemory,
          permissions: sitePermissions
        })
        if (!allowed || retiredSessions.has(sess)) {
          return false
        }
        if (permission !== 'media') {
          return true
        }
        // macOS also gates camera and mic per app; distinguish OS refusal from a site decision.
        const granted = await requestSystemMediaAccess(mediaRequest)
        if (!granted) {
          notifyDenied()
        }
        return granted
      }
      void decide().then(
        (allowed) => callback(!retiredSessions.has(sess) && allowed),
        (error: unknown) => {
          console.error('[permissions] Browser site permission failed:', error)
          callback(false)
        }
      )
    })
    sess.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (retiredSessions.has(sess)) {
        return false
      }
      if (deniesRemoteCliDrivenClipboardRead(permission, webContents?.id)) {
        return false
      }
      if (allowsBrowserWebAuthnPermission(permission, details)) {
        return true
      }
      const sitePermissions = browserSitePermissionsFor(
        permission,
        details?.mediaType ? [details.mediaType] : undefined
      )
      if (sitePermissions) {
        const source = {
          // Service-worker checks have no WebContents; use their requesting origin.
          pageUrl: webContents?.getURL() ?? requestingOrigin,
          // Checks supply the frame's inherited origin.
          frameOrigin: requestingOrigin
        }
        if (sitePermissions.includes('local-network')) {
          return answerBrowserLocalNetworkCheck({
            requester: webContents,
            source,
            memory: siteMemory
          })
        }
        return (
          isBrowserSitePermissionAllowed({
            source,
            memory: siteMemory,
            permissions: sitePermissions
          }) &&
          (permission !== 'media' || hasSystemMediaAccess(details?.mediaType))
        )
      }
      return isAutoGranted(permission)
    })
    installBrowserWebAuthnAccessHandlers(sess)
  }
  sess.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: undefined, audio: undefined })
  })
}
