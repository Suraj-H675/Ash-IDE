import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const removedCloudModules = [
  'SkillShareDialog.tsx',
  'SkillShareReviewContent.tsx',
  'SkillShareReleaseNotesField.tsx',
  'SkillSharePackageSummary.tsx',
  'SkillSharedLinksView.tsx',
  'SkillSharedLinkRow.tsx',
  'use-owned-skill-shares.ts',
  'skill-share-selection.ts',
  'skill-share-package-selection.ts'
] as const

it('keeps the orphaned Cloud skill publishing and owned-link component tree excluded', () => {
  for (const file of removedCloudModules) {
    expect(
      existsSync(resolve(root, 'src/renderer/src/components/skills', file)),
      `Removed vendor Cloud component reappeared: ${file}`
    ).toBe(false)
  }

  const page = source('src/renderer/src/components/skills/SkillsPage.tsx')
  const settings = source('src/renderer/src/components/settings/page/settings-page-renderer.tsx')
  expect(page).not.toMatch(/SkillShareDialog|SkillSharedLinksView|useOwnedSkillShares/)
  expect(settings).not.toContain('renderShareSkillsSettingsSection')
})

it('preserves provider-native discovery, local file actions, and independent skill review components', () => {
  const page = source('src/renderer/src/components/skills/SkillsPage.tsx')
  const list = source('src/renderer/src/components/skills/SkillsList.tsx')
  const row = source('src/renderer/src/components/skills/SkillRow.tsx')
  const packageChecklist = source('src/renderer/src/components/skills/SkillPackageChecklist.tsx')
  const skillBridge = source('src/preload/api/skills-bridge.ts')

  expect(page).toContain('discoverSkillsForRuntimeTarget')
  expect(page).toContain('useSkillDeleteFlow')
  expect(list).toContain('SkillDetailDialog')
  expect(row).toContain("key: 'reveal'")
  expect(row).toContain("key: 'copy-path'")
  expect(packageChecklist).toContain("from './skill-share-preview-summary'")
  expect(skillBridge).toContain("ipcRenderer.invoke('skills:discover', target)")
  expect(skillBridge).not.toContain("ipcRenderer.invoke('skills:publishShare'")
  expect(skillBridge).not.toContain("ipcRenderer.invoke('skills:listOwnedShares'")
})
