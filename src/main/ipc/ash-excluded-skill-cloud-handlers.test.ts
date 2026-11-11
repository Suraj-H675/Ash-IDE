import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const retiredSkillCloudModules = [
  'src/main/ipc/skill-cloud-ipc-handlers.ts',
  'src/main/ipc/skill-install-management-ipc-handlers.ts',
  'src/main/ipc/skill-install-progress-ipc.ts',
  'src/main/ipc/skill-cloud-install-ipc-schemas.ts',
  'src/main/ipc/skill-share-publishing-ipc-schemas.ts'
] as const

const source = (file: string): string => readFileSync(resolve(process.cwd(), file), 'utf8')

it('does not ship the dormant Orca Cloud skill sharing and managed install IPC handlers', () => {
  for (const file of retiredSkillCloudModules) {
    expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
  }

  const skills = source('src/main/ipc/skills.ts')
  expect(skills).not.toContain('registerSkillsHandlers')
  expect(skills).not.toContain('registerSkillCloudIpcHandlers')

  const startup = source('src/main/startup/main-process-ready-runtime.ts')
  expect(startup).toContain('registerProviderNativeSkillDiscoveryHandler(store, runtime)')
  expect(startup).toContain('registerSkillDeleteIpcHandlers(store, runtime)')
  expect(startup).not.toContain('registerSkillsHandlers(')
})

it('preserves provider-native skills discovery and passive WSL protections', () => {
  const skills = source('src/main/ipc/skills.ts')
  expect(skills).toContain("'skills:discover'")
  expect(skills).toContain('discoverSkillsOnTarget')
  expect(skills).toContain('resolveSkillDiscoveryProviderRoots')
  expect(skills).toContain('unavailableWhileWslDistroStopped')
  expect(skills).toContain('refuseStoppedWslDistro: true')

  const deleteHandlers = source('src/main/ipc/skill-delete/handlers.ts')
  expect(deleteHandlers).toContain("'skills:previewDelete'")
  expect(deleteHandlers).toContain("'skills:delete'")
  expect(deleteHandlers).toContain('SkillDeleteRequestSchema.parse(value)')
  expect(deleteHandlers).toContain('handleMainWindowSkillIpc(')
})
