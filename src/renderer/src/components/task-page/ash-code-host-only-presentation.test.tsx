import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./Frame', () => ({ TaskPageFrame: () => <span>Retained task frame</span> }))
vi.mock('./github/IssueDialog', () => ({
  TaskPageGitHubIssueDialog: () => <span>GitHub issue dialog</span>
}))
vi.mock('./gitlab/Dialog', () => ({ TaskPageGitLabDialog: () => <span>GitLab issue dialog</span> }))
vi.mock('./linear/ProjectDialog', () => ({
  TaskPageLinearProjectDialog: () => <span>Linear project dialog</span>
}))
vi.mock('./linear/IssueDialog', () => ({
  TaskPageLinearIssueDialog: () => <span>Linear issue dialog</span>
}))
vi.mock('./jira/IssueDialog', () => ({
  TaskPageJiraIssueDialog: () => <span>Jira issue dialog</span>
}))
vi.mock('./linear/ConnectDialog', () => ({
  TaskPageLinearConnectDialog: () => <span>Linear credential dialog</span>
}))
vi.mock('./jira/ConnectDialog', () => ({
  TaskPageJiraConnectDialog: () => <span>Jira credential dialog</span>
}))
vi.mock('./github/List', () => ({ TaskPageGitHubList: () => <span>GitHub issue list</span> }))
vi.mock('./gitlab/TodoList', () => ({
  TaskPageGitLabTodoList: () => <span>GitLab todo list</span>
}))
vi.mock('./gitlab/ItemList', () => ({
  TaskPageGitLabItemList: () => <span>GitLab issue list</span>
}))
vi.mock('./jira/Content', () => ({ TaskPageJiraContent: () => <span>Jira issue list</span> }))
vi.mock('@/components/PullRequestPage', () => ({ default: () => <span>GitHub PR</span> }))
vi.mock('@/components/GitHubItemDialog', () => ({ default: () => <span>GitHub detail</span> }))
vi.mock('@/components/github-project/ProjectViewWrapper', () => ({
  default: () => <span>GitHub project</span>
}))
vi.mock('./github/Filters', () => ({ TaskPageGitHubFilters: () => <span>GitHub filters</span> }))
vi.mock('./gitlab/Filters', () => ({ TaskPageGitLabFilters: () => <span>GitLab filters</span> }))
vi.mock('./linear/Filters', () => ({ TaskPageLinearFilters: () => <span>Linear filters</span> }))
vi.mock('./jira/Filters', () => ({ TaskPageJiraFilters: () => <span>Jira filters</span> }))
vi.mock('@/components/linear-scope-selector', () => ({
  LinearScopeSelector: () => <span>Linear scope selector</span>
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>Jira site selector {children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span>Current site</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

import { TaskPageSurface } from './Surface'
import { TaskPageContent } from './Content'
import { TaskPageProviderFilters } from './ProviderFilters'
import { TaskPageSourceBar } from './SourceBar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getSourceOptions } from './task-page-localized-options'

const model = (taskSource: string, more: Record<string, unknown> = {}) =>
  ({
    taskSource,
    githubMode: 'items',
    gitlabView: 'issues',
    dialogWorkItem: null,
    linearConnected: true,
    jiraConnected: true,
    ...more
  }) as never

describe('Ash Tasks page retains code-host presentation without retired trackers', () => {
  it('mounts GitHub/GitLab dialogs but never mounts Jira/Linear dialogs or credential entry', () => {
    const html = renderToStaticMarkup(<TaskPageSurface model={model('github')} />)
    expect(html).toContain('Retained task frame')
    expect(html).toContain('GitHub issue dialog')
    expect(html).toContain('GitLab issue dialog')
    expect(html).not.toMatch(/Jira|Linear/)
  })

  it('renders GitHub and GitLab lists, not a fallback Jira list for stale retired sources', () => {
    expect(renderToStaticMarkup(<TaskPageContent model={model('github')} />)).toContain(
      'GitHub issue list'
    )
    expect(renderToStaticMarkup(<TaskPageContent model={model('gitlab')} />)).toContain(
      'GitLab issue list'
    )
    expect(renderToStaticMarkup(<TaskPageContent model={model('jira')} />)).toBe('')
    expect(renderToStaticMarkup(<TaskPageContent model={model('linear')} />)).toBe('')
  })

  it('shows code-host filters, never Jira or Linear filters even with stale connected state', () => {
    expect(renderToStaticMarkup(<TaskPageProviderFilters model={model('github')} />)).toContain(
      'GitHub filters'
    )
    expect(renderToStaticMarkup(<TaskPageProviderFilters model={model('gitlab')} />)).toContain(
      'GitLab filters'
    )
    expect(renderToStaticMarkup(<TaskPageProviderFilters model={model('jira')} />)).toBe('')
    expect(renderToStaticMarkup(<TaskPageProviderFilters model={model('linear')} />)).toBe('')
  })

  it('removes tracker scope and site selectors while keeping code-host source controls', () => {
    const sourceModel = (taskSource: string) =>
      model(taskSource, {
        visibleSourceOptions: [
          { id: 'github', label: 'GitHub', Icon: () => <span>GH</span> },
          { id: 'linear', label: 'Linear', Icon: () => <span>LIN</span> },
          { id: 'jira', label: 'Jira', Icon: () => <span>JIR</span> }
        ],
        taskSourceAvailabilityNoticeByProvider: {},
        taskSourceContextSummary: { label: 'Local project', title: 'Local project' },
        taskSourceManuallyChangedRef: { current: false },
        closeTaskPage: () => {},
        openTaskPage: () => {},
        updateSettings: async () => {},
        linearWorkspaces: [],
        linearTeamSelection: [],
        linearTeamOptions: [],
        selectedLinearWorkspaceId: null,
        selectedLinearTeamForExternalLink: null,
        jiraSites: [
          { id: 'first', displayName: 'First Jira site' },
          { id: 'second', displayName: 'Second Jira site' }
        ],
        selectedJiraSiteId: 'first'
      })
    const renderBar = (source: string) =>
      renderToStaticMarkup(
        <TooltipProvider>
          <TaskPageSourceBar model={sourceModel(source)} />
        </TooltipProvider>
      )
    expect(renderBar('github')).toContain('GitHub')
    expect(renderBar('github')).not.toContain('data-task-source="linear"')
    expect(renderBar('github')).not.toContain('data-task-source="jira"')
    expect(renderBar('linear')).not.toContain('Linear scope selector')
    expect(renderBar('jira')).not.toContain('Jira site selector')
  })

  it('offers only GitHub and GitLab in the task-source option catalog', () => {
    expect(getSourceOptions().map((source) => source.id)).toEqual(['github', 'gitlab'])
  })
})
