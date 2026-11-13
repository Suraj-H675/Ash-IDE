// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/app-keyboard-router', () => ({
  addAppKeyListener: vi.fn(),
  removeAppKeyListener: vi.fn()
}))

import { useTaskPageGlobalEffects } from './use-task-page-global-effects'

const refreshPreflightStatus = vi.fn(async () => {})
const checkLinearConnection = vi.fn(async () => {})
const checkJiraConnection = vi.fn(async () => {})

function TaskPageEffects({ preflightReady }: { preflightReady: boolean }): null {
  useTaskPageGlobalEffects({
    closeTaskPage: () => {},
    activeModal: 'none',
    linearStatusContextKey: null,
    preflightStatusChecked: preflightReady,
    preflightStatusContextKey: preflightReady ? 'current' : null,
    checkLinearConnection,
    refreshPreflightStatus,
    expectedPreflightContextKey: 'current',
    jiraStatusContextKey: null,
    checkJiraConnection,
    providerRuntimeContextKey: 'local',
    preflightStatusCurrent: preflightReady,
    linearStatusReady: false,
    jiraStatusReady: false,
    githubListPending: false,
    tasksRefreshing: false,
    tasksFiltering: false,
    dialogWorkItem: null,
    newIssueOpen: false,
    selectedLinearIssue: null,
    selectedJiraIssue: null,
    newLinearIssueOpen: false,
    newJiraIssueOpen: false
  } as never)
  return null
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([false, true])(
  'Tasks opening with preflight ready=%s only refreshes retained code-host status',
  async (preflightReady) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<TaskPageEffects preflightReady={preflightReady} />))
      if (preflightReady) {
        expect(refreshPreflightStatus).not.toHaveBeenCalled()
      } else {
        expect(refreshPreflightStatus).toHaveBeenCalledOnce()
      }
      expect(checkJiraConnection).not.toHaveBeenCalled()
      expect(checkLinearConnection).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
)
