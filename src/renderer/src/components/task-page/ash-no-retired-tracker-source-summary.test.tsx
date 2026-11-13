import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useTaskPageSourceDisplay } from './use-task-page-source-display'

function getSummary(
  taskSource: 'github' | 'gitlab' | 'jira' | 'linear',
  githubMode: 'items' | 'project' = 'items'
) {
  let summary: { label: string; title: string } | undefined

  function Probe(): null {
    const fixture = {
      taskSource,
      githubMode,
      sourceOptions: [
        { id: 'github', label: 'GitHub' },
        { id: 'gitlab', label: 'GitLab' },
        { id: 'jira', label: 'Jira' },
        { id: 'linear', label: 'Linear' }
      ],
      selectedRepos: [],
      perRepoSourceState: [],
      githubSourceDisplayState: [],
      taskSourceRepoContexts: [],
      taskSourceHostAvailability: [],
      accountBackedTaskSourceHostAvailability: [],
      accountBackedTaskSourceHostId: 'local',
      hostRegistryById: new Map(),
      hostLabelById: new Map(),
      selectedLinearWorkspace: { organizationName: 'Private Linear account' },
      selectedJiraSite: { displayName: 'Private Jira site' },
      activeGithubTaskKind: 'issues'
    }
    // This hook reads only the source fields above; inherited intermediate
    // hook stages are intentionally not mounted in the isolated test.
    const model = useTaskPageSourceDisplay(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: all fields read by this hook are provided in the fixture.
      fixture as unknown as Parameters<typeof useTaskPageSourceDisplay>[0]
    )
    summary = model.taskSourceContextSummary
    return null
  }

  renderToStaticMarkup(<Probe />)
  if (!summary) {
    throw new Error('Tasks source summary hook did not render')
  }
  return summary
}

describe('Ash Tasks source summaries exclude retired provider accounts', () => {
  it.each(['linear', 'jira'] as const)(
    'does not claim an unavailable %s account when stale task state is restored',
    (provider) => {
      const summary = getSummary(provider)
      expect(summary).toEqual({
        label: 'Select a code host',
        title: 'Choose GitHub or GitLab to browse issues.'
      })
      expect(JSON.stringify(summary)).not.toMatch(/Jira|Linear|Private/)
    }
  )

  it.each(['github', 'gitlab'] as const)('preserves the retained %s source summary', (provider) => {
    const summary = getSummary(provider)
    expect(summary.label).toContain(provider === 'github' ? 'GitHub' : 'GitLab')
    expect(summary.title).not.toMatch(/Jira|Linear|Private/)
  })

  it('preserves the GitHub Projects summary as a distinct supported view', () => {
    const summary = getSummary('github', 'project')
    expect(summary.label).toContain('GitHub')
    expect(summary.title).not.toMatch(/Jira|Linear|Private/)
  })
})
