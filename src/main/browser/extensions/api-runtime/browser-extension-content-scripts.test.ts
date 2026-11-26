import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profileScripts: new Map<string, Record<string, unknown>[]>(),
  runNativePage: vi.fn()
}))

vi.mock('./browser-extension-context-lifetime', () => ({
  getBrowserExtensionContextSignal: () => new AbortController().signal
}))
vi.mock('./browser-extension-contexts', () => ({ getHostSessionState: () => null }))
vi.mock('./browser-extension-native-page', () => ({
  runBrowserExtensionNativePage: mocks.runNativePage
}))
vi.mock('../profile-storage/browser-extension-profile-state-store', () => ({
  getBrowserExtensionProfileStateStore: () => ({
    read: (profileId: string, extensionId: string) => ({
      contentScripts: structuredClone(mocks.profileScripts.get(`${profileId}/${extensionId}`) ?? [])
    }),
    update: (
      profileId: string,
      extensionId: string,
      change: (state: { contentScripts: Record<string, unknown>[] }) => {
        contentScripts: Record<string, unknown>[]
      }
    ) => {
      const key = `${profileId}/${extensionId}`
      const next = change({
        contentScripts: structuredClone(mocks.profileScripts.get(key) ?? [])
      })
      mocks.profileScripts.set(key, structuredClone(next.contentScripts))
      return next
    }
  })
}))

import {
  forgetBrowserExtensionContentScriptRestore,
  restoreBrowserExtensionContentScripts,
  runBrowserExtensionContentScriptMethod
} from './browser-extension-content-scripts'

type NativeScript = Record<string, unknown> & { id: string }

function createNativeChrome(
  initial: NativeScript[],
  afterRegister?: (script: NativeScript) => NativeScript
) {
  let registry = structuredClone(initial)
  let lastError: { message: string } | null = null
  const calls: { method: string; args: unknown[] }[] = []
  const runtime = {
    get lastError() {
      return lastError
    }
  }
  const scripting = {
    getRegisteredContentScripts(callback: (scripts: NativeScript[]) => void) {
      calls.push({ method: 'getRegisteredContentScripts', args: [] })
      callback(structuredClone(registry))
    },
    unregisterContentScripts(filter: { ids?: string[] }, callback: (value?: unknown) => void) {
      calls.push({ method: 'unregisterContentScripts', args: [structuredClone(filter)] })
      const ids = new Set(filter.ids ?? [])
      registry = registry.filter((script) => !ids.has(script.id))
      callback()
    },
    registerContentScripts(scripts: NativeScript[], callback: (value?: unknown) => void) {
      calls.push({ method: 'registerContentScripts', args: [structuredClone(scripts)] })
      for (const script of scripts) {
        if (registry.some((registered) => registered.id === script.id)) {
          lastError = { message: `Duplicate content script id: ${script.id}` }
          callback()
          lastError = null
          return
        }
        registry.push(structuredClone(afterRegister?.(script) ?? script))
      }
      callback()
    },
    updateContentScripts(scripts: NativeScript[], callback: (value?: unknown) => void) {
      calls.push({ method: 'updateContentScripts', args: [structuredClone(scripts)] })
      registry = registry.map((registered) =>
        scripts.find((script) => script.id === registered.id)
          ? { ...registered, ...scripts.find((script) => script.id === registered.id) }
          : registered
      )
      callback()
    }
  }
  return {
    chrome: { scripting, runtime },
    calls,
    registry: () => structuredClone(registry)
  }
}

function nativeSession(chrome: unknown): Electron.Session {
  return { chrome } as unknown as Electron.Session
}

const extension = { id: 'ecghoomjffmncchejipcgbjjcgjanbdj' } as Electron.Extension

