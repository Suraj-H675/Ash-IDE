// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASH_APP_PLUGIN_HOST_ENABLED } from './app-plugin-host-boundary'
import { ensurePluginAutoUpdatesWatched } from './plugin-auto-updates'
import { usePluginIconThemeStore, usePluginIconThemes } from './plugin-icon-themes'
import { usePluginLanguagePackStore, usePluginLanguagePacks } from './plugin-language-packs'
import { ensurePluginPanelsLoaded, usePluginPanels, usePluginPanelsStore } from './plugin-panels'
import { usePluginStatusBarItems } from './plugin-status-bar-items'
import {
  usePluginTerminalThemeStore,
  usePluginTerminalThemes,
  usePluginThemeStore,
  usePluginThemes
} from './plugin-themes'

describe('Ash application plugin host exclusion', () => {
  const forbiddenMethods = [
    'list',
    'listThemes',
    'listTerminalThemes',
    'listLanguagePacks',
    'listIconThemes',
    'getAutoUpdateState',
    'takeUpdateReviewNotices',
    'statusBarState'
  ] as const
  const requests = Object.fromEntries(
    forbiddenMethods.map((name) => [
      name,
      vi.fn(async () => {
        throw new Error(`unexpected app-plugin IPC: ${name}`)
      })
    ])
  )
  const onChanged = vi.fn(() => () => {})
  const onAutoUpdateChanged = vi.fn(() => () => {})
  const onStatusBarChanged = vi.fn(() => () => {})
  let priorApi: PropertyDescriptor | undefined
  let host: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    priorApi = Object.getOwnPropertyDescriptor(window, 'api')
    host = null
    root = null
    for (const method of Object.values(requests)) {
      method.mockClear()
    }
    onChanged.mockClear()
    onAutoUpdateChanged.mockClear()
    onStatusBarChanged.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        plugins: { ...requests, onChanged, onAutoUpdateChanged, onStatusBarChanged }
      }
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    host?.remove()
    if (priorApi) {
      Object.defineProperty(window, 'api', priorApi)
    } else {
      Reflect.deleteProperty(window, 'api')
    }
    vi.unstubAllGlobals()
  })

  it('mounts actual catalog, panel and status hooks with empty ready stores and no IPC', async () => {
    expect(ASH_APP_PLUGIN_HOST_ENABLED).toBe(false)
    let rendered: unknown[] = []
    const StartupProbe = () => {
      rendered = [
        usePluginThemes(),
        usePluginTerminalThemes(),
        usePluginLanguagePacks(),
        usePluginIconThemes(),
        usePluginPanels(),
        usePluginStatusBarItems()
      ]
      return null
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root?.render(<StartupProbe />))

    expect(rendered).toEqual([[], [], [], [], [], []])
    for (const state of [
      usePluginThemeStore.getState(),
      usePluginTerminalThemeStore.getState(),
      usePluginLanguagePackStore.getState(),
      usePluginIconThemeStore.getState()
    ]) {
      expect(state).toMatchObject({ loaded: true, entries: [] })
    }
    expect(usePluginPanelsStore.getState()).toMatchObject({
      fetchStatus: 'ready',
      plugins: [],
      panelErrors: {}
    })
    // Direct retry requests must obey the same exclusion as automatic mounts.
    await act(async () => {
      await Promise.all([
        usePluginThemeStore.getState().fetchEntries(),
        usePluginTerminalThemeStore.getState().fetchEntries(),
        usePluginLanguagePackStore.getState().fetchEntries(),
        usePluginIconThemeStore.getState().fetchEntries(),
        usePluginPanelsStore.getState().fetchPlugins()
      ])
      ensurePluginPanelsLoaded()
      ensurePluginAutoUpdatesWatched()
    })
    for (const [name, request] of Object.entries(requests)) {
      expect(request, name).not.toHaveBeenCalled()
    }
    expect(onChanged).not.toHaveBeenCalled()
    expect(onAutoUpdateChanged).not.toHaveBeenCalled()
    expect(onStatusBarChanged).not.toHaveBeenCalled()
  })
})
