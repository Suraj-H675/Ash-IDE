import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

const retiredRemoteSkillModules = [
  'skill-cloud-grant-installation.ts',
  'skill-cloud-grant-version.ts',
  'skill-cloud-install-target.ts',
  'skill-remote-install-service.ts',
  'skill-client-mediated-transfer.ts',
  'skill-install-progress-polling.ts',
  'skill-transfer-rpc-retry.ts',
  'skill-runtime-capability.ts',
  'skill-remote-install-cancellation.ts'
] as const

it('excludes unreachable vendor Cloud skill grants and remote runtime archive transfers', () => {
  expect(retiredRemoteSkillModules).toHaveLength(9)
  for (const filename of retiredRemoteSkillModules) {
    expect(
      existsSync(resolve(process.cwd(), 'src/main/skills', filename)),
      `Retired remote skill-transfer source returned: ${filename}`
    ).toBe(false)
  }

  const rpc = source('src/main/runtime/rpc/methods/skills.ts')
  expect(rpc).not.toContain("name: 'skills.install'")
  expect(rpc).not.toContain("name: 'skills.beginUpload'")
  expect(rpc).toContain("name: 'skills.discover'")
  expect(rpc).toContain("name: 'skills.delete'")
})

it('retains the local skill transaction, download and upload shutdown dependencies', () => {
  const single = source('src/main/skills/skill-install-request-service.ts')
  const bundle = source('src/main/skills/skill-bundle-install-request-service.ts')
  const download = source('src/main/skills/skill-package-download.ts')
  const operations = source('src/main/skills/skill-operation-observability.ts')
  const errors = source('src/main/skills/skill-install-operation-error.ts')
  const startup = source('src/main/startup/main-process-observers.ts')
  const quit = source('src/main/startup/main-process-quit.ts')

  expect(single).toContain('executeSkillInstallRequest')
  expect(bundle).toContain('executeSkillBundleInstallRequest')
  expect(download).toContain("from './skill-package-download-availability'")
  expect(operations).toContain("from './skill-bundle-observability-summary'")
  expect(errors).toContain("from './skill-cloud-request-error'")
  expect(startup).toContain('recoverPendingSkillTransactions(')
  expect(quit).toContain('disposeSkillUploadSessions()')
})