describe('browser extension content-script restoration', () => {
  beforeEach(() => {
    mocks.profileScripts.clear()
    mocks.runNativePage.mockReset()
    mocks.runNativePage.mockImplementation(
      async (input: { code: string; session: { chrome: unknown }; signal: AbortSignal }) => {
        input.signal.throwIfAborted()
        return await runInNewContext(input.code, { chrome: input.session.chrome })
      }
    )
  })

  it('keeps an exact native registration and unrelated scripts across re-enable', async () => {
    const owned = {
      id: 'saved-script',
      matches: ['https://owned.example/*'],
      js: ['content.js'],
      persistAcrossSessions: true
    }
    const unrelated = {
      id: 'other-script',
      matches: ['https://other.example/*'],
      js: ['other.js'],
      persistAcrossSessions: false
    }
    const native = createNativeChrome([owned, unrelated])
    const session = nativeSession(native.chrome)
    mocks.profileScripts.set(`profile-a/${extension.id}`, [owned])

    await restoreBrowserExtensionContentScripts(session, 'profile-a', extension, 2_500)
    forgetBrowserExtensionContentScriptRestore(session, extension.id)
    await restoreBrowserExtensionContentScripts(session, 'profile-a', extension, 2_500)

    expect(native.registry()).toEqual([owned, unrelated])
    expect(native.calls.filter((call) => call.method === 'registerContentScripts')).toEqual([])
    expect(native.calls.filter((call) => call.method === 'unregisterContentScripts')).toEqual([])
  })

  it('replaces only a conflicting saved ID and preserves other native registrations', async () => {
    const saved = {
      id: 'saved-script',
      matches: ['https://saved.example/*'],
      js: ['saved.js'],
      persistAcrossSessions: true
    }
    const stale = {
      id: 'saved-script',
      matches: ['https://stale.example/*'],
      js: ['stale.js'],
      persistAcrossSessions: true
    }
    const unrelated = {
      id: 'other-script',
      matches: ['https://other.example/*'],
      js: ['other.js'],
      persistAcrossSessions: false
    }
    const native = createNativeChrome([stale, unrelated])
    mocks.profileScripts.set(`profile-a/${extension.id}`, [saved])

    await restoreBrowserExtensionContentScripts(
      nativeSession(native.chrome),
      'profile-a',
      extension,
      2_500
    )

    expect(native.registry()).toEqual([unrelated, saved])
    expect(native.calls.filter((call) => call.method === 'unregisterContentScripts')).toEqual([
      { method: 'unregisterContentScripts', args: [{ ids: ['saved-script'] }] }
    ])
  })

  it('keeps script restore state separate for different profiles and sessions', async () => {
    const scriptA = {
      id: 'profile-a-script',
      matches: ['https://a.example/*'],
      js: ['a.js'],
      persistAcrossSessions: true
    }
    const scriptB = {
      id: 'profile-b-script',
      matches: ['https://b.example/*'],
      js: ['b.js'],
      persistAcrossSessions: true
    }
    const nativeA = createNativeChrome([])
    const nativeB = createNativeChrome([])
    mocks.profileScripts.set(`profile-a/${extension.id}`, [scriptA])
    mocks.profileScripts.set(`profile-b/${extension.id}`, [scriptB])

    await restoreBrowserExtensionContentScripts(
      nativeSession(nativeA.chrome),
      'profile-a',
      extension,
      2_500
    )
    await restoreBrowserExtensionContentScripts(
      nativeSession(nativeB.chrome),
      'profile-b',
      extension,
      2_500
    )

    expect(nativeA.registry()).toEqual([scriptA])
    expect(nativeB.registry()).toEqual([scriptB])
  })

  it('fails and stays unavailable when native verification returns different contents', async () => {
    const saved = {
      id: 'saved-script',
      matches: ['https://saved.example/*'],
      js: ['saved.js'],
      persistAcrossSessions: true
    }
    const native = createNativeChrome([], (script) => ({
      ...script,
      matches: ['https://unexpected.example/*']
    }))
    const session = nativeSession(native.chrome)
    mocks.profileScripts.set(`profile-a/${extension.id}`, [saved])

    await expect(
      restoreBrowserExtensionContentScripts(session, 'profile-a', extension, 2_500)
    ).rejects.toThrow('Native content script restore verification failed for saved-script')
    const callsAfterFailure = native.calls.length

    await expect(
      runBrowserExtensionContentScriptMethod(
        session,
        'profile-a',
        extension,
        'getRegisteredContentScripts',
        []
      )
    ).rejects.toThrow('Native content script restore verification failed for saved-script')
    expect(native.calls).toHaveLength(callsAfterFailure)
  })
})
