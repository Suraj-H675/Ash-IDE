// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe } from 'vitest'
import {
  LOCAL_TARGET,
  mocks,
  PAIRED_TARGET
} from './use-structured-agent-session-options.test-fixture'
import { piOptionRefreshContract } from '../../../../main/native-chat/agent-session-wire/structured-agent-session-option-refresh.test-fixture'
import type { PiRefreshMount } from '../../../../shared/agent-session/options/structured-agent-session-option-refresh.test-fixture-contract'
import {
  forgetStructuredSessionSelection,
  registerStructuredSelectionCatalogStore
} from '@/lib/structured-agent-session-selection-controller'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/runtime-environment-revision'
import { useStructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useStructuredAgentSessionOptions } from './use-structured-agent-session-options'
import { useStructuredAgentSessionSendOptions } from './use-structured-agent-session-send-options'

describe('Pi options across the native-chat host boundary', () => {
  const hosts = new Map<string, Parameters<PiRefreshMount>[0]>()
  let restoreCatalogStore: () => void

  const forgetHost = (sessionId: string) => {
    forgetStructuredSessionSelection(sessionId)
    hosts.delete(sessionId)
  }

  beforeEach(() => {
    restoreCatalogStore = registerStructuredSelectionCatalogStore({
      read: () => ({ runtimeEnvironmentCatalogHydrated: true }),
      subscribe: () => () => {}
    })
    replaceRuntimeEnvironmentRevisions([{ id: PAIRED_TARGET.environmentId, createdAt: 1 }])
    mocks.coherentCatalog = true
    mocks.sendSelection = true
    mocks.call.mockImplementation(async (_target, method: string, params) => {
      const sessionId = params.envelope?.sessionId ?? params.sessionId
      const host = typeof sessionId === 'string' && hosts.get(sessionId)
      if (!host) {
        throw new Error(`Unexpected session for ${method}`)
      }
      if (method === 'agentSession.options') {
        return host.options()
      }
      if (method === 'agentSession.modelCatalog') {
        return host.catalog()
      }
      if (
        method === 'agentSession.setOption' &&
        params.key === 'effort' &&
        typeof params.value === 'string'
      ) {
        return { ok: true, value: await host.acceptEffort(params.value) }
      }
      throw new Error(`Unexpected RPC: ${method}`)
    })
  })

  afterEach(() => {
    cleanup()
    for (const sessionId of hosts.keys()) {
      forgetHost(sessionId)
    }
    replaceRuntimeEnvironmentRevisions([])
    restoreCatalogStore()
    mocks.call.mockReset()
    mocks.enqueue.mockClear()
    mocks.coherentCatalog = false
    mocks.sendSelection = false
  })

  const flush = async (work: () => void) => {
    await act(async () => work())
  }

  const mount: PiRefreshMount = async (host) => {
    const sessionId = host.record.sessionId
    hosts.set(sessionId, host)
    const view = renderHook(
      ({ fence, paired }: { fence: number; paired: boolean }) => {
        const target = paired ? PAIRED_TARGET : LOCAL_TARGET
        const { mutate } = useStructuredAgentSessionMutate({
          sessionId,
          target,
          stateRef: { current: { fence } }
        })
        const options = useStructuredAgentSessionOptions({
          sessionId,
          target,
          fence,
          mutate,
          agent: 'pi',
          transportEnabled: true,
          isVisible: true,
          providerVisible: true,
          turnId: null,
          unloadedTurnRevisions: undefined
        })
        return {
          ...options,
          capture: useStructuredAgentSessionSendOptions(sessionId, undefined, options.sendSource)
        }
      },
      { initialProps: { fence: 1, paired: false } }
    )
    await flush(() => {})
    return {
      snapshot: () => view.result.current.optionSnapshot,
      capture: () => view.result.current.capture().selection,
      demand: () => {
        const { demandModelCatalog } = view.result.current.optionSurface
        if (!demandModelCatalog) {
          throw new Error('Expected on-demand model catalog refresh')
        }
        demandModelCatalog()
      },
      pick: async (value) => {
        const next = await view.result.current.optionSurface.setOption('effort', value)
        return next.snapshot.some(
          (option) =>
            option.id === 'effort' &&
            option.kind.type === 'select' &&
            option.kind.currentValue === value
        )
      },
      replace: (fence, paired = false) => flush(() => view.rerender({ fence, paired })),
      close: () =>
        flush(() => {
          view.unmount()
          forgetHost(sessionId)
        })
    }
  }

  piOptionRefreshContract(mount, flush)
})
