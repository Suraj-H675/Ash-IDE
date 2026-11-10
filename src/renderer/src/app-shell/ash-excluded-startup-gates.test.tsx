// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _skillFreshnessCacheForTests, useSkillFreshness } from '../hooks/useSkillFreshness'
import { runWslMoveRendererStoreRewrites } from '../lib/wsl-move-renderer-store-rewrites'
import { sanitizeHydratedActiveView } from '../store/slices/ui/ui-slice-hydration-sanitizers'

describe('Ash excluded desktop startup capabilities', () => {
  let priorApi: PropertyDescriptor | undefined
  let platform: NodeJS.Platform
  let root: Root | null
  let host: HTMLDivElement | null

  const bundledPlan = vi.fn(async () => {
    throw new Error('skills:bundledPlan should never run on local Ash')
  })
  const listPendingWslRewrites = vi.fn(async () => [])

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    priorApi = Object.getOwnPropertyDescriptor(window, 'api')
    platform = 'linux'
    root = null
    host = null
    bundledPlan.mockClear()
    listPendingWslRewrites.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        platform: { get: () => ({ platform }) },
        skills: { bundledPlan },
        wslMove: { listPendingRendererRewrites: listPendingWslRewrites }
      }
    })
    _skillFreshnessCacheForTests.reset()
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    host?.remove()
    _skillFreshnessCacheForTests.reset()
    if (priorApi) {
      Object.defineProperty(window, 'api', priorApi)
    } else {
      Reflect.deleteProperty(window, 'api')
    }
    vi.unstubAllGlobals()
  })

  it.each(['linux', 'darwin', 'win32'] as const)(
    'does not request excluded bundled-skill planning on local %s',
    async (hostPlatform) => {
      platform = hostPlatform
      let latest: ReturnType<typeof useSkillFreshness> | null = null
      const HookProbe = () => {
        latest = useSkillFreshness({ kind: 'local' })
        return null
      }
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
      await act(async () => root?.render(<HookProbe />))
      expect(bundledPlan).not.toHaveBeenCalled()
      expect(latest).toMatchObject({ loading: false, plan: null, unsupported: null, error: null })
    }
  )

  it('does not invoke WSL-move IPC on Linux/macOS, but retains Windows recovery', async () => {
    await runWslMoveRendererStoreRewrites()
    platform = 'darwin'
    await runWslMoveRendererStoreRewrites()
    expect(listPendingWslRewrites).not.toHaveBeenCalled()

    platform = 'win32'
    await runWslMoveRendererStoreRewrites()
    expect(listPendingWslRewrites).toHaveBeenCalledTimes(1)
  })

  it('does not restore removed mobile or bundled-skills pages as the active view', () => {
    expect(sanitizeHydratedActiveView('mobile')).toBe('terminal')
    expect(sanitizeHydratedActiveView('skills')).toBe('terminal')
    expect(sanitizeHydratedActiveView('settings')).toBe('settings')
    expect(sanitizeHydratedActiveView('terminal')).toBe('terminal')
  })
})
