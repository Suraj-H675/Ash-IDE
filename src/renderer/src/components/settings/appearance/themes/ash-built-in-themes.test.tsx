// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../../shared/constants'
import {
  AppearanceThemeControl,
  AppearanceThemeSlotSelect,
  CodeEditorThemeSelect
} from './AppearanceThemeControl'

vi.mock('../../form-controls/SettingsSearchableSelect', () => ({
  SettingsSearchableSelect: ({
    ariaLabel,
    value,
    groups,
    onValueChange
  }: {
    ariaLabel: string
    value: string
    groups: readonly { key: string; options: readonly { value: string; label: string }[] }[]
    onValueChange: (value: string) => void
  }) => (
    <section aria-label={ariaLabel} data-selected={value}>
      {groups.flatMap((group) =>
        group.options.map((option) => (
          <button key={`${group.key}:${option.value}`} onClick={() => onValueChange(option.value)}>
            {option.label}
          </button>
        ))
      )}
    </section>
  )
}))

vi.mock('../../form-controls/SettingsFormControls', () => ({
  SettingsSegmentedControl: ({
    ariaLabel,
    value,
    options,
    onChange
  }: {
    ariaLabel: string
    value: string
    options: readonly { value: string; label: string }[]
    onChange: (value: 'system' | 'light' | 'dark') => void
  }) => (
    <section aria-label={ariaLabel} data-selected={value}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value as 'system' | 'light' | 'dark')}
        >
          {option.label}
        </button>
      ))}
    </section>
  )
}))

afterEach(() => vi.unstubAllGlobals())

describe('retained Ash built-in Appearance controls', () => {
  it('changes System/Dark/Light without offering plugin marketplace actions', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const settings = getDefaultSettings('/home/fixture')
    const updateSettings = vi.fn()
    const applyTheme = vi.fn()
    try {
      await act(async () =>
        root.render(
          <AppearanceThemeControl
            label="App mode"
            settings={settings}
            updateSettings={updateSettings}
            applyTheme={applyTheme}
          />
        )
      )
      expect(host.querySelector('[aria-label="App mode"]')?.getAttribute('data-selected')).toBe(
        settings.theme
      )
      expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
        'System',
        'Dark',
        'Light'
      ])
      await act(async () =>
        [...host.querySelectorAll('button')]
          .find((button) => button.textContent === 'Dark')
          ?.click()
      )
      expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
      expect(applyTheme).toHaveBeenCalledWith('dark')
      expect(host.textContent).not.toMatch(/browse themes|more themes|install/i)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('shows historical plugin IDs as fallback while keeping Match Terminal selectable', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const settings = {
      ...getDefaultSettings('/home/fixture'),
      pluginAppThemeDark: 'plugin:legacy.theme/dark' as const,
      editorThemeDark: 'plugin:legacy.theme/dark' as const
    }
    const updateSettings = vi.fn()
    try {
      await act(async () =>
        root.render(
          <>
            <AppearanceThemeSlotSelect
              base="dark"
              label="Dark app colors"
              settings={settings}
              updateSettings={updateSettings}
            />
            <CodeEditorThemeSelect
              base="dark"
              label="Dark editor colors"
              settings={settings}
              updateSettings={updateSettings}
            />
          </>
        )
      )
      expect(
        host.querySelector('[aria-label="Dark app colors"]')?.getAttribute('data-selected')
      ).toBe('built-in')
      expect(
        host.querySelector('[aria-label="Dark editor colors"]')?.getAttribute('data-selected')
      ).toBe('follow-app')
      expect(updateSettings).not.toHaveBeenCalled()
      expect(host.textContent).toContain('Match Terminal')
      expect(host.textContent).toContain('Same as app theme')
      expect(host.textContent).not.toMatch(/marketplace|more themes|install/i)
      await act(async () =>
        [...host.querySelectorAll('button')]
          .find((button) => button.textContent?.includes('Match Terminal'))
          ?.click()
      )
      expect(updateSettings).toHaveBeenCalledWith({ pluginAppThemeDark: 'match-terminal' })
      await act(async () =>
        [...host.querySelectorAll('button')]
          .find((button) => button.textContent === 'Dark')
          ?.click()
      )
      expect(updateSettings).toHaveBeenLastCalledWith({ editorThemeDark: 'dark' })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
