import { ipcRenderer } from 'electron'
import type { PreflightRuntimeContext, PreloadApi, RefreshAgentsResult } from '../api-types'
import type { ZCodeInteractiveCapability } from '../../shared/zcode-missing-tui'

export const preflightApi = {
  check: (args?: {
    force?: boolean
    wakeWslDistro?: boolean
  }): Promise<{
    git: { installed: boolean }
    gh: { installed: boolean; authenticated: boolean }
    glab?: { installed: boolean; authenticated: boolean }
    bitbucket?: { configured: boolean; authenticated: boolean; account: string | null }
    azureDevOps?: {
      configured: boolean
      authenticated: boolean
      account: string | null
      baseUrl: string | null
      tokenConfigured: boolean
    }
    gitea?: {
      configured: boolean
      authenticated: boolean
      account: string | null
      baseUrl: string | null
      tokenConfigured: boolean
    }
  }> => ipcRenderer.invoke('preflight:check', args),
  detectAgents: (
    args?: PreflightRuntimeContext & { enabledOnly?: boolean; wakeWslDistro?: boolean }
  ): Promise<string[]> => ipcRenderer.invoke('preflight:detectAgents', args),
  onWslDistroRunning: (callback: (distro: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, distro: string): void => callback(distro)
    ipcRenderer.on('preflight:wslDistroRunning', listener)
    return () => ipcRenderer.removeListener('preflight:wslDistroRunning', listener)
  },
  zcodeInteractiveCapability: (): Promise<ZCodeInteractiveCapability> =>
    ipcRenderer.invoke('preflight:zcodeInteractiveCapability'),
  refreshAgents: (
    args?: PreflightRuntimeContext & { enabledOnly?: boolean; wakeWslDistro?: boolean }
  ): Promise<RefreshAgentsResult> => ipcRenderer.invoke('preflight:refreshAgents', args)
} satisfies PreloadApi['preflight']
