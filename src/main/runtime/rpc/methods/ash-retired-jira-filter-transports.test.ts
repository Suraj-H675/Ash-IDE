import { describe, expect, it, vi } from 'vitest'
import { getDefaultUIState } from '../../../../shared/constants'
import type { PersistedUIState } from '../../../../shared/persisted-ui-state-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RPC_PARAMS_BY_METHOD } from '../../../../shared/rpc-contract/rpc-params-catalog.generated'
import { RpcDispatcher } from '../dispatcher'
import { ASH_RPC_METHODS } from './index'
import { CLIENT_UI_METHODS } from './client-ui'

const retiredMethods = [
  'ui.getJiraQuickFilters',
  'ui.setJiraQuickFilters',
  'ui.getJiraSavedFilters',
  'ui.mutateJiraSavedFilters'
] as const

describe('Ash does not expose excluded Jira filter state transports', () => {
  it('omits all four methods from the broad and Ash RPC manifests', () => {
    const all = new Set<string>(CLIENT_UI_METHODS.map(({ name }) => name))
    const ash = new Set<string>(ASH_RPC_METHODS.map(({ name }) => name))
    for (const name of retiredMethods) {
      expect(all.has(name), `${name} must not be registered in the source manifest`).toBe(false)
      expect(ash.has(name), `${name} must not reach Ash runtime clients`).toBe(false)
      expect(Object.hasOwn(RPC_PARAMS_BY_METHOD, name), `${name} must not be generated`).toBe(false)
    }
    expect(ash.has('ui.get')).toBe(true)
    expect(ash.has('ui.set')).toBe(true)
  })

  it('rejects retired filter operations without changing saved Jira data', async () => {
    const savedFilter = { id: 'legacy', name: 'Old saved query', jql: 'project = OLD' }
    let state: PersistedUIState = {
      ...getDefaultUIState(),
      jiraQuickFilterState: { statuses: ['In Progress'] },
      jiraSavedFilterState: { filters: [savedFilter], activeFilterId: 'legacy' }
    }
    const updateUIState = vi.fn((patch: Partial<PersistedUIState>) => {
      state = { ...state, ...patch }
      return state
    })
    const runtime = {
      getRuntimeId: () => 'host-a',
      getUIState: () => state,
      updateUIState
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ASH_RPC_METHODS })

    for (const method of retiredMethods) {
      const response = await dispatcher.dispatch({
        id: method,
        authToken: 'token',
        method,
        params: method.includes('Saved') ? { kind: 'delete', id: 'legacy' } : { statuses: [] }
      })
      expect(response).toMatchObject({ ok: false })
    }
    expect(updateUIState).not.toHaveBeenCalled()

    const response = await dispatcher.dispatch({
      id: 'normal-ui-update',
      authToken: 'token',
      method: 'ui.set',
      params: { osc52ClipboardDefaultOnNoticePending: false }
    })
    expect(response).toMatchObject({ ok: true })
    expect(state.jiraSavedFilterState?.filters).toEqual([savedFilter])
    expect(state.jiraQuickFilterState?.statuses).toEqual(['In Progress'])
    expect(updateUIState).toHaveBeenCalledOnce()
  })
})
