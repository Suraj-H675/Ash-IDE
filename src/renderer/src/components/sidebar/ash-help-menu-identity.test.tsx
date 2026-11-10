// @vitest-environment happy-dom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'

const fixture = vi.hoisted(() => ({
  openUrl: vi.fn(),
  updaterCheck: vi.fn(),
  restart: vi.fn(),
  showOnboarding: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      openModal: vi.fn(),
      openSettingsPage: vi.fn(),
      openSettingsTarget: vi.fn(),
      updateStatus: { state: 'unavailable', reason: 'source-build' }
    })
}))
vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: () => ({
    ready: false,
    coreDoneCount: 0,
    coreTotal: 0
  })
}))
vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyDetails: () => ({ keys: [] })
}))
vi.mock('@/hooks/useMountedRef', () => ({
  useMountedRef: () => ({ current: true })
}))
vi.mock('../onboarding/show-onboarding-event', () => ({
  showOnboardingFromRenderer: fixture.showOnboarding
}))
vi.mock('@/lib/app-http-link-open', () => ({
  openAppHttpLink: fixture.openUrl
}))
vi.mock('@/components/ShortcutKeyCombo', () => ({
  ShortcutKeyCombo: () => null
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    'aria-label'?: string
  }) => (
    <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="help-menu">{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled
  }: {
    children: ReactNode
    onSelect?: () => void
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  )
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('exposes only Ash-owned Help links and hides absent updater and Orca feedback routes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      updater: { check: fixture.updaterCheck },
      app: { restart: fixture.restart }
    }
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<SidebarSettingsHelpMenu />))
    const menu = host.querySelector('[data-testid="help-menu"]')!
    const text = menu.textContent ?? ''
    expect(text).toContain('Report an issue')
    expect(text).toContain('GitHub')
    expect(text).toContain('Restart Ash IDE')
    expect(text).toContain('Keyboard Shortcuts')
    expect(text).toContain('Onboarding')
    expect(text).not.toMatch(
      /Orca|Send Feedback|Check for Updates|Docs|Changelog|Discord|Follow on X/
    )
    const click = (label: string) => {
      const button = [...menu.querySelectorAll('button')].find((element) =>
        element.textContent?.includes(label)
      )
      expect(button).toBeDefined()
      act(() => button!.click())
    }
    click('GitHub')
    click('Report an issue')
    expect(fixture.openUrl).toHaveBeenNthCalledWith(1, 'https://github.com/Suraj-H675/Ash-IDE')
    expect(fixture.openUrl).toHaveBeenNthCalledWith(
      2,
      'https://github.com/Suraj-H675/Ash-IDE/issues'
    )
    expect(fixture.updaterCheck).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    host.remove()
    Reflect.deleteProperty(window, 'api')
  }
})
