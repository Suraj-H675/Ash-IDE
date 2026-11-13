// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { getSmartWorkspaceNameModes } from './smart-workspace-localized-options'
import { useSmartWorkspaceFieldAvailability } from './use-smart-workspace-field-availability'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('advertises code hosts and branches but no retired Jira or Linear composer modes', () => {
  expect(getSmartWorkspaceNameModes().map(({ id }) => id)).toEqual([
    'smart',
    'github',
    'gitlab',
    'branches',
    'text'
  ])
})

it.each(['jira', 'linear'] as const)(
  'replaces a previously selected %s composer mode without rechecking retired providers',
  async (storedMode) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const setMode = vi.fn()
    const setDebouncedQuery = vi.fn()
    const refreshPreflightStatus = vi.fn(async () => {})
    const snapshots: ReturnType<typeof useSmartWorkspaceFieldAvailability>[] = []

    function Probe(): null {
      snapshots.push(
        useSmartWorkspaceFieldAvailability({
          props: {
            value: '',
            disabled: false,
            textOnly: false,
            repoBackedSourcesDisabled: false,
            branchesEnabled: true,
            typedTextEnabled: true
          } as never,
          state: { mode: storedMode, setMode, setDebouncedQuery } as never,
          repoBackedSearchTargets: [{ gitlabSourceContext: { hostId: 'local' } }],
          preflightStatus: { glab: { installed: true } },
          preflightStatusChecked: true,
          preflightStatusContextKey: 'current',
          expectedPreflightContextKey: 'current',
          refreshPreflightStatus
        })
      )
      return null
    }

    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
      await act(async () => root.render(<Probe />))
      expect(snapshots.at(-1)?.mode).toBe('smart')
      expect(snapshots.at(-1)?.availableModes.map((entry) => entry.id)).toEqual([
        'smart',
        'github',
        'gitlab',
        'branches',
        'text'
      ])
      expect(setMode).toHaveBeenCalledOnce()
      expect(setMode).toHaveBeenCalledWith('smart')
      expect(refreshPreflightStatus).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
)
