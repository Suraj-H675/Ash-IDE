import type {
  LinearIssueData,
  LinearIssueView
} from '@/store/slices/linear/linear-issue-publication'
import { useLinearIssueResult } from '@/hooks/linear-issue-committed-state'
import { getLinearSourceScope } from '@/store/slices/linear/linear-slice-scope'
import { getSelectedWorkspaceId } from '@/store/slices/linear/linear-cache'
import { defaultScopeSource } from '@/lib/default-creation-host'
import type { LinearIssue } from '../../../../shared/linear/issue-types'
import { parseBoundedSmartWorkspaceLinearIssueUrlIntent } from '../../../../shared/new-workspace/smart-workspace-linear-intent'
import { isSmartWorkspaceSourceQueryWithinLimit } from '../../../../shared/new-workspace/smart-workspace-source-results'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { buildTaskSourceContextFromRepo } from '../../../../shared/task-source-context'
import type {
  NormalizedWorkItemSourceSearchProps,
  RepoBackedSearchTarget
} from './smart-workspace-name-field-model'
import { useJiraSourceConnection } from './use-jira-source-connection'
import { useJiraUrlSource } from './use-jira-url-source'
import { useSmartWorkspaceFieldAvailability } from './use-smart-workspace-field-availability'
import { useWorkItemSourceState } from './use-work-item-source-state'
import { useJiraComposerProject } from './use-jira-composer-project'
import { useComposerSourceScope } from './use-composer-source-scope'

