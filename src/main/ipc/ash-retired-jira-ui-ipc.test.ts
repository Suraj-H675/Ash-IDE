import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  invoke: vi.fn(),
  fromId: vi.fn(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: electron,
  ipcRenderer: electron,
  webContents: { fromId: electron.fromId },
  BrowserWindow: { fromWebContents: electron.fromWebContents }
}))

import { registerUIHandlers } from './ui'
import { uiStateAndMenuCommandsApi } from '../../preload/api/ui-bridge-state-and-menu-commands'

describe('Ash desktop Jira UI endpoint retirement', () => {
  it('registers ordinary UI IPC without any legacy filter read or write handlers', () => {
    registerUIHandlers({ onUIChanged: vi.fn() } as never)
    const names = new Set(electron.handle.mock.calls.map(([name]) => name as string))
    for (const name of [
      'ui:getJiraQuickFilters',
      'ui:setJiraQuickFilters',
      'ui:getJiraSavedFilters',
      'ui:mutateJiraSavedFilters'
    ]) {
      expect(names.has(name), `${name} must not accept renderer calls`).toBe(false)
    }
    expect(names.has('ui:get')).toBe(true)
    expect(names.has('ui:set')).toBe(true)
  })

  it('does not offer excluded methods through the renderer preload facade', () => {
    const names = Object.keys(uiStateAndMenuCommandsApi)
    expect(names).not.toContain('getJiraQuickFilters')
    expect(names).not.toContain('setJiraQuickFilters')
    expect(names).not.toContain('getJiraSavedFilters')
    expect(names).not.toContain('mutateJiraSavedFilters')
    expect(names).toContain('get')
    expect(names).toContain('setWithAck')
  })
})
