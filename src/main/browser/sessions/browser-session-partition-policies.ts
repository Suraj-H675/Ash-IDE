import { session } from 'electron'
import type { Session } from 'electron'
import type { BrowserSessionProfile } from '../../../shared/browser-workspace-types'
import { browserManager } from '../browser-manager'
import { clearProxySessionCredentials } from '../../network/proxy-settings'
import {
  applyProxyToBrowserSession,
  invalidateBrowserSessionProxyApplication
} from './browser-session-proxy'
import { installBrowserSessionUserAgentPolicy } from '../identity/browser-session-ua'
import { getBrowserProcessUserAgentIdentity } from '../identity/browser-process-user-agent'
import { noticeDocPreviewDownloadBlocked } from '../document-preview/doc-preview-download-block-notice'
import { isRemoteCliDrivenGuest } from '../desktop-browser-bridge/remote-cli-driven-workspaces'
import { clearBrowserWebAuthnAccessHandlers } from '../webauthn/browser-webauthn-access'
import {
  installBrowserSessionPermissions,
  isBrowserSessionRetired,
  retireBrowserSessionPermissions
} from './browser-session-permissions'

const configuredPartitions = new Set<string>()
const userAgentPolicyDisposerBySession = new WeakMap<Session, () => void>()

export function retireBrowserSessionUserAgentPolicy(sess: Session): void {
  const dispose = userAgentPolicyDisposerBySession.get(sess)
  if (!dispose) {
    return
  }
  userAgentPolicyDisposerBySession.delete(sess)
  dispose()
}

function configureBrowserSessionUserAgentPolicy(sess: Session, installExceptions: boolean): void {
  sess.setUserAgent(getBrowserProcessUserAgentIdentity().userAgent)
  if (!installExceptions) {
    retireBrowserSessionUserAgentPolicy(sess)
    return
  }
  if (userAgentPolicyDisposerBySession.has(sess)) {
    return
  }
  userAgentPolicyDisposerBySession.set(
    sess,
    installBrowserSessionUserAgentPolicy(sess, (request) =>
      browserManager.resolveBrowserGuestRequestUserAgent(request)
    )
  )
}

/** Drop only the installer memo; retired-session guards remain fail-closed. */
export function forgetBrowserSessionPartitionConfiguration(partition: string): void {
  configuredPartitions.delete(partition)
}
const handleWillDownload = (
  event: Electron.Event,
  item: Electron.DownloadItem,
  webContents: Electron.WebContents
): void => {
  // Prevent SSH-driven pages from writing host-chosen files into desktop Downloads.
  if (isRemoteCliDrivenGuest(webContents.id)) {
    event.preventDefault()
    console.info('[desktop-browser-bridge] refused a download from a page an SSH host drives')
    return
  }
  browserManager.handleGuestWillDownload({ guestWebContentsId: webContents.id, item })
}

// will-download omits the partition; attach each partition's selected policy to its session.
const handleDeniedWillDownload = (
  event: Electron.Event,
  _item: Electron.DownloadItem,
  webContents: Electron.WebContents
): void => {
  event.preventDefault()
  noticeDocPreviewDownloadBlocked(webContents)
}

const denyRetiredDownload = (event: Electron.Event): void => event.preventDefault()

type RestrictedFileSystemAccessListener = (
  event: Electron.Event,
  details: Electron.FileSystemAccessRestrictedDetails,
  callback: (action: 'allow' | 'deny' | 'tryAgain') => void
) => void

// Chromium waits for an answer on blocklisted system folders; without one the page hangs.
const denyRestrictedFileSystemAccess: RestrictedFileSystemAccessListener = (
  _event,
  _details,
  callback
) => callback('deny')

const handleRestrictedFileSystemAccess: RestrictedFileSystemAccessListener = (
  _event,
  details,
  callback
) => {
  callback('deny')
  if (details.webContents) {
    browserManager.notifyPermissionDenied({
      guestWebContentsId: details.webContents.id,
      permission: 'fileSystem',
      rawUrl: details.origin
    })
  }
}

export type BrowserPartitionDownloadPolicy = 'route' | 'deny'
export type BrowserPartitionPermissionPolicy = 'browser' | 'deny'

