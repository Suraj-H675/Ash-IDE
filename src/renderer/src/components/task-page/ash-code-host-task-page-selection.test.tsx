import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useTaskPageRepoSelection } from './use-task-page-repo-selection'

type Snapshot = {
  visible: string[]
  defaultSource: string
  pickerOptions: string[]
}

function captureTaskSources(
  options: {
    visibleTaskProviders: string[]
    defaultTaskSource: string
    gitlabInstalled: boolean
    onSettingsUpdate?: (updates: unknown) => void
  },
  onRender?: (result: ReturnType<typeof useTaskPageRepoSelection>) => void
): Snapshot {
  let snapshot: Snapshot | null = null
  function Probe(): null {
    const result = useTaskPageRepoSelection({
      settings: {
        visibleTaskProviders: options.visibleTaskProviders,
        defaultTaskSource: options.defaultTaskSource
      },
      pageData: { preselectedRepoId: null },
      repos: [],
      updateSettings: async (updates: unknown) => {
        options.onSettingsUpdate?.(updates)
      },
      linearStatus: { connected: true, workspaces: [] },
      jiraStatus: { connected: true, sites: [] },
      preflightStatus: { glab: { installed: options.gitlabInstalled } },
      preflightStatusCurrent: true,
      linearConnected: true
    } as never)
    snapshot = {
      visible: result.visibleTaskProviders,
      defaultSource: result.defaultTaskSource,
      pickerOptions: result.visibleSourceOptions.map((option) => option.id)
    }
    onRender?.(result)
    return null
  }
  renderToStaticMarkup(<Probe />)
  if (snapshot === null) {
    throw new Error('TaskPage source selector did not render')
  }
  return snapshot
}

describe('Ash task page excludes Jira and Linear while retaining code-host issues', () => {
  it('ignores old Jira/Linear-only preferences without rewriting the stored settings', () => {
    expect(
      captureTaskSources({
        visibleTaskProviders: ['jira', 'linear'],
        defaultTaskSource: 'linear',
        gitlabInstalled: true
      })
    ).toEqual({ visible: ['github'], defaultSource: 'github', pickerOptions: ['github'] })
  })

  it('retains GitLab issue browsing and repairs a stale Jira default', () => {
    expect(
      captureTaskSources({
        visibleTaskProviders: ['gitlab', 'linear', 'jira'],
        defaultTaskSource: 'jira',
        gitlabInstalled: true
      })
    ).toEqual({ visible: ['gitlab'], defaultSource: 'gitlab', pickerOptions: ['gitlab'] })
  })

  it('does not expose an unavailable GitLab CLI or inherited Jira fallback', () => {
    expect(
      captureTaskSources({
        visibleTaskProviders: ['gitlab', 'jira'],
        defaultTaskSource: 'gitlab',
        gitlabInstalled: false
      })
    ).toEqual({ visible: ['github'], defaultSource: 'gitlab', pickerOptions: ['github'] })
  })

  it('refuses excluded source actions and saves only code-host providers when explicitly hiding one', () => {
    const writes: unknown[] = []
    const handler: {
      hideSource: ReturnType<typeof useTaskPageRepoSelection>['hideTaskSource'] | null
    } = { hideSource: null }
    captureTaskSources(
      {
        visibleTaskProviders: ['github', 'gitlab', 'jira', 'linear'],
        defaultTaskSource: 'linear',
        gitlabInstalled: true,
        onSettingsUpdate: (updates) => writes.push(updates)
      },
      (result) => {
        handler.hideSource = result.hideTaskSource
      }
    )
    if (handler.hideSource === null) {
      throw new Error('No task-source action captured')
    }
    // A removed integration cannot write into existing Ash preferences through this view.
    handler.hideSource('jira', 'Jira')
    handler.hideSource('linear', 'Linear')
    expect(writes).toEqual([])
    handler.hideSource('gitlab', 'GitLab')
    expect(writes).toEqual([{ visibleTaskProviders: ['github'], defaultTaskSource: 'github' }])
  })
})
