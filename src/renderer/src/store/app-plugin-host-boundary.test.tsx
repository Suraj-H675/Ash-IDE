// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { MATCH_TERMINAL_APP_THEME } from '../../../shared/plugin-theme-settings'
import { ThemeLookCarousel } from '../components/onboarding/ThemeLookCarousel'
import { buildThemeLooks } from '../components/onboarding/onboarding-theme-looks'
import { themeLookSettingsUpdate } from '../components/onboarding/onboarding-theme-look-settings'
import type { ColorProbe } from '../lib/app-theme-colors'
import { findCodeEditorTheme, resolveCodeEditorTheme } from '../lib/code-editor-theme'
import { applyAppTheme, readCachedAppTheme } from '../lib/document-theme'
import { synthesizeTerminalAppTheme } from '../lib/terminal-app-theme'

it('renders built-in and terminal previews and keeps keyboard navigation local', () => {
  const settings = getDefaultSettings('/fixture')
  const looks = buildThemeLooks({
    base: 'dark',
    baseline: settings,
    labels: { orca: 'Ash', builtIn: () => 'Built-in dark', community: 'Terminal palette' }
  })
  const pick = vi.fn()
  const readPluginApi = vi.fn()
  vi.stubGlobal('api', {
    get plugins() {
      return readPluginApi()
    }
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    act(() =>
      root.render(
        <ThemeLookCarousel
          looks={looks}
          selectedId={looks[0].id}
          onPick={pick}
          ariaLabel="Theme looks"
          header={null}
        />
      )
    )
    expect(host.textContent).not.toMatch(/browse plugins/i)
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-theme-look]')
    expect(buttons.length).toBeGreaterThan(2)
    buttons[0].focus()
    act(() =>
      buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    )
    expect(document.activeElement).toBe(buttons[1])
    act(() => buttons[1].click())
    expect(pick).toHaveBeenCalledWith(looks[1])
    expect(themeLookSettingsUpdate(looks[1], settings, settings)).toMatchObject({
      pluginAppThemeDark: MATCH_TERMINAL_APP_THEME,
      terminalThemeDark: 'Catppuccin Mocha'
    })
    expect(readPluginApi).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

it('uses Match Terminal for Monaco and built-in editor choices without reading a saved plugin theme', () => {
  // Happy DOM has no OffscreenCanvas. The fixture uses hex and the normalized rgb() background.
  const probe: ColorProbe = (value) => {
    const rgb = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(value)
    if (rgb) {
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), 1]
    }
    if (!/^#[a-f0-9]{6}$/i.test(value)) {
      return null
    }
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
      1
    ]
  }
  const settings = {
    ...getDefaultSettings('/fixture'),
    theme: 'dark' as const,
    terminalThemeDark: 'Catppuccin Mocha'
  }
  const oldCache = JSON.stringify({
    id: 'plugin:demo.theme/dark',
    base: 'dark',
    revision: '1',
    tokens: { '--background': '#ff0000' }
  })
  const cacheKey = 'orca.pluginAppTheme.lastApplied'
  const testRoot = document.createElement('div')
  localStorage.setItem(cacheKey, oldCache)
  try {
    expect(readCachedAppTheme()).toBeNull()
    const theme = synthesizeTerminalAppTheme(settings, true, probe)
    expect(theme).toMatchObject({ id: MATCH_TERMINAL_APP_THEME, base: 'dark' })
    const painted = applyAppTheme(theme, { root: testRoot, builtIns: () => ({}), probe })
    expect(testRoot.style.getPropertyValue('--background')).toBe('#1e1e2e')
    const editor = {
      dark: true,
      appTheme: theme,
      appPainted: painted,
      readDocument: (token: string) => testRoot.style.getPropertyValue(token),
      probe
    }
    expect(
      resolveCodeEditorTheme({
        ...editor,
        selected: findCodeEditorTheme('plugin:demo.theme/dark')
      }).monaco?.data.base
    ).toBe('vs-dark')
    expect(resolveCodeEditorTheme({ ...editor, selected: 'light' })).toMatchObject({
      monaco: null,
      override: { base: 'light' }
    })
    expect(readCachedAppTheme()?.id).toBe(MATCH_TERMINAL_APP_THEME)
    applyAppTheme(null, { root: testRoot })
    expect(testRoot.style.getPropertyValue('--background')).toBe('')
    expect(localStorage.getItem(cacheKey)).toBe(oldCache)
  } finally {
    localStorage.removeItem(cacheKey)
    localStorage.removeItem('ash.matchTerminal.lastApplied')
  }
})
