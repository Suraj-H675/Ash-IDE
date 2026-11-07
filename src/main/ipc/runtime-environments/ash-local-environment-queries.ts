import { ipcMain } from 'electron'

/**
 * Ash is a single-machine IDE. Some retained local workspace views still read
 * the legacy host catalog, but no remote pairing/host-control channels should
 * be registered. An empty catalog is the correct state for this product.
 */
export function registerAshLocalEnvironmentQueries(): void {
  ipcMain.handle('runtimeEnvironments:list', () => [])
  ipcMain.handle('runtimeEnvironments:desktopCreatedChatIds', () => [])
  ipcMain.handle('runtimeEnvironments:getStatusSnapshots', () => [])
}
