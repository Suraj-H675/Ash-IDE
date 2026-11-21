import { expect, it, vi } from 'vitest'
import { updaterApi } from './updater-bridge'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(async (channel: string) => channel)
}))

vi.mock('electron', () => ({ ipcRenderer: ipc }))

it('sends only read-only Ash updater IPC and rejects compatibility calls without restart side effects', async () => {
  await updaterApi.getStatus()
  await updaterApi.getVersion()
  await updaterApi.getPreflight()
  for (const call of [
    updaterApi.check,
    updaterApi.download,
    updaterApi.quitAndInstall,
    updaterApi.dismissNudge,
    updaterApi.dismissAvailableUpdate,
    updaterApi.getLinuxPackageInstallInstructions,
    updaterApi.showLinuxPackage
  ]) {
    await expect(call()).rejects.toThrow('Automatic Ash IDE updates are unavailable.')
  }
  await expect(updaterApi.listBuilds('stable')).resolves.toMatchObject({
    ok: false,
    channel: 'stable',
    message: 'Automatic Ash IDE updates are unavailable.'
  })
  expect(ipc.invoke.mock.calls).toEqual([
    ['updater:getStatus'],
    ['updater:getVersion'],
    ['updater:getPreflight']
  ])
})
