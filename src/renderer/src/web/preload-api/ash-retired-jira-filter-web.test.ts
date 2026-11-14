// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { createWebUiApi } from './web-ui-api'

it('does not expose Jira filter reads or writes through the web UI facade', () => {
  const methods = Object.keys(createWebUiApi())
  for (const name of [
    'getJiraQuickFilters',
    'setJiraQuickFilters',
    'getJiraSavedFilters',
    'mutateJiraSavedFilters'
  ]) {
    expect(methods, `${name} should not exist on the web API`).not.toContain(name)
  }
  expect(methods).toContain('get')
  expect(methods).toContain('setWithAck')
})
