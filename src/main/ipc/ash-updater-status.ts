import { app, ipcMain } from 'electron'
import type { UpdateStatus } from '../../shared/update-status-types'
import { getTrustedUIRendererWebContents } from './ui'

/**
 * Ash currently has no verified packaged-update/rollback pipeline. Expose the
 * true availability and installed version without registering the inherited
 * Orca check, download, install, or release-channel handlers.
 *
 * When Ash's own updater is accepted, replace this read-only boundary with a
 * trusted, session-safe Ash release implementation.
 */
export function registerAshUpdaterReadOnlyHandlers(): void {
  ipcMain.handle('updater:getStatus', (event): UpdateStatus => {
    if (getTrustedUIRendererWebContents() !== event.sender) {
      throw new Error('Unauthorized Ash updater status sender')
    }
    return {
      state: 'unavailable',
      reason: app.isPackaged ? 'not-configured' : 'source-build'
    }
  })

  ipcMain.handle('updater:getVersion', (event): string => {
    if (getTrustedUIRendererWebContents() !== event.sender) {
      throw new Error('Unauthorized Ash updater version sender')
    }
    return app.getVersion()
  })
}
