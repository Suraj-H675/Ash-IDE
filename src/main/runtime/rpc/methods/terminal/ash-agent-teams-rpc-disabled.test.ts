import { describe, expect, it, vi } from 'vitest'
import { ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON } from '../../../../../shared/agent-launch/catalog/tui-agent-config'
import { buildRegistry, type RpcContext } from '../../core'
import { TERMINAL_LIFECYCLE_METHODS } from './terminal-lifecycle-methods'

describe('Ash authenticated runtime Agent Teams RPC boundary', () => {
  it.each(['agentTeams.prepareLaunch', 'agentTeams.tmuxCompat'])(
    'blocks %s before touching the inherited Orca service',
    async (name) => {
      const registry = buildRegistry(TERMINAL_LIFECYCLE_METHODS)
      const handler = registry.get(name)
      expect(handler).toBeDefined()
      if (!handler || 'stream' in handler) {
        throw new Error('Expected a unary runtime method')
      }
      const prepare = vi.fn()
      const tmux = vi.fn()
      const context = {
        runtime: { prepareClaudeAgentTeamsLeader: prepare, handleAgentTeamsTmuxCompat: tmux }
        // The registry handler refuses before reading the runtime; only the two
        // side-effect-capable methods need to be represented in this fixture.
      } as unknown as RpcContext
      await expect(handler.handler({}, context)).rejects.toThrow(
        ASH_NATIVE_AGENT_TEAMS_UNAVAILABLE_REASON
      )
      expect(prepare).not.toHaveBeenCalled()
      expect(tmux).not.toHaveBeenCalled()
    }
  )
})
