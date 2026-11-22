import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  observedHostedBrowserBackend,
  registerHostedBrowserBackendProbe
} from './orcad-browser-backend-positive-evidence'

let release = () => {}
afterEach(() => release())

describe('positive-only host browser backend observation', () => {
  it('reports an available backend without any browser navigation or work', () => {
    const spy = vi.fn(() => true)
    release = registerHostedBrowserBackendProbe(spy)
    expect(observedHostedBrowserBackend()).toBe(1)
    expect(spy).toHaveBeenCalledOnce()
    release()
    expect(observedHostedBrowserBackend()).toBe(0)
  })

  it('does not treat an absent, false, or failing probe as a complete browser inventory', () => {
    release = registerHostedBrowserBackendProbe(() => false)
    expect(observedHostedBrowserBackend()).toBe(0)
    release()
    release = registerHostedBrowserBackendProbe(() => {
      throw new Error('backend status unavailable')
    })
    expect(observedHostedBrowserBackend()).toBe(0)
  })

  it('cannot remove a successor observation through the earlier provider cleanup', () => {
    const retireFirst = registerHostedBrowserBackendProbe(() => true)
    const retireSecond = registerHostedBrowserBackendProbe(() => true)
    release = retireSecond
    retireFirst()
    expect(observedHostedBrowserBackend()).toBe(1)
    retireSecond()
    expect(observedHostedBrowserBackend()).toBe(0)
  })
})
