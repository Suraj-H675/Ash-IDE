import { join } from 'node:path'
import { observeAgentStateFile } from '../codex-path-observation'
import { writeFileAtomicallyIfUnchanged } from '../../../codex-accounts/fs-utils'
import type { CodexSettingsPromotionHomes } from './config-settings-promotion'
import { applyNativeProjectRevocationsToRuntime } from './codex-config-mirror-merge'
import { getCodexConfigSyncStatus, reportCodexConfigSyncOutcome } from './config-sync-stall'

/** Keep native project distrust authoritative even if unrelated settings promotion fails. */
export function guardNativeTrustAfterFailedPromotion(homes: CodexSettingsPromotionHomes): void {
  try {
    syncNativeProjectRevocationsDuringRefusedWriteBack(homes)
  } finally {
    const stalledStatus = getCodexConfigSyncStatus(homes)
    if (stalledStatus.state === 'stalled') {
      reportCodexConfigSyncOutcome(homes.runtimeHomePath, stalledStatus)
    }
  }
}

/** A failed mirror cannot quietly leave a native project revocation unapplied. */
export function guardNativeTrustAfterFailedMirror(
  homes: CodexSettingsPromotionHomes,
  mirrorError: unknown
): void {
  try {
    syncNativeProjectRevocationsDuringRefusedWriteBack(homes)
  } finally {
    reportCodexConfigSyncOutcome(
      homes.runtimeHomePath,
      getCodexConfigSyncStatus(homes),
      mirrorError
    )
  }
}

/** Degrade write-back without dropping local changes or provider-side distrust. */
export function reportRefusedCodexWriteBack(homes: CodexSettingsPromotionHomes): void {
  try {
    syncNativeProjectRevocationsDuringRefusedWriteBack(homes)
  } finally {
    reportCodexConfigSyncOutcome(homes.runtimeHomePath, {
      state: 'stalled',
      reason: 'provider-writeback-refused',
      systemConfigPath: join(homes.systemHomePath, 'config.toml')
    })
  }
}

/** Preserve pending Ash runtime edits while honoring explicit provider-side project distrust. */
export function syncNativeProjectRevocationsDuringRefusedWriteBack(
  homes: CodexSettingsPromotionHomes
): void {
  try {
    const native = observeAgentStateFile(join(homes.systemHomePath, 'config.toml'))
    const runtimePath = join(homes.runtimeHomePath, 'config.toml')
    const runtime = observeAgentStateFile(runtimePath)
    if (native.kind === 'indeterminate' || runtime.kind !== 'present') {
      throw new Error('Cannot verify native project trust against the managed Codex config')
    }
    if (native.kind === 'absent') {
      return
    }
    const next = applyNativeProjectRevocationsToRuntime(runtime.value, native.value)
    if (
      next !== runtime.value &&
      !writeFileAtomicallyIfUnchanged(runtimePath, runtime.value, next, { mode: 0o600 })
    ) {
      throw new Error('Ash runtime config changed while applying provider project revocations')
    }
  } catch (error) {
    console.warn('[codex-config] Failed to apply native project trust revocations:', error)
    throw new Error(
      'Codex project trust revocation could not be safely applied; refusing managed config sync',
      { cause: error }
    )
  }
}
