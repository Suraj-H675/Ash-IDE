// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PrivacyPane } from './PrivacyPane'
import { PrivacyDiagnosticBundleControls } from './PrivacyDiagnosticBundleControls'

vi.mock('./PrivacyDiagnosticsSection', () => ({
  PrivacyDiagnosticsSection: () => <div>Local diagnostics controls</div>
}))
vi.mock('../../ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}))

afterEach(() => vi.unstubAllGlobals())

it('replaces telemetry opt-in and inherited support sharing with local-only privacy information', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<PrivacyPane settings={{} as never} />))
    expect(host.textContent).toContain('Local-first privacy')
    expect(host.textContent).toContain('does not transmit product analytics')
    expect(host.textContent).toContain('Local diagnostics controls')
    expect(host.textContent).not.toMatch(/Share anonymous usage data|Orca|Upload to support/)
    expect(host.querySelectorAll('button')).toHaveLength(0)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('offers only local create/review/discard controls for diagnostic bundles', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const actions = {
    collect: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    discard: vi.fn(async () => {})
  }
  const base = {
    status: { localFileEnabled: true, bundleEnabled: true } as never,
    collecting: false,
    openingPreview: false,
    discarding: false,
    onCollect: actions.collect,
    onOpenPreview: actions.open,
    onDiscard: actions.discard
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<PrivacyDiagnosticBundleControls {...base} bundle={null} />))
    expect(host.textContent).toContain('Create local diagnostic file')
    act(() => host.querySelector('button')!.click())
    expect(actions.collect).toHaveBeenCalledOnce()

    await act(async () =>
      root.render(
        <PrivacyDiagnosticBundleControls
          {...base}
          bundle={{ bundleSubmissionId: 'private', bytes: 128, spanCount: 1 }}
        />
      )
    )
    expect([...host.querySelectorAll('button')].map((x) => x.textContent)).toEqual([
      'Open local review file',
      'Discard'
    ])
    expect(host.textContent).not.toMatch(/Send|Upload|support|Delete sent/)
    act(() => host.querySelectorAll('button')[0].click())
    act(() => host.querySelectorAll('button')[1].click())
    expect(actions.open).toHaveBeenCalledOnce()
    expect(actions.discard).toHaveBeenCalledOnce()
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
