import React from 'react'
import { useTaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageRepoSelection } from './use-task-page-repo-selection'
import { useTaskPageRuntimeHosts } from './use-task-page-runtime-hosts'
import { useTaskPageSourceAvailability } from './use-task-page-source-availability'
import { useTaskPageProviderState } from './use-task-page-provider-state'
import { useTaskPageGitHubListState } from './github/use-task-page-github-list-state'
import { useTaskPageGitHubDetail } from './github/use-task-page-github-detail'
import { useTaskPageGitHubCacheReconciliation } from './github/use-task-page-github-cache-reconciliation'
import { useTaskPageGitHubIssueDraft } from './github/use-task-page-github-issue-draft'
import { useTaskPageDetailRouting } from './use-task-page-detail-routing'
import { useTaskPageLinearViewState } from './linear/use-task-page-linear-view-state'
import { useTaskPageJiraListState } from './jira/use-task-page-jira-list-state'
import { useTaskPageResumeRestoration } from './use-task-page-resume-restoration'
import { useTaskPageProviderMetadata } from './use-task-page-provider-metadata'
import { useTaskPageGitLabLoading } from './gitlab/use-task-page-gitlab-loading'
import { useTaskPageLinearListSelection } from './linear/use-task-page-linear-list-selection'
import { useTaskPageLinearListProjection } from './linear/use-task-page-linear-list-projection'
import { useTaskPageLinearBoard } from './linear/use-task-page-linear-board'
import { useTaskPageJiraListProjection } from './jira/use-task-page-jira-list-projection'
import { useTaskPageGitHubMutationState } from './github/use-task-page-github-mutation-state'
import { useTaskPageGitHubListProjection } from './github/use-task-page-github-list-projection'
import { useTaskPageGitHubSearchPagination } from './github/use-task-page-github-search-pagination'
import { useTaskPageGitHubLandingRefresh } from './github/use-task-page-github-landing-refresh'
import { useTaskPageGitHubQuietRefresh } from './github/use-task-page-github-quiet-refresh'
import { useTaskPageSearchActions } from './use-task-page-search-actions'
import { useTaskPageWorkspaceActions } from './use-task-page-workspace-actions'
import { useTaskPageGitHubIssueCreation } from './github/use-task-page-github-issue-creation'
import { useTaskPageGlobalEffects } from './use-task-page-global-effects'
import { useTaskPageComposerActions } from './use-task-page-composer-actions'
import { TaskPageSurface } from './Surface'

export default function TaskPage(): React.JSX.Element {
  const stage1 = useTaskPageStoreBindings()
  const stage2 = useTaskPageRepoSelection(stage1)
  const stage3 = useTaskPageRuntimeHosts(stage2)
  const stage4 = useTaskPageSourceAvailability(stage3)
  const stage5 = useTaskPageProviderState(stage4)
  const stage6 = useTaskPageGitHubListState(stage5)
  const stage7 = useTaskPageGitHubDetail(stage6)
  const stage8 = useTaskPageGitHubCacheReconciliation(stage7)
  const stage9 = useTaskPageGitHubIssueDraft(stage8)
  const stage10 = useTaskPageDetailRouting(stage9)
  const stage11 = useTaskPageLinearViewState(stage10)
  const stage12 = useTaskPageJiraListState(stage11)
  const stage13 = useTaskPageResumeRestoration(stage12)
  const stage14 = useTaskPageProviderMetadata(stage13)
  const stage15 = useTaskPageGitLabLoading(stage14)
  const stage16 = useTaskPageLinearListSelection(stage15)
  const stage17 = useTaskPageLinearListProjection(stage16)
  const stage18 = useTaskPageLinearBoard(stage17)
  const stage19 = useTaskPageJiraListProjection(stage18)
  const stage20 = useTaskPageGitHubMutationState(stage19)
  const stage21 = useTaskPageGitHubListProjection(stage20)
  const stage22 = useTaskPageGitHubSearchPagination(stage21)
  const stage23 = useTaskPageGitHubLandingRefresh(stage22)
  const stage24 = useTaskPageGitHubQuietRefresh(stage23)
  const stage25 = useTaskPageSearchActions(stage24)
  const stage26 = useTaskPageWorkspaceActions(stage25)
  const stage27 = useTaskPageGitHubIssueCreation(stage26)
  const stage28 = useTaskPageGlobalEffects(stage27)
  const stage29 = useTaskPageComposerActions(stage28)
  return <TaskPageSurface model={stage29} />
}
