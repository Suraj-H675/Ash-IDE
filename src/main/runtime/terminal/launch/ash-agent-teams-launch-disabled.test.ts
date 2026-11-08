import { describe, expect, it, vi } from 'vitest'
import { ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import { buildClaudeAgentTeamsLaunchPlan } from './claude-agent-teams-shim-env'

describe('Ash Claude Agent Teams mode boundaries', () => {
  it('refuses native-pane mode before writing any shim or allocating a team', async () => {
    const createTeamEnv = vi.fn(() => ({ TMUX: 'must-not-be-created' }))
    await expect(
      buildClaudeAgentTeamsLaunchPlan({
        command: 'claude',
        mode: 'native-panes-shim',
        baseEnv: { PATH: '/usr/bin' },
        createTeamEnv
      })
    ).rejects.toThrow(ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON)
    expect(createTeamEnv).not.toHaveBeenCalled()
  })

  it('retains Claude-native in-process teammates without a tmux shim', async () => {
    const createTeamEnv = vi.fn(() => ({ TMUX: 'must-not-be-created' }))
    await expect(
      buildClaudeAgentTeamsLaunchPlan({
        command: 'claude',
        mode: 'in-process',
        baseEnv: {},
        createTeamEnv
      })
    ).resolves.toEqual({
      command: 'claude --teammate-mode in-process',
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
    })
    expect(createTeamEnv).not.toHaveBeenCalled()
  })
})
