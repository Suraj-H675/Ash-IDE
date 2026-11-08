import { describe, expect, it } from 'vitest'
import { resolveQuickWorkspaceAgentSelection } from './quick-workspace-agent-selection'

describe('Ash saved quick-agent preferences', () => {
  it('does not surface a retired native-pane preference as a usable agent', () => {
    expect(
      resolveQuickWorkspaceAgentSelection({
        quickAgentOverride: undefined,
        preferredQuickAgent: 'claude-agent-teams',
        detectedAgentIds: ['claude-agent-teams', 'codex']
      }).quickAgent
    ).toBeNull()
    expect(
      resolveQuickWorkspaceAgentSelection({
        quickAgentOverride: 'claude-agent-teams',
        preferredQuickAgent: 'codex',
        detectedAgentIds: ['claude-agent-teams', 'codex']
      }).quickAgent
    ).toBe('codex')
  })
})
