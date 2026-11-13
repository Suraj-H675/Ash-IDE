// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/integrations/source-control/cli-source-control-integration-cards', () => ({
  GitHubIntegrationCard: () => <span>GitHub review provider</span>,
  GitLabIntegrationCard: () => <span>GitLab review provider</span>
}))
vi.mock('@/components/integrations/source-control/token-source-control-integration-cards', () => ({
  AzureDevOpsIntegrationCard: () => <span>Azure DevOps review provider</span>,
  GiteaIntegrationCard: () => <span>Gitea review provider</span>
}))
vi.mock('@/components/integrations/source-control/bitbucket-integration-card', () => ({
  BitbucketIntegrationCard: () => <span>Bitbucket review provider</span>
}))
vi.mock('@/components/integrations/presentation/integration-card-presentation', () => ({
  IntegrationCardGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  IntegrationCardPresentationProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('@/hooks/use-integration-provider-status-refresh', () => ({
  useIntegrationProviderStatusRefresh: () => {}
}))
vi.mock('./use-integration-connection-status', () => ({
  useIntegrationConnectionStatus: () => ({
    reviewConnected: true,
    reviewProviderName: 'GitHub',
    codeHostTaskProviderName: 'GitHub',
    trackerProviderName: null,
    taskSourceNames: ['GitHub'],
    trackerChecking: false
  }),
  deriveIntegrationFlowState: () => ({ review: 'done', task: 'done' })
}))
vi.mock('./connect-integration-step', () => ({
  IntegrationStep: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('@/store/index', () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({
      settings: {
        visibleTaskProviders: ['github', 'gitlab', 'linear', 'jira'],
        defaultTaskSource: 'linear'
      },
      openSettingsPage: () => {},
      openSettingsTarget: () => {},
      checkJiraConnection: () => {},
      refreshPreflightStatus: () => {}
    })
}))
vi.mock('../settings/tasks/use-task-source-provider-readiness', () => ({
  useTaskSourceProviderReadiness: () => ({
    github: { connected: true, checking: false, visible: true },
    gitlab: { connected: true, checking: false, visible: true },
    linear: { connected: true, checking: false, visible: true },
    jira: { connected: true, checking: false, visible: true }
  })
}))
vi.mock('../settings/tasks/TaskSourceProviderCard', () => ({
  TaskSourceProviderCard: ({ name, children }: { name: string; children: React.ReactNode }) => (
    <div>
      {name}: {children}
    </div>
  )
}))
vi.mock('../settings/tasks/TaskSourceSimpleSetup', () => ({
  CodeHostSetupSteps: () => <span>Code-host issue setup</span>
}))
vi.mock('../settings/section-layout/SearchableSetting', () => ({
  SearchableSetting: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('../settings/form-controls/SettingsFormControls', () => ({
  SettingsSubsectionHeader: () => <div>Task setup</div>
}))

import { IntegrationsPane } from '../settings/integrations/IntegrationsPane'
import { TasksPane } from '../settings/tasks/TasksPane'
import { ConnectIntegrationsList } from './ConnectIntegrationsList'

describe('Ash setup and integrations exclude external issue-tracker credential entry', () => {
  it('offers source-control integrations but no Jira or Linear credential cards in Settings', () => {
    const html = renderToStaticMarkup(<IntegrationsPane />)
    expect(html).toContain('GitHub review provider')
    expect(html).toContain('GitLab review provider')
    expect(html).not.toContain('Linear credential entry')
    expect(html).not.toContain('Jira credential entry')
    expect(html).not.toMatch(/Orca|Jira|Linear/)
  })

  it('offers retained code-host tasks without Jira or Linear credential cards during setup', () => {
    const html = renderToStaticMarkup(<ConnectIntegrationsList />)
    expect(html).toContain('GitHub review provider')
    expect(html).toContain('GitLab review provider')
    expect(html).not.toContain('Linear credential entry')
    expect(html).not.toContain('Jira credential entry')
    expect(html).not.toMatch(/Orca|Jira|Linear/)
  })

  it('ignores old tracker preferences in Tasks Settings and offers only code-host setup', () => {
    const settings = {
      visibleTaskProviders: ['github', 'gitlab', 'linear', 'jira'],
      defaultTaskSource: 'linear'
    }
    const html = renderToStaticMarkup(
      <TasksPane settings={settings as never} updateSettings={() => {}} />
    )
    expect(html).toContain('GitHub')
    expect(html).toContain('GitLab')
    expect(html).toContain('Code-host issue setup')
    expect(html).not.toContain('Jira issue setup')
    expect(html).not.toContain('Linear agent-skill setup')
    expect(html).not.toMatch(/Orca|Jira|Linear/)
  })
})