// Keep async so initialization errors reach callers through the returned promise.
export async function installBrowserSessionPartitionPolicies(
  profile: BrowserSessionProfile,
  options: {
    downloads?: BrowserPartitionDownloadPolicy
    permissions?: BrowserPartitionPermissionPolicy
    applyAppWideProxy?: boolean
    /** Off where another machine can script pages and reuse their stored file handles. */
    fileSystemAccess?: boolean
    userAgentExceptions?: boolean
    /** Session-only answers are not persisted to a browser profile. */
    sitePermissions?: 'saved' | 'session'
  } = {}
): Promise<void> {
  const { partition } = profile
  const sess = session.fromPartition(partition)
  if (isBrowserSessionRetired(sess)) {
    throw new Error('Browser session has been retired')
  }
  configureBrowserSessionUserAgentPolicy(sess, options.userAgentExceptions !== false)
  // Route partitions own a SOCKS policy that the app proxy must not overwrite.
  const proxyReady = (
    options.applyAppWideProxy === false ? Promise.resolve() : applyProxyToBrowserSession(sess)
  ).catch((error: unknown) => {
    clearProxySessionCredentials(sess)
    throw error
  })
  if (configuredPartitions.has(partition)) {
    return proxyReady
  }

  browserManager.installCertificateRequestGuard(sess)
  installBrowserSessionPermissions(sess, profile, options)
  sess.removeListener('will-download', handleWillDownload)
  sess.removeListener('will-download', handleDeniedWillDownload)
  sess.on(
    'will-download',
    options?.downloads === 'deny' ? handleDeniedWillDownload : handleWillDownload
  )
  sess.removeListener('file-system-access-restricted', denyRestrictedFileSystemAccess)
  sess.removeListener('file-system-access-restricted', handleRestrictedFileSystemAccess)
  sess.on(
    'file-system-access-restricted',
    options?.permissions === 'deny'
      ? denyRestrictedFileSystemAccess
      : handleRestrictedFileSystemAccess
  )
  configuredPartitions.add(partition)
  return proxyReady
}

/** A deleted profile's Electron Session may outlive its registry entry. Never reconfigure it. */
export function retireDeletedBrowserSessionPartitionPolicies(
  partition: string,
  sess: Session
): void {
  const failures: unknown[] = []
  for (const revoke of [
    () => retireBrowserSessionPermissions(sess),
    () => forgetBrowserSessionPartitionConfiguration(partition),
    () => sess.removeListener('will-download', handleWillDownload),
    () => sess.removeListener('will-download', handleDeniedWillDownload),
    () => sess.removeListener('will-download', denyRetiredDownload),
    () => sess.on('will-download', denyRetiredDownload),
    () => sess.removeListener('file-system-access-restricted', handleRestrictedFileSystemAccess),
    () => sess.removeListener('file-system-access-restricted', denyRestrictedFileSystemAccess),
    () => sess.on('file-system-access-restricted', denyRestrictedFileSystemAccess),
    () => retireBrowserSessionUserAgentPolicy(sess),
    () => invalidateBrowserSessionProxyApplication(sess)
  ]) {
    try {
      revoke()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Could not fully revoke deleted browser session policies')
  }
}

export function clearBrowserSessionPartitionPolicies(partition: string, sess: Session): void {
  if (isBrowserSessionRetired(sess)) {
    return
  }
  // Electron Sessions outlive removed partitions; release their callbacks and listeners.
  invalidateBrowserSessionProxyApplication(sess)
  retireBrowserSessionUserAgentPolicy(sess)
  configuredPartitions.delete(partition)
  browserManager.removeCertificateRequestGuard(sess)
  sess.removeListener('will-download', handleWillDownload)
  sess.removeListener('will-download', handleDeniedWillDownload)
  sess.removeListener('file-system-access-restricted', denyRestrictedFileSystemAccess)
  sess.removeListener('file-system-access-restricted', handleRestrictedFileSystemAccess)
  clearBrowserWebAuthnAccessHandlers(sess)
  sess.setPermissionRequestHandler(null)
  sess.setPermissionCheckHandler(null)
  sess.setDisplayMediaRequestHandler(null)
}
