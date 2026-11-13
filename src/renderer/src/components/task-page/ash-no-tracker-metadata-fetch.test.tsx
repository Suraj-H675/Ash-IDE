// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const retiredProviderCalls = vi.hoisted(() => ({
  jiraListProjects: vi.fn(async () => []),
  listLinearTeams: vi.fn(async () => []),
  getCachedLinearTeams: vi.fn(() => [])
}))

vi.mock('@/runtime/runtime-jira-client', () => ({
  jiraListProjects: retiredProviderCalls.jiraListProjects
}))
vi.mock('@/lib/default-creation-host', () => ({ defaultScopeSource: () => ({}) }))

import { useTaskPageProviderMetadata } from './use-task-page-provider-metadata'

const stableSettings = {}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mountLegacyTaskSource(taskSource: 'github' | 'gitlab' | 'jira' | 'linear') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let captured:
    | {
        availableTeams: readonly unknown[]
        availableJiraProjects: readonly unknown[]
        jiraProjectsLoading: boolean
      }
    | undefined

  function Probe(): null {
    const model = useTaskPageProviderMetadata({
      settings: stableSettings,
      taskResumeApplied: true,
      taskSource,
      linearConnected: true,
      jiraConnected: true,
      selectedLinearWorkspaceId: 'legacy-workspace',
      selectedJiraSiteId: 'legacy-site',
      linearTaskSourceContext: null,
      jiraTaskSourceContext: null,
      getCachedLinearTeams: retiredProviderCalls.getCachedLinearTeams,
      listLinearTeams: retiredProviderCalls.listLinearTeams
    } as never)
    captured = {
      availableTeams: model.availableTeams,
      availableJiraProjects: model.availableJiraProjects,
      jiraProjectsLoading: model.jiraProjectsLoading
    }
    return null
  }

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await act(async () => root.render(<Probe />))
    expect(captured).toEqual({
      availableTeams: [],
      availableJiraProjects: [],
      jiraProjectsLoading: false
    })
    expect(retiredProviderCalls.getCachedLinearTeams).not.toHaveBeenCalled()
    expect(retiredProviderCalls.listLinearTeams).not.toHaveBeenCalled()
    expect(retiredProviderCalls.jiraListProjects).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}

it.each(['linear', 'jira'] as const)(
  'does not query excluded %s metadata even if a stale task source claims connected',
  async (provider) => {
    await mountLegacyTaskSource(provider)
  }
)

it.each(['github', 'gitlab'] as const)(
  'preserves an inert metadata stage for the supported %s task source',
  async (provider) => {
    await mountLegacyTaskSource(provider)
  }
)
