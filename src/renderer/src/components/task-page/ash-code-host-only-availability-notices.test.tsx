import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useTaskPageSourceSummary } from './use-task-page-source-summary'

function getNotices(taskSource: 'github' | 'gitlab' | 'jira' | 'linear') {
  let result:
    | {
        byProvider: Record<string, { label: string; title: string } | undefined>
        selected: { label: string; title: string; blocking: boolean } | null
      }
    | undefined

  function Probe(): null {
    const fixture = {
      taskSource,
      sourceOptions: [
        { id: 'github', label: 'GitHub' },
        { id: 'gitlab', label: 'GitLab' },
        { id: 'jira', label: 'Jira' },
        { id: 'linear', label: 'Linear' }
      ],
      preflightStatus: null,
      preflightStatusChecked: false,
      preflightStatusCurrent: false,
      preflightDescribesDesktop: false,
      selectedRepos: [],
      runtimePreflightStatusByHostId: new Map(),
      taskSourceRepoContexts: [],
      hostRegistryById: new Map([
        ['local', { kind: 'local', health: 'disconnected', label: 'Test offline host' }]
      ]),
      hostLabelById: new Map([['local', 'Test offline host']]),
      taskSourceHostAvailability: [{ hostId: 'local', reason: 'missing-provider-auth' }],
      accountBackedTaskSourceHostId: 'local',
      accountBackedTaskSourceHostAvailability: [
        { hostId: 'local', reason: 'missing-provider-auth' }
      ]
    }
    const model = useTaskPageSourceSummary(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture provides every field the hook reads.
      fixture as unknown as Parameters<typeof useTaskPageSourceSummary>[0]
    )
    result = {
      byProvider: model.taskSourceAvailabilityNoticeByProvider,
      selected: model.taskSourceAvailabilityNotice
    }
    return null
  }

  renderToStaticMarkup(<Probe />)
  if (!result) {
    throw new Error('Task source availability notices were not produced')
  }
  return result
}

describe('Ash Tasks availability notices are only for code hosts', () => {
  it.each(['linear', 'jira'] as const)(
    'does not generate retired %s provider warnings from a legacy offline account host',
    (source) => {
      const notices = getNotices(source)
      expect(notices.selected).toBeNull()
      expect(notices.byProvider).not.toHaveProperty('linear')
      expect(notices.byProvider).not.toHaveProperty('jira')
    }
  )

  it.each(['github', 'gitlab'] as const)(
    'preserves a blocking %s source warning for a missing provider authorization',
    (source) => {
      const notices = getNotices(source)
      expect(notices.selected).toMatchObject({ blocking: true })
      expect(notices.selected?.label).toContain(source === 'github' ? 'GitHub' : 'GitLab')
      expect(notices.byProvider).not.toHaveProperty('linear')
      expect(notices.byProvider).not.toHaveProperty('jira')
    }
  )
})
