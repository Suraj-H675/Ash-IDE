import { useEffect } from 'react'
import type { FeatureWallWorkflow } from '../../../../shared/feature-wall-workflows'
import { useAppStore } from '@/store'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { deriveIntegrationConnectionStatus } from './use-integration-connection-status'

export type FeatureWallTaskSourcePresentation = {
  workflow: FeatureWallWorkflow
  hasConnectedTaskSource: boolean
  // Hide disconnected setup until provider checks settle to prevent flashes for connected users.
  isCheckingTaskSources: boolean
}

export function useFeatureWallTaskSourcePresentation(
  isOpen: boolean,
  selected: FeatureWallWorkflow
): FeatureWallTaskSourcePresentation {
  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const preflightStatusContextKey = useAppStore((s) => s.preflightStatusContextKey)
  const preflightStatusError = useAppStore((s) => s.preflightStatusError)
  const preflightStatusLoading = useAppStore((s) => s.preflightStatusLoading)
  const refreshPreflightStatus = useAppStore((s) => s.refreshPreflightStatus)
  const expectedPreflightContextKey = useAppStore((s) =>
    localPreflightContextKey(getLocalPreflightContext(s))
  )
  const preflightStatusCurrent = preflightStatusContextKey === expectedPreflightContextKey

  useEffect(() => {
    if (!isOpen) {
      return
    }
    // Refresh connection facts before choosing setup-oriented tour copy.
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
  }, [
    expectedPreflightContextKey,
    isOpen,
    preflightStatusContextKey,
    preflightStatusCurrent,
    preflightStatusChecked,
    refreshPreflightStatus
  ])

  const taskSourceStatus = deriveIntegrationConnectionStatus({
    preflightStatus,
    preflightStatusChecked,
    preflightStatusContextKey,
    preflightStatusError,
    preflightStatusLoading,
    expectedPreflightContextKey
  })

  return {
    workflow: selected,
    hasConnectedTaskSource: taskSourceStatus.trackerConnected,
    isCheckingTaskSources: taskSourceStatus.checking
  }
}
