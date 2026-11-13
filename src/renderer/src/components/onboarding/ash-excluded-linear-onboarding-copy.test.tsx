// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({
      preflightStatus: { gh: { installed: true, authenticated: true } },
      preflightStatusLoading: false,
      refreshPreflightStatus: () => {}
    })
}))
vi.mock('./OnboardingInlineCommandTerminal', () => ({
  OnboardingInlineCommandTerminal: () => <div>Retained local GitHub terminal</div>
}))

import { IntegrationsStep } from './IntegrationsStep'

it('offers GitHub and retained code hosts without advertising excluded issue trackers or Orca', () => {
  const html = renderToStaticMarkup(<IntegrationsStep />)
  expect(html).toContain('GitHub')
  expect(html).toContain('GitLab')
  expect(html).toContain('Bitbucket')
  expect(html).not.toMatch(/Linear|Jira|Orca/)
})
