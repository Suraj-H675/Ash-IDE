import { describe, expect, it, vi } from 'vitest'
import {
  applyProxySettingsToSession,
  fenceProxySessionApplication,
  getProxySessionApplicationReadiness,
  retireProxySessionApplication
} from './proxy-settings'
import { hasElectronProxyCredentialsForSession } from './electron-proxy-credentials'

function fixture() {
  return {
    resolveProxy: vi.fn(async () => 'DIRECT'),
    setProxy: vi.fn(async (_config: unknown) => {}),
    closeAllConnections: vi.fn(async () => {})
  }
}

const settings = { httpProxyUrl: 'http://fixture-user:fixture-password@127.0.0.1:8888' }
const options = { env: {} }

describe('retired proxy session admission', () => {
  it('denies requests and credentials without releasing the route until explicit retirement', async () => {
    const session = fixture()
    await applyProxySettingsToSession(session, settings, options)
    expect(hasElectronProxyCredentialsForSession(session)).toBe(true)
    const fence = fenceProxySessionApplication(session)
    expect(getProxySessionApplicationReadiness(session)).toBe(false)
    expect(hasElectronProxyCredentialsForSession(session)).toBe(false)
    await fence
    expect(session.setProxy).toHaveBeenCalledTimes(1)
    await expect(applyProxySettingsToSession(session, {}, options)).rejects.toThrow('retired')
    expect(session.setProxy).toHaveBeenCalledTimes(1)
    await retireProxySessionApplication(session)
    expect(session.setProxy).toHaveBeenLastCalledWith({ mode: 'system' })
    expect(getProxySessionApplicationReadiness(session)).toBe(false)
  })

  it('prevents a queued update or a late credential publication from reopening a fenced session', async () => {
    const session = fixture()
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    session.setProxy.mockImplementationOnce(async () => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const active = applyProxySettingsToSession(session, settings, options)
    await entered
    const queued = applyProxySettingsToSession(session, {}, options)
    const rejected = expect(queued).rejects.toThrow('retired')
    const fence = fenceProxySessionApplication(session)
    expect(getProxySessionApplicationReadiness(session)).toBe(false)
    release()
    await active
    expect(hasElectronProxyCredentialsForSession(session)).toBe(false)
    await rejected
    await fence
    expect(session.setProxy).toHaveBeenCalledTimes(1)
    expect(session.closeAllConnections).toHaveBeenCalled()
    expect(getProxySessionApplicationReadiness(session)).toBe(false)
  })
})
