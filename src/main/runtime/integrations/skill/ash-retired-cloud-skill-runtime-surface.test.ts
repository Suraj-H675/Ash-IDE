import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installRuntimeSkillCommandSurface,
  type RuntimeSkillCommandHost
} from './runtime-skill-command-contract'
import { RuntimeSkillCommands } from './runtime-skill-command-surface'

const LIVE_SKILL_METHODS = [
  'autoUpdateLocalBundledSkills',
  'executeLocalBundledSkills',
  'planLocalBundledSkills',
  'resolveSkillDiscoveryProviderRoots'
] as const

const RETIRED_CLOUD_METHODS = [
  'installSharedSkillRequest',
  'installSharedSkillBundleRequest',
  'previewSharedSkillInstallRequest',
  'previewSharedSkillBundleInstallRequest',
  'removeSharedSkillInstallRequest',
  'listManagedSkillInstalls',
  'skillInstallDestinationUsesSsh',
  'getSharedSkillInstallProgress',
  'cancelSharedSkillInstall',
  'beginSkillUpload',
  'appendSkillUploadChunk',
  'commitSkillUpload',
  'cancelSkillUpload',
  'disposeSkillUploadSessions'
] as const

function fakeHost(): RuntimeSkillCommandHost {
  return {
    getRuntimeId: () => 'disposable-runtime',
    getUserDataPath: () => '/disposable-ash-profile',
    listRepos: () => [],
    listFolderWorkspaces: () => [],
    listResolvedWorktrees: async () => [],
    showManagedWorktree: async (selector) => ({ id: selector, path: '/disposable-worktree' }),
    skillTransactionRecovery: Promise.resolve()
  }
}

describe('live local skill runtime surface', () => {
  it('binds exactly four native methods, not inherited Cloud installation or upload methods', () => {
    const commands = new RuntimeSkillCommands(fakeHost())
    // Use an actual runtime command instance as the target: before installation,
    // its four methods are inherited; binding writes only the supported own keys.
    const target = new RuntimeSkillCommands(fakeHost())
    expect(Object.keys(target)).toHaveLength(1)
    installRuntimeSkillCommandSurface(target, commands)
    expect(
      Object.keys(target)
        .filter((name) => name !== 'host')
        .sort()
    ).toEqual([...LIVE_SKILL_METHODS].sort())
    for (const name of RETIRED_CLOUD_METHODS) {
      expect(name in target, `retired Cloud method remains bound: ${name}`).toBe(false)
    }
  })

  it('does not retain the old runtime install/query class hierarchy or remove recovery code', () => {
    for (const filename of [
      'runtime-skill-install-commands.ts',
      'runtime-skill-install-queries.ts'
    ]) {
      expect(
        existsSync(resolve(process.cwd(), 'src/main/runtime/integrations/skill', filename))
      ).toBe(false)
    }
    expect(
      existsSync(resolve(process.cwd(), 'src/main/skills/skill-transaction-startup-recovery.ts'))
    ).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'src/main/skills/skill-delete/recovery.ts'))).toBe(
      true
    )
    // No deletion/migration of the historical staging on-disk state is performed here.
    expect(
      existsSync(resolve(process.cwd(), 'src/main/skills/skill-upload-staging-ownership.ts'))
    ).toBe(true)
  })
})
