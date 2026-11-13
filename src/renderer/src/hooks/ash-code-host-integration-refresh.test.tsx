// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const callbacks = vi.hoisted(() => ({
  refreshPreflightStatus: vi.fn(async () => {}),
  checkLinearConnection: vi.fn(async () => {}),
  checkJiraConnection: vi.fn(async () => {})
}))

vi.mock('@/lib/local-preflight-context', () => ({
  getLocalPreflightContext: () => ({})
}))
vi.mock('@/lib/local-preflight-context-key', () => ({
  localPreflightContextKey: () => 'current-preflight'
}))
vi.mock('@/store/index', () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({
      preflightStatusChecked: false,
      preflightStatusContextKey: null,
      linearStatusChecked: false,
      linearStatusContextKey: null,
      jiraStatusChecked: false,
      jiraStatusContextKey: null,
      ...callbacks
    })
}))

import { useIntegrationProviderStatusRefresh } from './use-integration-provider-status-refresh'

function CheckCodeHosts(): null {
  useIntegrationProviderStatusRefresh()
  return null
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('refreshes local code-host preflight without querying excluded Jira or Linear providers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<CheckCodeHosts />))
    expect(callbacks.refreshPreflightStatus).toHaveBeenCalledOnce()
    expect(callbacks.checkJiraConnection).not.toHaveBeenCalled()
    expect(callbacks.checkLinearConnection).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
