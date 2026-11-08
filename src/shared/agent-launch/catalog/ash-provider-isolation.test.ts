import { describe, expect, it } from 'vitest'
import {
  ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON,
  getTuiAgentLaunchCommand,
  TUI_AGENT_CONFIG
} from './tui-agent-config'
import {
  KNOWN_TUI_AGENT_DETECTION_COMMANDS,
  resolveDetectedTuiAgentIds
} from './tui-agent-detection-commands'
import {
  filterEnabledTuiAgents,
  isTuiAgentEnabled,
  pickTuiAgent,
  TUI_AGENT_AUTO_PICK_ORDER
} from './tui-agent-selection'
import { resolveAgentLaunchCommand } from '../startup/tui-agent-launch-command'
import { buildAgentStartupPlan } from '../startup/tui-agent-startup'
import { resolveBareAgentLaunchCommand } from '../../../main/runtime/terminal/launch/runtime-agent-launch-resolution'
import { pickSourceControlLaunchAgent } from '../../source-control/ai/source-control-launch-agent-selection'

describe('Ash local provider launch isolation', () => {
  it('does not probe or advertise Orca-backed native-pane teams even with Orca and Claude installed', () => {
    expect(KNOWN_TUI_AGENT_DETECTION_COMMANDS.some((entry) => entry.id === 'claude-agent-teams')).toBe(
      false
    )
    const installedCommands = new Set(['orca', 'orca-dev', 'orca-ide', 'ash-ide', 'claude', 'codex'])
    const installed = resolveDetectedTuiAgentIds(
      KNOWN_TUI_AGENT_DETECTION_COMMANDS,
      installedCommands,
      'linux'
    )
    expect(installed).toContain('claude')
    expect(installed).toContain('codex')
    expect(installed).not.toContain('claude-agent-teams')
  })

  it('rejects stale preferred/installed teams across quick workspace and source-control selection', () => {
    const detected = ['claude-agent-teams', 'codex', 'claude'] as const
    expect(TUI_AGENT_AUTO_PICK_ORDER).not.toContain('claude-agent-teams')
    expect(isTuiAgentEnabled('claude-agent-teams', [])).toBe(false)
    expect(filterEnabledTuiAgents(detected, [])).toEqual(['codex', 'claude'])
    expect(pickTuiAgent('claude-agent-teams', detected, [], () => true)).toBe('claude')
    expect(
      pickSourceControlLaunchAgent({
        savedAgent: 'claude-agent-teams',
        defaultAgent: 'claude-agent-teams',
        detectedAgents: [...detected],
        chosenOpensAsChat: () => true
      })
    ).toBe('claude')
  })

  it('fails closed on explicit and overridden Agent Teams launches', () => {
    const teamAgent = 'claude-agent-teams'
    const resolution = resolveAgentLaunchCommand({
      agent: teamAgent,
      cmdOverrides: { [teamAgent]: 'orca claude-teams' },
      platform: 'linux',
      shell: 'posix'
    })
    expect(resolution).toEqual({ ok: false, error: ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON })
    expect(() => getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[teamAgent], 'linux')).toThrow(
      ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON
    )
    expect(
      buildAgentStartupPlan({
        agent: teamAgent,
        prompt: 'do not launch',
        cmdOverrides: { [teamAgent]: 'orca claude-teams' },
        platform: 'linux'
      })
    ).toBeNull()
    expect(
      resolveBareAgentLaunchCommand({
        command: 'orca claude-teams',
        settings: { agentCmdOverrides: { [teamAgent]: 'orca claude-teams' } },
        platform: 'linux',
        isRemote: false
      })
    ).toBeNull()
  })

  it.each(['claude', 'codex'] as const)('retains normal %s CLI launch', (agent) => {
    const resolution = resolveAgentLaunchCommand({
      agent,
      cmdOverrides: {},
      platform: 'linux',
      shell: 'posix'
    })
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.command.startsWith(agent)).toBe(true)
      expect(resolution.command).not.toContain('orca')
    }
  })
})
