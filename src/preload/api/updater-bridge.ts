import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

const FEED_UNAVAILABLE = 'Automatic Ash IDE updates are unavailable.'

function unavailable(): Promise<never> {
  return Promise.reject(new Error(FEED_UNAVAILABLE))
}

export const updaterApi = {
  getStatus: () => ipcRenderer.invoke('updater:getStatus'),
  getVersion: () => ipcRenderer.invoke('updater:getVersion'),
  check: unavailable,
  download: unavailable,
  dismissNudge: unavailable,
  dismissAvailableUpdate: unavailable,
  getLinuxPackageInstallInstructions: unavailable,
  showLinuxPackage: unavailable,
  listBuilds: async (channel) => ({
    ok: false,
    channel,
    message: FEED_UNAVAILABLE
  }),
  quitAndInstall: unavailable,
  onStatus: () => () => {},
  onClearDismissal: () => () => {}
} satisfies PreloadApi['updater']
