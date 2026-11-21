import { resolve, sep } from 'node:path'
import { acquireOrcadInstanceLock, readOrcadInstanceLockRecord } from '../orcad/orcad-instance-lock'
import type { OrcadInstanceLock } from '../orcad/orcad-instance-lock'
import {
  acquireProfileStateMaintenance,
  type ProfileStateMaintenance
} from '../persistence/profile-state/profile-state-access'
import type { OfflineUpdateFence } from './offline-update-transaction-types'
import { requireLinux, requirePrivateDirectory } from './offline-update-transaction-paths'

const acquiredFences = new WeakSet<OfflineUpdateFence>()

export function acquireOfflineUpdateFence(options: {
  installRoot: string
  userDataPath: string
}): OfflineUpdateFence {
  requireLinux()
  const installRoot = requirePrivateDirectory(options.installRoot)
  const root = requirePrivateDirectory(options.userDataPath)
  if (
    installRoot === root ||
    installRoot.startsWith(`${root}${sep}`) ||
    root.startsWith(`${installRoot}${sep}`)
  ) {
    throw new Error('Offline update install and data roots must be distinct private directories')
  }
  let exclusivityLost = false
  const onExclusivityLost = (): void => {
    exclusivityLost = true
  }
  const installLock: OrcadInstanceLock = acquireOrcadInstanceLock(installRoot, {
    role: 'orcad',
    onExclusivityLost
  })
  let instanceLock: OrcadInstanceLock
  try {
    instanceLock = acquireOrcadInstanceLock(root, { role: 'orcad', onExclusivityLost })
  } catch (error) {
    installLock.release()
    throw error
  }
  let maintenance: ProfileStateMaintenance | undefined
  try {
    maintenance = acquireProfileStateMaintenance(root)
  } catch (error) {
    instanceLock.release()
    installLock.release()
    throw error
  }
  let released = false
  const fence: OfflineUpdateFence = {
    installRoot,
    userDataPath: root,
    coverage: 'ash-process-and-profile-state-only',
    assertActive(): void {
      if (
        released ||
        exclusivityLost ||
        readOrcadInstanceLockRecord(installLock.path)?.nonce !== installLock.record.nonce ||
        readOrcadInstanceLockRecord(instanceLock.path)?.nonce !== instanceLock.record.nonce
      ) {
        throw new Error('Offline update lost its Ash process maintenance owner')
      }
      maintenance?.assertActive()
    },
    release(): void {
      if (released) {
        return
      }
      released = true
      let failure: unknown
      try {
        maintenance?.release()
      } catch (error) {
        failure = error
      } finally {
        instanceLock.release()
        installLock.release()
      }
      if (failure !== undefined) {
        throw failure
      }
    }
  }
  Object.freeze(fence)
  acquiredFences.add(fence)
  return fence
}

export function assertFenceForRoots(
  fence: OfflineUpdateFence,
  installRoot: string,
  dataRoot: string
): void {
  if (!acquiredFences.has(fence)) {
    throw new Error('Offline update fence was not acquired by the Ash maintenance owner')
  }
  if (resolve(fence.installRoot) !== installRoot || resolve(fence.userDataPath) !== dataRoot) {
    throw new Error('Offline update fence does not own both transaction roots')
  }
  fence.assertActive()
}
