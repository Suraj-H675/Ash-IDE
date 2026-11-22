// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'
import { UpdatePreflightDiagnostic } from './UpdatePreflightDiagnostic'

const fixture = vi.hoisted(() => ({
  reason: 'source-build' as 'source-build' | 'not-configured',
  pendingObserved: false,
  nativeProviderObserved: 0,
  version: vi.fn(async () => '0.0.0-ash-qa'),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  preflight: vi.fn(async () => ({
    decision: 'busy' as const,
    candidateIdentity: {
      state: 'unavailable' as const,
      source: 'no-candidate' as const,
      reason: 'no-staged-candidate' as const
    },
    runtime: {
      observedAtMs: 1,
      hostOwnership: {
        state: 'unknown' as const,
        reason: 'exclusive-host-ownership-unavailable' as const
      },
      daemonGenerations: {
        state: 'unknown' as const,
        reason: 'inventory-partial' as const,
        lowerBound: 1
      },
      windows: { state: 'known' as const, count: 0 },
      ptys: {
        state: 'unknown' as const,
        reason: 'inventory-partial' as const,
        lowerBound: 1
      },
      ptyOwnedAgentSessions: {
        state: 'unknown' as const,
        reason: 'inventory-partial' as const,
        lowerBound: 1
      },
      providerAgentSessions: {
        state: 'unknown' as const,
        reason: 'provider-agent-inventory-unavailable' as const,
        ...(fixture.nativeProviderObserved > 0
          ? { lowerBound: fixture.nativeProviderObserved }
          : {})
      },
      pendingDiskWrites: {
        state: 'unknown' as const,
        reason: 'pending-write-census-unavailable' as const,
        lowerBound: fixture.pendingObserved ? 1 : 0
      }
    },
    blockers: [
      'candidate-not-provided',
      'pty-active',
      'agent-session-active',
      'provider-agent-inventory-unknown',
      ...(fixture.nativeProviderObserved > 0 ? (['provider-agent-session-observed'] as const) : []),
      'pending-disk-writes-unknown',
      ...(fixture.pendingObserved ? (['pending-disk-writes-observed'] as const) : [])
    ] as const,
    activationAvailable: false as const
  }))
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
  fixture.pendingObserved = false
  fixture.nativeProviderObserved = 0
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([
  ['source-build', 'This development build cannot check for or install app updates.'],
  ['not-configured', 'Automatic updates are not configured for this Ash IDE package.']
] as const)(
  'renders honest %s updater unavailability with a read-only preflight action',
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
          quitAndInstall: fixture.install,
          getPreflight: fixture.preflight
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
      const diagnosticButton = Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Inspect local update blockers')
      )
      expect(host.querySelectorAll('button')).toHaveLength(1)
      expect(diagnosticButton).toBeDefined()
      expect(host.textContent).not.toContain('Remote updater controls')
      expect(host.textContent).not.toContain('Update delay controls')
      expect(host.textContent).not.toContain('Release channel controls')
      expect(fixture.version).toHaveBeenCalledOnce()
      expect(fixture.check).not.toHaveBeenCalled()
      expect(fixture.download).not.toHaveBeenCalled()
      expect(fixture.install).not.toHaveBeenCalled()
      expect(fixture.preflight).not.toHaveBeenCalled()

      await act(async () => {
        diagnosticButton?.click()
      })
      expect(fixture.preflight).toHaveBeenCalledOnce()
      expect(host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain(
        'Local update safety inspection complete. Admission: busy.'
      )
      expect(host.textContent).toContain('Admission: busy')
      expect(host.textContent).toContain(
        'No staged candidate was supplied; no release package was inspected.'
      )
      expect(host.textContent).toContain('Ash cannot see every provider-native agent session.')
      expect(host.textContent).toContain('Ash cannot prove that writes are drained.')
      expect(host.textContent).toContain('Unknown; The provider agent inventory is unavailable.')
      expect(host.textContent).toContain('Unknown; local Store activity not observed.')
      expect(host.textContent).toContain(
        'A PTY was observed during this check. Confirm it has ended in Manage Sessions; closing its window does not stop it.'
      )
      expect(host.textContent).toContain(
        'A PTY was observed with an agent owner during this check. Stop it with its provider, then confirm the PTY ended in Manage Sessions.'
      )
      expect(host.textContent).toContain(
        'At least 1 observed; The daemon inventory was incomplete or changed during this check.'
      )
      expect(host.textContent).toContain('Activation is unavailable.')
      expect(host.textContent).toContain('Snapshot observed')
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

it('shows observed local write activity without implying host-wide write safety', async () => {
  fixture.pendingObserved = true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { updater: { getPreflight: fixture.preflight } }
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<UpdatePreflightDiagnostic />))
    const inspect = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Inspect local update blockers')
    )
    expect(inspect).toBeDefined()
    await act(async () => inspect?.click())
    expect(host.textContent).toContain('Admission: busy')
    expect(host.textContent).toContain(
      'Local persistence activity observed; host-wide write status unknown.'
    )
    expect(host.textContent).toContain(
      'Local profile persistence activity or a pending save was observed.'
    )
    expect(host.textContent).toContain('Ash cannot prove that writes are drained.')
    expect(host.textContent).toContain('Activation is unavailable.')
  } finally {
    act(() => root.unmount())
    host.remove()
    Reflect.deleteProperty(window, 'api')
  }
})

it('shows locally observed native Chat provider children without claiming a complete inventory', async () => {
  fixture.nativeProviderObserved = 2
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { updater: { getPreflight: fixture.preflight } }
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<UpdatePreflightDiagnostic />))
    const inspect = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Inspect local update blockers')
    )
    await act(async () => inspect?.click())
    expect(host.textContent).toContain(
      'At least 2 observed; The provider agent inventory is unavailable.'
    )
    expect(host.textContent).toContain(
      'A native Chat provider child owned by this process was observed.'
    )
    expect(host.textContent).toContain('Ash cannot see every provider-native agent session.')
    expect(host.textContent).toContain('Activation is unavailable.')
  } finally {
    act(() => root.unmount())
    host.remove()
    Reflect.deleteProperty(window, 'api')
  }
})
