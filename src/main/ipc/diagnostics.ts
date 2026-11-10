// Main owns local diagnostic collection and previews; vendor upload actions fail closed here.

import { app, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { arch as osArch, platform as osPlatform, release as osRelease, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectDiagnosticBundle,
  getDiagnosticsStatus,
  type DiagnosticsStatus
} from '../observability'
import { diagnosticsBundleFailure } from '../../shared/diagnostics-bundle-failure-copy'
import type { CollectedBundle } from '../observability/bundle'
import { resolveDiagnosticOrcaChannel } from '../observability/diagnostic-upload-endpoint'

export type DiagnosticsBundlePreview = Omit<CollectedBundle, 'payload'>

const PENDING_BUNDLE_TTL_MS = 15 * 60 * 1000
const MAX_PENDING_BUNDLES = 8

type PendingBundle = {
  bundle: CollectedBundle
  readonly createdAtMs: number
  readonly previewFilePath: string
  ttlTimer: ReturnType<typeof setTimeout>
  previewOpened: boolean
}

const pendingBundles = new Map<string, PendingBundle>()

function prunePendingBundles(now = Date.now()): void {
  for (const [id, pending] of pendingBundles) {
    if (now - pending.createdAtMs > PENDING_BUNDLE_TTL_MS) {
      deletePendingBundle(id)
    }
  }
  while (pendingBundles.size > MAX_PENDING_BUNDLES) {
    const oldest = pendingBundles.keys().next().value as string | undefined
    if (!oldest) {
      break
    }
    deletePendingBundle(oldest)
  }
}

function rememberBundle(bundle: CollectedBundle): void {
  deletePendingBundle(bundle.bundleSubmissionId)
  const previewFilePath = writeBundlePreviewFile(bundle)
  pendingBundles.set(bundle.bundleSubmissionId, {
    bundle,
    createdAtMs: Date.now(),
    previewFilePath,
    // Expire retained payloads even if no further renderer call arrives.
    ttlTimer: schedulePendingBundleExpiry(bundle.bundleSubmissionId),
    previewOpened: false
  })
  prunePendingBundles()
}

function schedulePendingBundleExpiry(bundleSubmissionId: string): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    deletePendingBundle(bundleSubmissionId)
  }, PENDING_BUNDLE_TTL_MS)
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
  return timer
}

function toBundlePreview(bundle: CollectedBundle): DiagnosticsBundlePreview {
  return {
    bundleSubmissionId: bundle.bundleSubmissionId,
    bytes: bundle.bytes,
    spanCount: bundle.spanCount
  }
}

function getPendingPreviewFilePath(bundleSubmissionId: unknown): string {
  if (
    typeof bundleSubmissionId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(bundleSubmissionId)
  ) {
    throw new Error('bundleSubmissionId has invalid format')
  }
  prunePendingBundles()
  const pending = pendingBundles.get(bundleSubmissionId)
  if (!pending) {
    throw diagnosticsBundleFailure('expiredBeforeOpening')
  }
  return pending.previewFilePath
}

function discardPendingBundle(bundleSubmissionId: unknown): void {
  if (
    typeof bundleSubmissionId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(bundleSubmissionId)
  ) {
    throw new Error('bundleSubmissionId has invalid format')
  }
  deletePendingBundle(bundleSubmissionId)
}

function deletePendingBundle(bundleSubmissionId: string): void {
  const pending = pendingBundles.get(bundleSubmissionId)
  if (pending) {
    clearTimeout(pending.ttlTimer)
    deletePreviewFile(pending.previewFilePath)
    pendingBundles.delete(bundleSubmissionId)
  }
}

function getPreviewDirectory(): string {
  let base: string
  try {
    base = app.getPath('temp')
  } catch {
    base = tmpdir()
  }
  return join(base, 'ash-diagnostic-bundle-previews')
}

function writeBundlePreviewFile(bundle: CollectedBundle): string {
  const previewDirectory = getPreviewDirectory()
  mkdirSync(previewDirectory, { mode: 0o700, recursive: true })
  const previewFilePath = join(previewDirectory, `${bundle.bundleSubmissionId}.ndjson`)
  writeFileSync(previewFilePath, bundle.payload, { encoding: 'utf8', mode: 0o600 })
  return previewFilePath
}

function deletePreviewFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch {
    /* best effort */
  }
}

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle('diagnostics:getStatus', (): DiagnosticsStatus => {
    return getDiagnosticsStatus()
  })

  ipcMain.handle(
    'diagnostics:collectBundle',
    async (_event, lookbackMinutesIn: unknown): Promise<DiagnosticsBundlePreview> => {
      // Enforce consent in main; hiding renderer controls is insufficient.
      const status = getDiagnosticsStatus()
      if (!status.bundleEnabled) {
        throw diagnosticsBundleFailure('creatingDisabled')
      }
      // Validate untyped IPC input before applying the default lookback.
      const lookbackMinutes =
        typeof lookbackMinutesIn === 'number' && Number.isFinite(lookbackMinutesIn)
          ? Math.max(1, Math.min(30 * 24 * 60, Math.floor(lookbackMinutesIn)))
          : undefined
      const bundle = await collectDiagnosticBundle({
        appVersion: app.getVersion(),
        platform: osPlatform(),
        arch: osArch(),
        osRelease: osRelease(),
        orcaChannel: resolveDiagnosticOrcaChannel(),
        ...(lookbackMinutes !== undefined ? { lookbackMinutes } : {})
      })
      rememberBundle(bundle)
      return toBundlePreview(bundle)
    }
  )

  ipcMain.handle('diagnostics:uploadBundle', async (): Promise<never> => {
    throw new Error('Ash IDE does not have a diagnostics upload backend.')
  })

  ipcMain.handle('diagnostics:openBundlePreview', async (_event, bundleSubmissionId: unknown) => {
    const previewFilePath = getPendingPreviewFilePath(bundleSubmissionId)
    const errorMessage = await shell.openPath(previewFilePath)
    if (errorMessage) {
      throw diagnosticsBundleFailure('previewOpenFailed')
    }
    const pending = pendingBundles.get(bundleSubmissionId as string)
    if (pending) {
      pending.previewOpened = true
    }
  })

  ipcMain.handle('diagnostics:discardBundlePreview', (_event, bundleSubmissionId: unknown) => {
    discardPendingBundle(bundleSubmissionId)
  })

  ipcMain.handle('diagnostics:deleteBundle', async (): Promise<never> => {
    throw new Error('Ash IDE does not have an external diagnostics deletion backend.')
  })
}
