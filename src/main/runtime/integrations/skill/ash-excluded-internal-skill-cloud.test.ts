import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const retiredPublishingModules = [
  'agent-skill-selection.ts',
  'skill-share-preparation-service.ts',
  'skill-cloud-service.ts',
  'skill-cloud-auth.ts',
  'skill-cloud-direct-upload.ts',
  'skill-cloud-request.ts',
  'skill-cloud-deadline.ts'
] as const

it('excludes orphaned vendor Cloud skill publishing, auth, and transfer implementations', () => {
  for (const file of retiredPublishingModules) {
    expect(
      existsSync(resolve(root, 'src/main/skills', file)),
      `Cloud publishing implementation reappeared: ${file}`
    ).toBe(false)
  }

  const runtime = source('src/main/runtime/integrations/skill/runtime-skill-command-surface.ts')
  expect(runtime).not.toMatch(/SkillCloudService|publishSkillPackage|SkillSharePreparationService/)
  const clientSettings = source('src/main/runtime/client/settings/runtime-client-settings.ts')
  expect(clientSettings).not.toContain('agentSkillSharingEnabled')
})

it('preserves shared skill install error handling and local bundled skills without Cloud upload entrypoints', () => {
  const errors = source('src/main/skills/skill-install-operation-error.ts')
  const runtime = source('src/main/runtime/integrations/skill/runtime-skill-command-surface.ts')
  const bundled = source('src/main/runtime/integrations/skill/runtime-bundled-skill-install.ts')

  expect(errors).toContain("from './skill-cloud-request-error'")
  expect(existsSync(resolve(root, 'src/main/skills/skill-cloud-request-error.ts'))).toBe(true)
  expect(runtime).toContain('planLocalBundledSkills(')
  expect(runtime).toContain('resolveSkillDiscoveryProviderRoots(')
  expect(runtime).not.toContain('disposeSkillUploadSessions')
  expect(bundled).toContain('resolveSkillInstallDestination')
  expect(bundled).toContain('await host.skillTransactionRecovery')
})
