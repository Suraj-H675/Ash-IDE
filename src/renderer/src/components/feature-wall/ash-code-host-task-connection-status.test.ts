import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({ useAppStore: () => null }))

import {
  deriveIntegrationConnectionStatus,
  deriveIntegrationFlowState
} from './use-integration-connection-status'

const base = {
  preflightStatusChecked: true,
  preflightStatusContextKey: 'current',
  preflightStatusError: null,
  preflightStatusLoading: false,
  expectedPreflightContextKey: 'current'
} as const

describe('Ash retained code-host task-source readiness', () => {
  it('accepts authenticated GitHub issues as a task source without a Jira/Linear check', () => {
    const status = deriveIntegrationConnectionStatus({
      ...base,
      preflightStatus: { gh: { installed: true, authenticated: true } }
    })
    expect(status.taskSourceNames).toEqual(['GitHub'])
    expect(status.trackerProviderName).toBeNull()
    expect(status.trackerChecking).toBe(false)
    expect(status.trackerConnected).toBe(true)
    expect(
      deriveIntegrationFlowState({
        reviewConnected: status.reviewConnected,
        codeHostTaskProviderName: status.codeHostTaskProviderName
      })
    ).toMatchObject({ task: 'done', complete: true })
  })

  it('does not treat a review-only provider as an available code-host issue source', () => {
    const status = deriveIntegrationConnectionStatus({
      ...base,
      preflightStatus: { bitbucket: { configured: true, authenticated: true } }
    })
    expect(status.reviewConnected).toBe(true)
    expect(status.codeHostTaskProviderName).toBeNull()
    expect(status.taskSourceNames).toEqual([])
    expect(status.trackerConnected).toBe(false)
    expect(
      deriveIntegrationFlowState({
        reviewConnected: status.reviewConnected,
        codeHostTaskProviderName: status.codeHostTaskProviderName
      })
    ).toMatchObject({ task: 'active', complete: false })
  })
})
