// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const providerReads = vi.hoisted(() => ({
  jiraListPrioritiesForTarget: vi.fn(async () => []),
  readJiraQuickFilterState: vi.fn(async () => ({ statuses: [] })),
  writeJiraQuickFilterState: vi.fn(async () => ({ statuses: [] })),
  readJiraSavedFilterState: vi.fn(async () => ({ filters: [], activeFilterId: null })),
  mutateJiraSavedFilters: vi.fn(async () => ({ filters: [], activeFilterId: null })),
  jiraListFavouriteFiltersForTarget: vi.fn(async () => ({
    supported: true,
    filters: [],
    truncated: false
  })),
  fetchLinearProject: vi.fn(async () => null),
  fetchLinearCustomView: vi.fn(async () => null)
}))

vi.mock('@/runtime/runtime-jira-detail-client', () => ({
  jiraListPrioritiesForTarget: providerReads.jiraListPrioritiesForTarget
}))
vi.mock('@/runtime/runtime-jira-quick-filter-state', () => ({
  readJiraQuickFilterState: providerReads.readJiraQuickFilterState,
  writeJiraQuickFilterState: providerReads.writeJiraQuickFilterState
}))
vi.mock('@/runtime/runtime-jira-saved-filter-state', () => ({
  readJiraSavedFilterState: providerReads.readJiraSavedFilterState,
  mutateJiraSavedFilters: providerReads.mutateJiraSavedFilters
}))
vi.mock('@/runtime/runtime-jira-favourite-filters-client', () => ({
  jiraListFavouriteFiltersForTarget: providerReads.jiraListFavouriteFiltersForTarget
}))
vi.mock('@/components/jira-list-columns', () => ({
  fallbackJiraSortColumn: () => 'priority',
  loadJiraListColumnIds: () => new Set(['key', 'title', 'priority']),
  saveJiraListColumnIds: vi.fn(),
  visibleJiraListColumns: () => []
}))

import { useTaskPageJiraListState } from './jira/use-task-page-jira-list-state'
import { useTaskPageResumeRestoration } from './use-task-page-resume-restoration'

afterEach(() => {
  vi.clearAllMocks()
})

async function mountProbe(render: () => void, afterRender?: () => void): Promise<void> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await act(async () => root.render(<Probe />))
    if (afterRender) {
      await act(async () => afterRender())
    }
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }

  function Probe(): null {
    render()
    return null
  }
}

it('does not read Jira list metadata, saved filters, quick filters or favourites from a stale source', async () => {
  let loadFavourites: (() => void) | undefined
  await mountProbe(
    () => {
      const model = useTaskPageJiraListState({
        jiraConnected: true,
        selectedJiraSiteId: 'legacy-site',
        taskSource: 'jira',
        jiraTaskSourceContext: null,
        jiraTaskSourceScopeKey: 'legacy-jira-scope',
        accountBackedTaskSourceHostId: 'local',
        taskResumeApplied: true,
        visibleTaskProviders: ['github'],
        repos: [],
        selectedRepos: [],
        pageData: { preselectedRepoId: undefined }
      } as never)
      loadFavourites = model.loadJiraFavouriteFilters
    },
    () => loadFavourites?.()
  )

  expect(providerReads.jiraListPrioritiesForTarget).not.toHaveBeenCalled()
  expect(providerReads.readJiraQuickFilterState).not.toHaveBeenCalled()
  expect(providerReads.readJiraSavedFilterState).not.toHaveBeenCalled()
  expect(providerReads.jiraListFavouriteFiltersForTarget).not.toHaveBeenCalled()
})

it('does not restore a saved Linear project from an excluded task source', async () => {
  await mountProbe(() => {
    useTaskPageResumeRestoration({
      settings: { defaultTaskSource: 'github', defaultTaskViewPreset: 'all' },
      persistedUIReady: true,
      taskResumeState: {
        linearContext: { kind: 'project', id: 'legacy-project', workspaceId: 'legacy-workspace' }
      },
      setTaskResumeState: vi.fn(),
      pageData: { taskSource: 'linear' },
      fetchLinearProject: providerReads.fetchLinearProject,
      listLinearCustomViews: vi.fn(),
      fetchLinearCustomView: providerReads.fetchLinearCustomView,
      linearConnected: true,
      resolvedInitialSelection: new Set(),
      setRepoSelection: vi.fn(),
      visibleTaskProviders: ['github'],
      taskSource: 'linear',
      setTaskSource: vi.fn(),
      linearTaskSourceContext: null,
      taskResumeAppliedRef: { current: true },
      taskResumeApplied: true,
      setTaskResumeApplied: vi.fn(),
      setGithubMode: vi.fn(),
      setTaskSearchInput: vi.fn(),
      setAppliedTaskSearch: vi.fn(),
      setActiveTaskPreset: vi.fn(),
      setLinearMode: vi.fn(),
      setLinearSearchInput: vi.fn(),
      setAppliedLinearSearch: vi.fn(),
      setLinearIssueFiltersByWorkspaceId: vi.fn(),
      setLinearViewMode: vi.fn(),
      setLinearGroupBy: vi.fn(),
      setLinearOrderBy: vi.fn(),
      setLinearDisplayProperties: vi.fn(),
      setLinearTeamPropertyTouched: vi.fn(),
      setLinearProjectsError: vi.fn(),
      setSelectedLinearProject: vi.fn(),
      setSelectedLinearProjectDetail: vi.fn(),
      setLinearCustomViewsLoading: vi.fn(),
      setLinearCustomViewsError: vi.fn(),
      setSelectedLinearCustomView: vi.fn(),
      setLinearProjectParentView: vi.fn(),
      linearContextResumeAttemptedRef: { current: false },
      setJiraSearchInput: vi.fn(),
      setAppliedJiraSearch: vi.fn(),
      setActiveJiraPreset: vi.fn()
    } as never)
  })

  expect(providerReads.fetchLinearProject).not.toHaveBeenCalled()
  expect(providerReads.fetchLinearCustomView).not.toHaveBeenCalled()
})

it('does not mount excluded provider list and collection effect stages in the Tasks pipeline', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile('src/renderer/src/components/task-page/TaskPage.tsx', 'utf8')
  expect(source).not.toContain('useTaskPageLinearListEffects')
  expect(source).not.toContain('useTaskPageLinearInOrcaEffects')
  expect(source).not.toContain('useTaskPageLinearCollectionEffects')
  expect(source).not.toContain('useTaskPageJiraListEffects')
  expect(source).not.toContain('useTaskPageJiraCreationMetadata')
  expect(source).not.toContain('useTaskPageLinearCreationState')
  expect(source).not.toContain('useTaskPageLinearProjectCreation')
  expect(source).not.toContain('useTaskPageLinearIssueCreation')
  expect(source).not.toContain('useTaskPageJiraCreationState')
  expect(source).not.toContain('useTaskPageJiraIssueCreation')
  expect(source).not.toContain('useTaskPageJiraSummaryGeneration')
})
