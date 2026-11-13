import type { TaskPageJiraListStateModel } from './jira/use-task-page-jira-list-state'
import { useEffect } from 'react'
import { resolveVisibleTaskProvider } from '../../../../shared/task-providers'
import { normalizeGitHubTaskPreset } from '../../../../shared/task-github-search'
import { getTaskPresetQuery } from '../../../../shared/task-preset-query'
import { loadLinearIssueView } from '../linear-issue-view-storage'
export function useTaskPageResumeRestoration(model: TaskPageJiraListStateModel) {
  const {
    settings,
    persistedUIReady,
    taskResumeState,
    pageData,
    resolvedInitialSelection,
    setRepoSelection,
    visibleTaskProviders,
    setTaskSource,
    taskResumeAppliedRef,
    setTaskResumeApplied,
    setGithubMode,
    setTaskSearchInput,
    setAppliedTaskSearch,
    setActiveTaskPreset,
    setLinearMode,
    setLinearSearchInput,
    setAppliedLinearSearch,
    setLinearIssueFiltersByWorkspaceId,
    setLinearViewMode,
    setLinearGroupBy,
    setLinearOrderBy,
    setLinearDisplayProperties,
    setLinearTeamPropertyTouched,
    setJiraSearchInput,
    setAppliedJiraSearch,
    setActiveJiraPreset
  } = model
  useEffect(() => {
    if (taskResumeAppliedRef.current || !persistedUIReady || !settings) {
      return
    }
    setTaskSource(
      resolveVisibleTaskProvider(
        pageData.taskSource ?? settings.defaultTaskSource,
        visibleTaskProviders
      )
    )
    setRepoSelection(resolvedInitialSelection)
    const nextGithubMode = taskResumeState?.githubMode ?? 'items'
    setGithubMode(nextGithubMode)
    const preset = taskResumeState?.githubItemsPreset
    if (preset === null) {
      const query = taskResumeState?.githubItemsQuery ?? ''
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(null)
    } else {
      const presetId = normalizeGitHubTaskPreset(preset ?? settings.defaultTaskViewPreset)
      const query = getTaskPresetQuery(presetId)
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(presetId)
    }
    const linearQuery = taskResumeState?.linearQuery ?? ''
    setLinearMode(taskResumeState?.linearMode ?? 'issues')
    setLinearSearchInput(linearQuery)
    setAppliedLinearSearch(linearQuery)
    const linearIssueView = loadLinearIssueView()
    setLinearViewMode(linearIssueView.viewMode)
    setLinearGroupBy(linearIssueView.groupBy)
    setLinearOrderBy(linearIssueView.orderBy)
    setLinearDisplayProperties(new Set(linearIssueView.displayProperties))
    setLinearTeamPropertyTouched(linearIssueView.teamPropertyTouched)
    setLinearIssueFiltersByWorkspaceId(linearIssueView.filtersByWorkspaceId)
    const jiraPreset = taskResumeState?.jiraPreset ?? 'assigned'
    const jiraQuery = taskResumeState?.jiraQuery ?? ''
    setActiveJiraPreset(jiraPreset)
    setJiraSearchInput(jiraQuery)
    setAppliedJiraSearch(jiraQuery)

    // Restore async-hydrated context once so later source/filter choices remain local.
    taskResumeAppliedRef.current = true
    setTaskResumeApplied(true)
  }, [
    persistedUIReady,
    settings,
    pageData.taskSource,
    resolvedInitialSelection,
    taskResumeState,
    visibleTaskProviders,
    setTaskSearchInput,
    setActiveTaskPreset,
    taskResumeAppliedRef,
    setActiveJiraPreset,
    setLinearMode,
    setLinearSearchInput,
    setAppliedLinearSearch,
    setAppliedTaskSearch,
    setTaskSource,
    setJiraSearchInput,
    setLinearOrderBy,
    setRepoSelection,
    setLinearDisplayProperties,
    setLinearIssueFiltersByWorkspaceId,
    setGithubMode,
    setLinearTeamPropertyTouched,
    setAppliedJiraSearch,
    setTaskResumeApplied,
    setLinearGroupBy,
    setLinearViewMode
  ])
  return model
}
export type TaskPageResumeRestorationModel = ReturnType<typeof useTaskPageResumeRestoration>
