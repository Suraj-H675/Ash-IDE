import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  forgetContexts: vi.fn(),
  forgetScripts: vi.fn(),
  revokeTabs: vi.fn(),
  closePorts: vi.fn(),
  removeDnr: vi.fn()
}))

vi.mock('../api-runtime/browser-extension-api-host', () => ({
  quarantineBrowserExtensionContexts: mocks.forgetContexts
}))
vi.mock('../api-runtime/browser-extension-content-scripts', () => ({
  forgetBrowserExtensionContentScriptRestore: mocks.forgetScripts
}))
vi.mock('../permissions/browser-extension-active-tab', () => ({
  revokeBrowserExtensionActiveTabInSession: mocks.revokeTabs
}))
vi.mock('../native-messaging/browser-extension-native-ports', () => ({
  closeNativePortsWhere: mocks.closePorts
}))
vi.mock('../declarative-net-request/session/browser-extension-dnr-session', () => ({
  getDnrSessionRuntime: vi.fn(() => ({ removeExtension: mocks.removeDnr }))
}))
vi.mock('../profile-storage/browser-extension-profile-state-store', () => ({
  getBrowserExtensionProfileStateStore: () => ({
    read: () => ({ workerSignature: null }),
    update: vi.fn()
  })
}))

import { getBrowserExtensionRuntimeQuarantine } from '../api-runtime/browser-extension-runtime-quarantine'
import { removeBrowserExtensionFromSession } from './browser-extension-worker-registration'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const otherId = 'bcdefghijklmnopabcdefghijklmnopa'

function sessionWith(
  extensions: Electron.Extension[],
  remove: (byId: Map<string, Electron.Extension>, id: string) => void
): Electron.Session {
  const byId = new Map(extensions.map((extension) => [extension.id, extension]))
  const session = {
    extensions: {
      removeExtension: (id: string) => remove(byId, id),
      getExtension: (id: string) => byId.get(id) ?? null,
      getAllExtensions: () => [...byId.values()]
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fixture only implements the Electron.Session extension registry methods exercised below.
  return session as unknown as Electron.Session
}

function extensionWithId(id: string): Electron.Extension {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: removal tests read only the id from this native extension fixture.
  return { id } as Electron.Extension
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('browser extension native removal confirmation', () => {
  it('quarantines a still-present extension and leaves other session identities untouched', () => {
    const extension = extensionWithId(extensionId)
    const other = extensionWithId(otherId)
    const activeSession = sessionWith([extension, other], () => {
      throw new Error('remove failed before native unload')
    })
    const otherProfileSession = sessionWith([extensionWithId(extensionId)], () => {})

    expect(() => removeBrowserExtensionFromSession(activeSession, extensionId)).toThrow(
      /may remain active in Chromium/
    )

    expect(activeSession.extensions.getExtension(extensionId)).toBe(extension)
    expect(getBrowserExtensionRuntimeQuarantine(activeSession, extensionId)).toMatch(
      /may remain active/
    )
    expect(getBrowserExtensionRuntimeQuarantine(activeSession, otherId)).toBeNull()
    expect(getBrowserExtensionRuntimeQuarantine(otherProfileSession, extensionId)).toBeNull()
    expect(mocks.forgetContexts).toHaveBeenCalledWith(activeSession, extensionId)
    expect(mocks.forgetScripts).toHaveBeenCalledWith(activeSession, extensionId)
    expect(mocks.revokeTabs).toHaveBeenCalledWith(activeSession, extensionId)
    expect(mocks.closePorts).toHaveBeenCalledTimes(1)
    expect(mocks.removeDnr).toHaveBeenCalledWith(extensionId)
  })

  it('treats absence as success even when removeExtension throws after unloading', () => {
    const extension = extensionWithId(extensionId)
    const session = sessionWith([extension], (byId) => {
      byId.delete(extensionId)
      throw new Error('late native cleanup error')
    })

    expect(() => removeBrowserExtensionFromSession(session, extensionId)).not.toThrow()
    expect(getBrowserExtensionRuntimeQuarantine(session, extensionId)).toBeNull()
  })

  it('quarantines when removeExtension reports success but the extension remains present', () => {
    const extension = extensionWithId(extensionId)
    const session = sessionWith([extension], () => {})

    expect(() => removeBrowserExtensionFromSession(session, extensionId)).toThrow(
      /may remain active in Chromium/
    )
    expect(session.extensions.getExtension(extensionId)).toBe(extension)
    expect(getBrowserExtensionRuntimeQuarantine(session, extensionId)).not.toBeNull()
  })

  it('clears quarantine only after a later removal confirms the extension is absent', () => {
    const extension = extensionWithId(extensionId)
    let shouldFail = true
    const session = sessionWith([extension], (byId) => {
      if (shouldFail) {
        throw new Error('still loaded')
      }
      byId.delete(extensionId)
    })
    expect(() => removeBrowserExtensionFromSession(session, extensionId)).toThrow()
    expect(getBrowserExtensionRuntimeQuarantine(session, extensionId)).not.toBeNull()

    shouldFail = false
    expect(() => removeBrowserExtensionFromSession(session, extensionId)).not.toThrow()
    expect(getBrowserExtensionRuntimeQuarantine(session, extensionId)).toBeNull()
  })
})
