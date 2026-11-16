// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDocumentDarkTheme, useSettingsDarkTheme } from './use-document-dark-theme'
import {
  clampRightSidebarPanelWidth,
  RIGHT_SIDEBAR_MIN_WIDTH
} from '../components/right-sidebar/right-sidebar-width'

const preferences = vi.hoisted(() => ({
  theme: 'light' as 'light' | 'dark' | 'system',
  systemDark: false
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ settings: { theme: preferences.theme } })
}))
vi.mock('@/components/terminal-pane/use-system-prefers-dark', () => ({
  useSystemPrefersDark: () => preferences.systemDark
}))

function ThemeView(): React.JSX.Element {
  const settingsDark = useSettingsDarkTheme()
  const documentDark = useDocumentDarkTheme()
  return (
    <div
      data-settings-dark={settingsDark ? 'yes' : 'no'}
      data-document-dark={documentDark ? 'yes' : 'no'}
    />
  )
}

async function themeOutput(): Promise<[string | null, string | null]> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ThemeView />))
    const value = host.firstElementChild
    return [
      value?.getAttribute('data-settings-dark') ?? null,
      value?.getAttribute('data-document-dark') ?? null
    ]
  } finally {
    await act(async () => root.unmount())
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Ash ignores excluded general app-plugin screenshot capture overrides', () => {
  it.each([
    ['light', false, 'no'],
    ['dark', false, 'yes'],
    ['system', true, 'yes'],
    ['system', false, 'no']
  ] as const)(
    'uses the retained %s appearance with system dark=%s',
    async (theme, systemDark, result) => {
      preferences.theme = theme
      preferences.systemDark = systemDark
      expect(await themeOutput()).toEqual([result, result])
    }
  )

  it('keeps the established persisted sidebar width clamping contract', () => {
    expect(clampRightSidebarPanelWidth(360, 1200, 40)).toBe(360)
    expect(clampRightSidebarPanelWidth(0, 1200, 40)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
    expect(clampRightSidebarPanelWidth(5000, 1200, 40)).toBeLessThan(1200)
  })

  it('does not let old screenshot capture state hide controls, override theme or size panels', () => {
    const renderer = 'src/renderer/src/'
    const source = (file: string): string =>
      readFileSync(resolve(process.cwd(), renderer, file), 'utf8')
    const shell = source('app-shell/AppWorkspaceShell.tsx')
    expect(shell).not.toMatch(/capturingPluginShot|usePluginViewCaptureStore/)
    expect(shell).toContain('floatingWorkspace.showToggleButton')
    const theme = source('hooks/use-document-dark-theme.ts')
    expect(theme).not.toMatch(/captureDark|usePluginViewCaptureStore/)
    expect(theme).toContain('resolvePaintedDark')
    expect(theme).toContain('useSystemPrefersDark')
    const sidebar = source('components/right-sidebar/index.tsx')
    expect(sidebar).not.toMatch(/captureWidth|usePluginViewCaptureStore/)
    expect(sidebar).toContain('userRightSidebarWidth')
    const app = source('App.tsx')
    expect(app).not.toMatch(/PluginShotReplayMount|plugin-shot-replay/)
    expect(app).toContain('<AppWorkspaceShell')
    expect(app).toContain('<BrowserExtensionInstallDialog')
  })

  it('removes all unregistered renderer plugin view/capture and replay machinery', () => {
    const files = [
      'src/renderer/src/store/plugin-view-capture.ts',
      'src/renderer/src/store/plugin-shot-replay.ts',
      'src/renderer/src/components/editor/plugin-editor-capture-status.ts',
      ...[
        'PluginShotReplayMount.tsx',
        'PluginShotReplaySurface.tsx',
        'plugin-view-act-test-harness.tsx',
        'plugin-view-acts.ts',
        'plugin-view-capture-acts.ts',
        'plugin-view-chrome-capture.ts',
        'plugin-view-data-acts.ts',
        'plugin-view-editor-capture.ts',
        'plugin-view-editor-shot-cleanup.ts',
        'plugin-view-editor-workspace.ts',
        'plugin-view-host-actions.ts',
        'plugin-view-panel-settle.ts',
        'plugin-view-replay.ts',
        'plugin-view-request-handler.ts',
        'plugin-view-shown.ts',
        'plugin-view-workspace-pick.ts'
      ].map((file) => `src/renderer/src/components/plugins/view/${file}`)
    ]
    for (const file of files) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
    }
  })
})
