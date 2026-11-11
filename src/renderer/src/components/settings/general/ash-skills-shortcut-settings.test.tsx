// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { buildWorkflowSettingsSections } from '@/hooks/settings-navigation-workflow-sections'
import { isSettingsNavigationTarget } from '@/lib/settings-navigation-types'
import { getGeneralNavigationSearchEntries } from './general-search'
import { ShowSkillsShortcutSetting } from './ShowSkillsShortcutSetting'

vi.mock('../../../store/index', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

const options = {
  isMac: false,
  isWindows: false,
  isLocalWindowsHost: false,
  isWindowsTerminalHost: false,
  isWebClient: false,
  hostQueuesMessages: false,
  managedBrowserCreationEnabled: true,
  mobileEmulatorCreationEnabled: false,
  isDev: false,
  isLinearConnected: false,
  repos: []
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('excludes vendor Cloud skill sharing from Settings navigation, search, and deep links', () => {
  const sections = buildWorkflowSettingsSections(options, [])
  expect(sections.map((section) => section.id)).not.toContain('share-skills')
  expect(isSettingsNavigationTarget({ pane: 'share-skills', repoId: null })).toBe(false)
  expect(isSettingsNavigationTarget({ pane: 'general', repoId: null })).toBe(true)

  for (const path of [
    'src/renderer/src/components/settings/skills/sharing/ShareSkillsSettingsPane.tsx',
    'src/renderer/src/components/settings/skills/sharing/share-skills-settings-search.ts'
  ]) {
    expect(existsSync(resolve(process.cwd(), path))).toBe(false)
  }

  const renderer = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/components/settings/page/settings-page-renderer.tsx'),
    'utf8'
  )
  expect(renderer).not.toContain('renderShareSkillsSettingsSection')
  const shareDialog = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/components/skills/SkillShareDialog.tsx'),
    'utf8'
  )
  expect(shareDialog).not.toContain("pane: 'share-skills'")
})

it('keeps the Skills sidebar preference discoverable under General', () => {
  const matches = getGeneralNavigationSearchEntries().filter((entry) =>
    entry.title.includes('Show Skills button')
  )
  expect(matches).toHaveLength(1)
  expect(matches[0]?.description).toContain('Skills shortcut in the sidebar')
})

it('retains the working Skills sidebar visibility switch when moved into General', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onChange = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(<ShowSkillsShortcutSetting enabled={false} onChange={onChange} />)
    )
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(host.textContent).toContain('Show Skills button')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    await act(async () => toggle?.click())
    expect(onChange).toHaveBeenCalledWith(true)

    await act(async () => root.render(<ShowSkillsShortcutSetting enabled onChange={onChange} />))
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle?.click())
    expect(onChange).toHaveBeenLastCalledWith(false)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
