import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { ThemeStep } from './ThemeStep'

function ThemeStepHarness({ initialTheme }: { initialTheme: GlobalSettings['theme'] }) {
  const [settings, setSettings] = useState<GlobalSettings>(() => ({
    ...getDefaultSettings('/Users/preview'),
    theme: initialTheme
  }))
  const [theme, setTheme] = useState(initialTheme)
  const [baseline, setBaseline] = useState<GlobalSettings | null>(settings)
  return (
    <div className="p-6">
      <ThemeStep
        theme={theme}
        onThemeChange={setTheme}
        settings={settings}
        updateSettings={async (updates) => setSettings((current) => ({ ...current, ...updates }))}
        lookBaseline={baseline}
        onLookBaselineChange={setBaseline}
      />
    </div>
  )
}

export const darkMode = defineFixture({
  width: 1036,
  render: () => <ThemeStepHarness initialTheme="dark" />
})

export const systemNarrow = defineFixture({
  width: 760,
  render: () => <ThemeStepHarness initialTheme="system" />
})

const pickLook = (id: string) => (frame: HTMLElement) => {
  frame.querySelector<HTMLElement>(`[data-theme-look="${id}"]`)?.click()
}

export const pickedPalette = defineFixture({
  width: 1036,
  interact: pickLook('terminal:Dracula'),
  render: () => <ThemeStepHarness initialTheme="dark" />
})

export const pickedPaletteLight = defineFixture({
  width: 1036,
  interact: pickLook('terminal:Catppuccin Latte'),
  render: () => <ThemeStepHarness initialTheme="light" />
})
