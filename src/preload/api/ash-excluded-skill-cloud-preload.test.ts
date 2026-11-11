import { beforeEach, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({ ipcRenderer: ipc }))

import { skillsApi } from './skills-bridge'

const excludedCloudMethods = [
  'prepareShare',
  'publishShare',
  'cancelShare',
  'releaseShare',
  'resolveShare',
  'installShare',
  'installBundleShare',
  'installBundlePackageVersion',
  'installPackageVersion',
  'cancelInstall',
  'previewInstall',
  'previewBundleInstall',
  'removeInstall',
  'listManagedInstalls',
  'getPackage',
  'listOwnedShares',
  'revokeShare',
  'deletePackage',
  'listWslDistros'
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

it('rejects every legacy vendor Cloud operation before it reaches desktop IPC', async () => {
  for (const method of excludedCloudMethods) {
    const result = skillsApi[method]()
    await expect(result, method).rejects.toThrow(
      'Orca Cloud skill sharing and managed installs are unavailable in Ash IDE.'
    )
  }
  expect(ipc.invoke).not.toHaveBeenCalled()
  expect(ipc.on).not.toHaveBeenCalled()
})

it('keeps provider-native discovery and skill-deletion IPC boundaries', async () => {
  ipc.invoke.mockResolvedValue({ skills: [], sources: [], scannedAt: 0 })
  await skillsApi.discover({ refresh: true })
  expect(ipc.invoke).toHaveBeenCalledWith('skills:discover', { refresh: true })

  expect(await skillsApi.deleteSupported()).toBe(true)
  expect(ipc.invoke).toHaveBeenCalledTimes(1)

  const request: Parameters<typeof skillsApi.previewDelete>[0] = {
    operationId: 'ash-preload-test',
    skills: []
  }
  await skillsApi.previewDelete(request)
  await skillsApi.delete(request)
  expect(ipc.invoke).toHaveBeenCalledWith('skills:previewDelete', request)
  expect(ipc.invoke).toHaveBeenCalledWith('skills:delete', request)
})

it('does not subscribe to retired vendor Cloud upload or install progress channels', () => {
  const stopShare = skillsApi.onShareProgress()
  const stopInstall = skillsApi.onInstallProgress()
  expect(stopShare).toBeTypeOf('function')
  expect(stopInstall).toBeTypeOf('function')
  stopShare()
  stopInstall()
  expect(ipc.on).not.toHaveBeenCalled()
})
