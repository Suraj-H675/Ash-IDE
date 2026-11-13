// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../onboarding/IntegrationsStep', () => ({
  GitHubRow: () => <span>Retained GitHub setup</span>,
  LinearRow: () => <span>Excluded Linear API key setup</span>
}))
vi.mock('./TasksAnimatedVisual', () => ({
  TasksAnimatedVisual: () => <div>Retained Tasks preview</div>
}))
vi.mock('./WorkspacesAnimatedVisual', () => ({
  WorkspacesAnimatedVisual: () => null
}))
vi.mock('./WorkbenchAnimatedVisual', () => ({
  WorkbenchAnimatedVisual: () => null
}))
vi.mock('./EditorAnimatedVisual', () => ({
  EditorAnimatedVisual: () => null
}))
vi.mock('./BrowserAnimatedVisual', () => ({
  BrowserAnimatedVisual: () => null
}))
vi.mock('./AgentsOrchestrationVisual', () => ({
  AgentsOrchestrationVisual: () => null
}))
vi.mock('./ReviewAnimatedVisual', () => ({
  ReviewAnimatedVisual: () => null
}))
vi.mock('./OrchestrationSetupCard', () => ({
  OrchestrationSetupCard: () => null
}))
vi.mock('./BrowserUseSkillSetupCard', () => ({
  BrowserUseSkillSetupCard: () => null
}))
vi.mock('./agents-orchestration/UsageAccountsCard', () => ({
  UsageAccountsCard: () => null
}))
vi.mock('./AiCommitPrSettingsCard', () => ({
  AiCommitPrSettingsCard: () => null
}))
vi.mock('./KeepAwakeCard', () => ({
  KeepAwakeCard: () => null
}))
vi.mock('./FeatureWallPreview', () => ({
  PreviewMedia: () => <div>Retained preview</div>,
  RelatedFeatures: () => <div>Retained related workflows</div>
}))

import { FeatureWallBody } from './FeatureWallBody'
import { buildCapabilitySettingsSections } from '@/hooks/settings-navigation-capability-sections'

describe('Ash secondary onboarding and Settings exclude the inherited tracker connector', () => {
  it('keeps GitHub task setup but does not expose Linear API-key setup in the Feature Wall tour', () => {
    const html = renderToStaticMarkup(
      <FeatureWallBody
        selected={{ id: 'tasks', relatedTileIds: [] } as never}
        posterUrl={null}
        gifUrl={null}
        showGif={false}
        prefersReducedMotion={true}
        source="onboarding"
        agentsActiveStep={null}
        workbenchActiveStep={null}
        reviewActiveStep={null}
        orchestrationSkill={{} as never}
        browserUseSkill={{} as never}
        onUsageAccountStateChange={() => {}}
        settings={null}
        updateSettings={() => {}}
      />
    )
    expect(html).toContain('Retained GitHub setup')
    expect(html).toContain('Retained Tasks preview')
    expect(html).not.toContain('Excluded Linear API key setup')
  })

  it('does not show a Linear skill/credential pane for old connected profiles', () => {
    const sections = buildCapabilitySettingsSections({
      isMac: false,
      isWindows: false,
      isLocalWindowsHost: false,
      isWindowsTerminalHost: false,
      isWebClient: false,
      hostQueuesMessages: false,
      managedBrowserCreationEnabled: true,
      mobileEmulatorCreationEnabled: false,
      isDev: false,
      isLinearConnected: true,
      repos: []
    })
    const ids = sections.map((section) => section.id)
    expect(ids).toContain('agents')
    expect(ids).toContain('orchestration')
    expect(ids).toContain('computer-use')
    expect(ids).not.toContain('linear')
  })
})
