import { useMemo } from 'react'
import type { TaskProvider } from '../../../../../shared/task-providers'
import { getLocalPreflightContext } from '@/lib/local-preflight-context'
import { localPreflightContextKey } from '@/lib/local-preflight-context-key'
import { useAppStore } from '@/store/index'
import type { TaskProviderReadiness } from './task-source-setup-state'

export function useTaskSourceProviderReadiness(
  visibleProviders: readonly TaskProvider[]
): Record<TaskProvider, TaskProviderReadiness> {
  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const preflightStatusContextKey = useAppStore((s) => s.preflightStatusContextKey)
  const preflightStatusError = useAppStore((s) => s.preflightStatusError)
  const preflightStatusLoading = useAppStore((s) => s.preflightStatusLoading)
  const expectedPreflightContextKey = useAppStore((s) =>
    localPreflightContextKey(getLocalPreflightContext(s))
  )

  const preflightCurrent = preflightStatusContextKey === expectedPreflightContextKey
  const reviewChecking = preflightStatusLoading || !preflightStatusChecked || !preflightCurrent
  // Failed preflight retains stale status; reject it so Task Sources agrees with Integrations.
  const reviewReadyForConnection = !reviewChecking && preflightStatusError === null
  const reviewUnavailable = !reviewChecking && preflightStatusError !== null
  const githubConnected =
    reviewReadyForConnection &&
    preflightStatus?.gh?.installed === true &&
    preflightStatus.gh.authenticated === true
  const gitlabConnected =
    reviewReadyForConnection &&
    preflightStatus?.glab?.installed === true &&
    preflightStatus.glab.authenticated === true
  // Normalization returns a new array, so memoize by provider contents.
  const visibleProvidersKey = visibleProviders.join(',')

  return useMemo(() => {
    const visible = new Set(visibleProvidersKey.split(',') as TaskProvider[])
    return {
      github: {
        connected: githubConnected,
        checking: reviewChecking,
        unavailable: reviewUnavailable,
        visible: visible.has('github')
      },
      gitlab: {
        connected: gitlabConnected,
        checking: reviewChecking,
        unavailable: reviewUnavailable,
        visible: visible.has('gitlab')
      },
      linear: {
        connected: false,
        checking: false,
        visible: false
      },
      jira: {
        connected: false,
        checking: false,
        visible: false
      }
    }
  }, [githubConnected, gitlabConnected, reviewChecking, reviewUnavailable, visibleProvidersKey])
}
