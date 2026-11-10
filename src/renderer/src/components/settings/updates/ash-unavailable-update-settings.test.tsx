// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'

const fixture = vi.hoisted(() => ({
  reason: 'source-build' as 'source-build' | 'not-configured',
  version: vi.fn(async () => '0.0.0-ash-qa'),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn()
}))

vi.mock('../../../store/index', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ updateStatus: { state: 'unavailable', reason: fixture.reason } })
}))
vi.mock('../section-layout/SearchableSetting', () => ({
  SearchableSetting: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  )
}))
vi.mock('../form-controls/SettingsFormControls', () => ({
  SettingsSubsectionHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}))
vi.mock('../runtime-environments/updates/GeneralRemoteServerUpdates', () => ({
  GeneralRemoteServerUpdates: () => <div>Remote updater controls</div>
}))
vi.mock('./ReleaseChannelSection', () => ({
  ReleaseChannelSection: () => <div>Release channel controls</div>
}))
vi.mock('./UpdateDelaySetting', () => ({
  UpdateDelaySetting: () => <div>Update delay controls</div>
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([
  ['source-build', 'This development build cannot check for or install app updates.'],
  ['not-configured', 'Automatic updates are not configured for this Ash IDE package.']
] as const)(
  'renders honest %s updater unavailability without actionable controls',
  async (reason, copy) => {
    fixture.reason = reason
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        updater: {
          getVersion: fixture.version,
          check: fixture.check,
          download: fixture.download,
          quitAndInstall: fixture.install
        }
      }
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<GeneralUpdateSettingsSection />))
      expect(host.textContent).toContain('Ash IDE version: 0.0.0-ash-qa')
      expect(host.textContent).toContain(copy)
      expect(host.querySelectorAll('button')).toHaveLength(0)
      expect(host.textContent).not.toContain('Remote updater controls')
      expect(host.textContent).not.toContain('Update delay controls')
      expect(host.textContent).not.toContain('Release channel controls')
      expect(fixture.version).toHaveBeenCalledOnce()
      expect(fixture.check).not.toHaveBeenCalled()
      expect(fixture.download).not.toHaveBeenCalled()
      expect(fixture.install).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
      host.remove()
      Reflect.deleteProperty(window, 'api')
    }
  }
)
