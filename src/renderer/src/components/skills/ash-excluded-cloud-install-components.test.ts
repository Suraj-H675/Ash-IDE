import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')

/** Closed import subtree, excluding the live skill-display-labels.ts dependency. */
const excludedCloudInstallModules = [
  'SkillBundleInstallFlow.tsx',
  'SkillBundleInstallOutcome.tsx',
  'SkillBundleInstallReview.tsx',
  'SkillInstallAgentPicker.tsx',
  'SkillInstallDialog.tsx',
  'SkillInstallDialogFooter.tsx',
  'SkillInstallMachineSelect.tsx',
  'SkillInstallManagementDialog.tsx',
  'SkillInstallManagementDialogContent.tsx',
  'SkillInstallManagementStatus.tsx',
  'SkillInstallReviewContent.tsx',
  'SkillInstallRiskNotice.tsx',
  'SkillInstallTargetFields.tsx',
  'SkillInstallWorkspaceCombobox.tsx',
  'SkillManagedInstallRow.tsx',
  'SkillPackageChecklist.tsx',
  'skill-bundle-retry-selection.ts',
  'skill-install-management-copy.ts',
  'skill-install-progress-state.ts',
  'skill-install-provider-groups.ts',
  'skill-install-result-label.ts',
  'skill-install-workspace-choices.ts',
  'skill-managed-install-groups.ts',
  'skill-managed-install-labels.ts',
  'skill-managed-removal-summary.ts',
  'skill-package-checklist-items.ts',
  'skill-package-install-risk.ts',
  'skill-share-link.ts',
  'skill-share-preview-summary.ts',
  'skill-share-version-summary.ts',
  'skill-warning-preview-gate.ts',
  'skill-warning-preview-version.ts',
  'use-skill-install-detected-agents.ts',
  'use-skill-install-risk.ts'
] as const

it('removes the complete unmounted vendor Cloud install and managed-install renderer tree', () => {
  expect(excludedCloudInstallModules).toHaveLength(34)
  for (const file of excludedCloudInstallModules) {
    expect(
      existsSync(resolve(root, 'src/renderer/src/components/skills', file)),
      `Retired Orca Cloud install module must remain excluded: ${file}`
    ).toBe(false)
  }
  const page = source('src/renderer/src/components/skills/SkillsPage.tsx')
  expect(page).not.toMatch(/SkillInstallDialog|SkillBundleInstallFlow|SkillInstallManagementDialog/)
})

it('preserves native provider skills, runtime skill updates and non-Cloud CLI utilities', () => {
  const page = source('src/renderer/src/components/skills/SkillsPage.tsx')
  const freshness = source('src/renderer/src/components/skills/SkillFreshnessUpdateDialog.tsx')
  const labels = source('src/renderer/src/components/skills/skill-display-labels.ts')
  const cli = source('src/cli/handlers/skill-sharing.ts')

  expect(page).toContain('discoverSkillsForRuntimeTarget')
  expect(page).toContain('useSkillDeleteFlow')
  expect(freshness).toContain('useReviewedSkillPlan')
  expect(labels).toContain('sourceKindLabel')
  expect(labels).toContain('fileCountLabel')
  expect(labels).not.toContain('shareLinkCountLabel')
  expect(labels).not.toContain('installSkillsActionLabel')
  expect(cli).toContain('skill-bundle-name')
  expect(existsSync(resolve(root, 'src/renderer/src/components/skills/skill-bundle-name.ts'))).toBe(
    true
  )
})
