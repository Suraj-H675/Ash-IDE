import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppState } from '../store/types'
import { buildWorkflowSettingsSections } from '../hooks/settings-navigation-workflow-sections'
import { getGeneralPaneSearchEntries } from '../components/settings/general/general-search'
import { requireLegacyAutomationsApi } from '../lib/require-legacy-automations-api'
import { canGoForwardWorktreeHistory } from '../store/slices/worktree-nav-history'
import { WorktreeCardAutomationDetailSection } from '../components/sidebar/workspace-card/details/WorktreeCardAutomationDetailSection'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('fails closed when an archived renderer caller requests the removed desktop automation API', () => {
  vi.stubGlobal('window', { api: {} })
  expect(() => requireLegacyAutomationsApi()).toThrow(
    'Scheduled automations are not available in Ash IDE'
  )
})

it('removes scheduled automation from active desktop entry points', () => {
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
  const preload = source('src/preload/index.ts')
  const shell = source('src/renderer/src/app-shell/AppWorkspaceShell.tsx')
  const apiTypes = source('src/preload/api-types.ts')
  const generalSettings = source(
    'src/renderer/src/components/settings/general/GeneralWorkspaceSettingsSection.tsx'
  )
  const sections = buildWorkflowSettingsSections(
    {
      isMac: false,
      isWindows: false,
      isLocalWindowsHost: false,
      isWindowsTerminalHost: false,
      isWebClient: false,
      hostQueuesMessages: false,
      managedBrowserCreationEnabled: true,
      mobileEmulatorCreationEnabled: true,
      isDev: false,
      isLinearConnected: false,
      repos: []
    },
    []
  )
  const generalSearchEntries = getGeneralPaneSearchEntries()

  expect(preload).not.toContain('automations-bridge')
  expect(preload).not.toMatch(/\bautomations:\s*automationsApi/)
  expect(apiTypes).toMatch(/automations\?: AutomationsApi/)
  expect(shell).not.toContain('AutomationsPage')
  expect(generalSettings).not.toContain('skipDeleteAutomationConfirm')
  expect(sections.map((section) => section.id)).not.toContain('automations')
  expect(
    generalSearchEntries.some((entry) =>
      /automation/i.test([entry.title, entry.description, ...(entry.keywords ?? [])].join(' '))
    )
  ).toBe(false)
})

it('does not let saved back/forward history reopen the excluded page', () => {
  const state = {
    worktreeNavHistory: ['terminal', 'automations'],
    worktreeNavHistoryIndex: 0
  } as AppState
  expect(canGoForwardWorktreeHistory(state)).toBe(false)
})

it('keeps automation provenance readable without live scheduling links', () => {
  const markup = renderToStaticMarkup(
    <WorktreeCardAutomationDetailSection
      provenance={{
        kind: 'created-by-automation',
        automationId: 'retired-automation',
        automationNameSnapshot: 'Nightly review',
        automationRunId: 'historical-run',
        automationRunTitleSnapshot: 'Review the latest changes',
        createdAt: 1,
        executionTargetType: 'local',
        executionTargetId: 'repo-1',
        projectId: 'project-1'
      }}
    />
  )

  expect(markup).toContain('Nightly review')
  expect(markup).toContain('Review the latest changes')
  expect(markup).not.toContain('<button')
})