export function useWorkItemSourceFoundation(props: NormalizedWorkItemSourceSearchProps) {
  const {
    repos,
    repoId,
    githubSourceContext: githubSourceContextOverride,
    repoBackedSearchRepos,
    textOnly,
    value,
    disabled
  } = props
  const {
    settings,
    fetchWorkItems,
    fetchWorkItemsAcrossRepos,
    fetchLinearIssue,
    getCachedWorkItems,
    listLinearIssues,
    preflightStatus,
    preflightStatusChecked,
    preflightStatusContextKey,
    expectedPreflightContextKey,
    refreshPreflightStatus,
    searchJiraIssues,
    searchLinearIssues
  } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      fetchWorkItems: s.fetchWorkItems,
      fetchWorkItemsAcrossRepos: s.fetchWorkItemsAcrossRepos,
      fetchLinearIssue: s.fetchLinearIssue,
      getCachedWorkItems: s.getCachedWorkItems,
      listLinearIssues: s.listLinearIssues,
      preflightStatus: s.preflightStatus,
      preflightStatusChecked: s.preflightStatusChecked,
      preflightStatusContextKey: s.preflightStatusContextKey,
      expectedPreflightContextKey: localPreflightContextKey(getLocalPreflightContext(s)),
      refreshPreflightStatus: s.refreshPreflightStatus,
      searchJiraIssues: s.searchJiraIssues,
      searchLinearIssues: s.searchLinearIssues
    }))
  )
  const selectedRepo = useMemo(
    () =>
      props.selectedRepo !== undefined
        ? props.selectedRepo
        : (repos.find((repo) => repo.id === repoId) ?? null),
    [props.selectedRepo, repoId, repos]
  )
  const githubSourceContext = useMemo(() => {
    if (githubSourceContextOverride?.provider === 'github') {
      return githubSourceContextOverride
    }
    return selectedRepo
      ? buildTaskSourceContextFromRepo({
          provider: 'github',
          projectId: selectedRepo.id,
          repo: selectedRepo
        })
      : null
  }, [githubSourceContextOverride, selectedRepo])
  const gitlabSourceContext = useMemo(
    () =>
      props.gitlabSourceContext?.provider === 'gitlab'
        ? props.gitlabSourceContext
        : selectedRepo
          ? buildTaskSourceContextFromRepo({
              provider: 'gitlab',
              projectId: selectedRepo.id,
              repo: selectedRepo
            })
          : null,
    [props.gitlabSourceContext, selectedRepo]
  )
  const repoBackedSearchTargets = useMemo<RepoBackedSearchTarget[]>(
    () =>
      (repoBackedSearchRepos.length > 0
        ? repoBackedSearchRepos
        : selectedRepo
          ? [selectedRepo]
          : []
      ).map((repo) => ({
        repo,
        githubSourceContext:
          repo.id === selectedRepo?.id && githubSourceContext?.provider === 'github'
            ? githubSourceContext
            : buildTaskSourceContextFromRepo({
                provider: 'github',
                projectId: repo.id,
                repo
              }),
        gitlabSourceContext:
          repo.id === selectedRepo?.id && gitlabSourceContext?.provider === 'gitlab'
            ? gitlabSourceContext
            : buildTaskSourceContextFromRepo({
                provider: 'gitlab',
                projectId: repo.id,
                repo
              })
      })),
    [githubSourceContext, gitlabSourceContext, repoBackedSearchRepos, selectedRepo]
  )
  // Ash Tasks supports code-host work items only. Legacy Linear source context is deliberately
  // ignored so opening the workspace composer cannot trigger provider status or issue reads.
  const linearSourceContext = null
  const jiraSourceContext = null
  const state = useWorkItemSourceState(textOnly, value)
  const linearStatus = { connected: false, viewer: null }
  const linearStatusChecked = true
  const [linearWorkspaceIdOverride, setLinearWorkspaceId] = useComposerSourceScope<
    string | null | undefined
  >(null, null, undefined)
  const source = linearSourceContext ?? defaultScopeSource(settings)
  const scopeKey = useAppStore(() => getLinearSourceScope(source).contextKey)
  const jiraConnection = useJiraSourceConnection({
    enabled: false,
    sourceContext: null
  })
  const jiraConnectionStatus = jiraConnection.status
  const jiraSource = useJiraUrlSource({
    value,
    enabled: false,
    sourceContext: jiraSourceContext,
    connection: jiraConnection
  })
  const jiraSourceConnected = jiraConnectionStatus?.connected === true
  const jiraProject = useJiraComposerProject(selectedRepo, null, false)
  const showJiraSiteContext = false
  const availability = useSmartWorkspaceFieldAvailability({
    props,
    state,
    repoBackedSearchTargets,
    preflightStatus,
    preflightStatusChecked,
    preflightStatusContextKey,
    expectedPreflightContextKey,
    refreshPreflightStatus
  })
  const linearUrlIntentOwnsInput =
    parseBoundedSmartWorkspaceLinearIssueUrlIntent(value) !== null &&
    (state.mode === 'smart' || state.mode === 'linear')
  const query = linearUrlIntentOwnsInput ? value : state.debouncedQuery
  const ordinaryLinearQuery =
    !disabled &&
    !textOnly &&
    !linearUrlIntentOwnsInput &&
    !jiraSource.intent &&
    availability.linearAvailable &&
    linearStatus.connected === true &&
    isSmartWorkspaceSourceQueryWithinLimit(query) &&
    (state.mode === 'smart' || state.mode === 'linear')
  const linearResultScope = JSON.stringify([
    scopeKey,
    linearWorkspaceIdOverride,
    getSelectedWorkspaceId(linearStatus, { workspaceId: linearWorkspaceIdOverride }),
    ordinaryLinearQuery
  ])
  const linearIssueResult = useLinearIssueResult<LinearIssue[]>(
    JSON.stringify([linearResultScope, query]),
    [],
    getLinearSourceScope(source),
    (previousData, previousTarget) => {
      const previous: unknown = JSON.parse(previousTarget)
      return ordinaryLinearQuery &&
        query.trim() !== '' &&
        Array.isArray(previous) &&
        previous[0] === linearResultScope
        ? previousData
        : []
    }
  )

  return {
    ...props,
    ...state,
    linearIssueResult,
    refreshLinearSourceConnection: (
      _view: LinearIssueView<LinearIssueData>,
      _workspaceId?: string | null
    ) => Promise.resolve(),
    linearIssues: linearIssueResult.data,
    setLinearIssues: linearIssueResult.setData,
    linearLoading: linearIssueResult.loading,
    setLinearLoading: linearIssueResult.setLoading,
    linearReadError: linearIssueResult.error,
    setLinearReadError: linearIssueResult.setError,
    settledLinearUrlQuery: linearIssueResult.settledUrl,
    setSettledLinearUrlQuery: linearIssueResult.setSettledUrl,
    ...availability,
    fetchWorkItems,
    fetchWorkItemsAcrossRepos,
    fetchLinearIssue,
    getCachedWorkItems,
    linearStatus,
    linearStatusChecked,
    linearWorkspaceIdOverride,
    setLinearWorkspaceId,
    listLinearIssues,
    searchJiraIssues,
    searchLinearIssues,
    selectedRepo,
    githubSourceContext,
    gitlabSourceContext,
    repoBackedSearchTargets,
    linearSourceContext,
    jiraSourceContext,
    jiraConnectionStatus,
    jiraSource,
    jiraSourceConnected,
    ...jiraProject,
    showJiraSiteContext
  }
}
