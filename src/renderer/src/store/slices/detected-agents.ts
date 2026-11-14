import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { createLocalDetectedAgentState } from './local-detected-agent-state'
import type { LocalDetectedAgentState } from './local-detected-agent-store-state'

export type DetectedAgentsSlice = LocalDetectedAgentState & {
  // Historical SSH inventory contract, retained for compatibility with saved UI state.
  remoteAgentInventoryOutcome: (key: string) => 'pending' | 'successful' | 'failed'
  remoteDetectedAgentIds: Record<string, TuiAgent[] | null>
  isDetectingRemoteAgents: Record<string, boolean>
  ensureRemoteDetectedAgents: (
    connectionId: string,
    options?: { force?: boolean }
  ) => Promise<TuiAgent[]>
  /** Legacy call now fails closed; Ash does not run remote-development probes. */
  refreshRemoteDetectedAgents: (connectionId: string) => Promise<TuiAgent[]>
  clearRemoteDetectedAgents: (connectionId: string) => void
}

// Keep historical SSH inventory state readable, but never probe a managed remote host.
const latestOutcome = new Map<string, 'pending' | 'successful' | 'failed'>()

export const createDetectedAgentsSlice: StateCreator<AppState, [], [], DetectedAgentsSlice> = (
  set,
  get,
  store
) => ({
  ...createLocalDetectedAgentState(set, get, store),
  remoteAgentInventoryOutcome: (key) => latestOutcome.get(key) ?? 'pending',
  remoteDetectedAgentIds: {},
  isDetectingRemoteAgents: {},

  ensureRemoteDetectedAgents: (connectionId: string) => {
    latestOutcome.set(connectionId, 'failed')
    return Promise.resolve([])
  },

  refreshRemoteDetectedAgents: (connectionId: string) => {
    latestOutcome.set(connectionId, 'failed')
    return Promise.resolve([])
  },

  // Discard old in-memory SSH inventory without deleting saved user repositories.
  clearRemoteDetectedAgents: (connectionId: string) => {
    latestOutcome.delete(connectionId)
    set((s) => {
      const { [connectionId]: _, ...restAgents } = s.remoteDetectedAgentIds
      const { [connectionId]: __, ...restLoading } = s.isDetectingRemoteAgents
      return { remoteDetectedAgentIds: restAgents, isDetectingRemoteAgents: restLoading }
    })
  }
})
