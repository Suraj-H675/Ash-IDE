import type { TaskPageRepoSourceState } from '@/components/task-page/task-page-cache-selectors'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'
import { sameGitHubOwnerRepo } from '@/components/github/IssueSourceIndicator'
export const hasDivergentSources = (
  s: TaskPageRepoSourceState
): s is TaskPageRepoSourceState & {
  sources: {
    issues: GitHubOwnerRepo
    prs: GitHubOwnerRepo
  }
} => !!s.sources?.issues && !!s.sources.prs && !sameGitHubOwnerRepo(s.sources.issues, s.sources.prs)

// Why: raw candidate divergence keeps the toggle visible after selecting upstream.
export const hasUpstreamCandidateDivergence = (
  s: TaskPageRepoSourceState
): s is TaskPageRepoSourceState & {
  sources: {
    originCandidate: GitHubOwnerRepo
    upstreamCandidate: GitHubOwnerRepo
  }
} =>
  !!s.sources?.originCandidate &&
  !!s.sources.upstreamCandidate &&
  !sameGitHubOwnerRepo(s.sources.originCandidate, s.sources.upstreamCandidate)
