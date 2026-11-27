// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserExtensionSupportStatus } from '../../../../../../shared/browser/extensions/browser-extension-types'
import { BrowserExtensionsExperimentalSetting } from './BrowserExtensionsExperimentalSetting'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('../../advanced/experimental-search', () => ({
  getExperimentalSearchEntry: () => ({
    browserExtensions: {
      title: 'Browser extensions',
      description: 'Extension setting',
      keywords: []
    }
  })
}))
vi.mock('../../section-layout/SearchableSetting', () => ({
  SearchableSetting: ({ children }: { children: React.ReactNode }) => <section>{children}</section>
}))
vi.mock('../../../ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>
}))
vi.mock('../../../ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}))
vi.mock('../../form-controls/SettingsFormControls', () => ({
  SettingsSwitch: ({
    checked,
    onChange,
    ariaLabel
  }: {
    checked: boolean
    onChange: () => void
    ariaLabel?: string
  }) => (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      onClick={onChange}
    />
  )
}))

let statusListener: ((status: BrowserExtensionSupportStatus) => void) | null = null
let status: BrowserExtensionSupportStatus = { desiredEnabled: false, runtime: 'disabled' }
const retry = vi.fn<() => Promise<BrowserExtensionSupportStatus | null>>()

function stubApi(): void {
  vi.stubGlobal('api', {
    browser: {
      extensionsSupportStatus: vi.fn(async () => status),
      extensionsRetrySupportTransition: retry,
      onExtensionsSupportStatusChanged: vi.fn((listener: typeof statusListener) => {
        statusListener = listener
        return () => {
          statusListener = null
        }
      })
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  statusListener = null
  status = { desiredEnabled: false, runtime: 'disabled' }
})

describe('browser extension experimental setting recovery status', () => {
  it('shows retry while the saved preference is off and clears the warning after recovery', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    status = { desiredEnabled: false, runtime: 'unload-failed' }
    const recovered: BrowserExtensionSupportStatus = {
      desiredEnabled: false,
      runtime: 'disabled'
    }
    retry.mockResolvedValue(recovered)
    stubApi()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <BrowserExtensionsExperimentalSetting
            settings={{ experimentalBrowserExtensions: false } as never}
            updateSettings={vi.fn()}
          />
        )
        await Promise.resolve()
      })
      expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Their scripts may still run'
      )
      const retryButton = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Retry disabling'
      )
      expect(retryButton).toBeTruthy()

      await act(async () => retryButton?.click())
      expect(retry).toHaveBeenCalledOnce()
      expect(host.querySelector('[role="alert"]')).toBeNull()
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it('shows pending disable status without changing the off switch', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    status = { desiredEnabled: false, runtime: 'disabling' }
    stubApi()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <BrowserExtensionsExperimentalSetting
            settings={{ experimentalBrowserExtensions: false } as never}
            updateSettings={vi.fn()}
          />
        )
        await Promise.resolve()
      })
      expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        'Waiting for active changes and native unload to finish'
      )
      expect(host.querySelector('[role="alert"]')).toBeNull()
      expect(host.textContent).not.toContain('Retry disabling')
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it('labels retry accurately when saved intent is on but native cleanup failed', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    status = { desiredEnabled: true, runtime: 'unload-failed' }
    stubApi()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <BrowserExtensionsExperimentalSetting
            settings={{ experimentalBrowserExtensions: true } as never}
            updateSettings={vi.fn()}
          />
        )
        await Promise.resolve()
      })
      expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Their scripts may still run'
      )
      expect(host.textContent).toContain('Retry cleanup and enable')
      expect(host.textContent).toContain(
        'Optional website access requested at runtime is not supported yet'
      )
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })
})
