import { describe, expect, it } from 'vitest'
import { getDefaultUIState } from '../../../../shared/constants'
import {
  normalizeJiraSavedFilterState,
  mutateJiraSavedFilterState
} from '../../../../shared/jira/jira-saved-filters'
import { normalizeJiraQuickFilterState } from '../../../../shared/jira/jira-quick-filters'

const archivedFilter = { id: 'legacy', name: 'My work', jql: 'assignee = currentUser()' }

describe('historical Jira filter data remains readable without a connector', () => {
  it('normalizes stored filters and old task resume data without changing either', () => {
    const persisted = {
      ...getDefaultUIState(),
      taskResumeState: { jiraQuery: 'project = OLD' },
      jiraSavedFilterState: { filters: [archivedFilter], activeFilterId: archivedFilter.id },
      jiraQuickFilterState: { statuses: ['In Progress'] }
    }

    expect(normalizeJiraSavedFilterState(persisted.jiraSavedFilterState)).toEqual({
      filters: [archivedFilter],
      activeFilterId: 'legacy'
    })
    expect(normalizeJiraQuickFilterState(persisted.jiraQuickFilterState)).toEqual({
      statuses: ['In Progress']
    })
    expect(persisted.taskResumeState).toEqual({ jiraQuery: 'project = OLD' })
  })

  it('keeps the pure legacy state normalization independent of IPC or provider accounts', () => {
    const previous = { filters: [archivedFilter], activeFilterId: archivedFilter.id }
    const next = mutateJiraSavedFilterState(previous, { kind: 'delete', id: archivedFilter.id })
    expect(next).toEqual({ filters: [], activeFilterId: null })
    expect(previous).toEqual({ filters: [archivedFilter], activeFilterId: archivedFilter.id })
  })
})
