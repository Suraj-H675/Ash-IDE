// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SkillsPageHeader } from './SkillsPageHeader'
import { SkillsEmptyState } from './skills-page-states'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('unmounts vendor Cloud skill publishing, install, and shared-links flows without removing native discovery', () => {
  const page = source('src/renderer/src/components/skills/SkillsPage.tsx')
  const list = source('src/renderer/src/components/skills/SkillsList.tsx')
  const row = source('src/renderer/src/components/skills/SkillRow.tsx')
  const detail = source('src/renderer/src/components/skills/SkillDetailDialog.tsx')
  const toolbar = source('src/renderer/src/components/skills/SkillsFilterToolbar.tsx')
  const rendererBoot = source('src/renderer/src/main.tsx')
  const sidebarBridge = source('src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts')

  for (const excluded of [
    'SkillShareDialog',
    'SkillInstallDialog',
    'SkillInstallManagementDialog',
    'SkillSharedLinksView',
    'useOwnedSkillShares',
    'pendingSkillShareId',
    'pendingSkillsSharedView',
    'app.orca.dev/skills/share'
  ]) {
    expect(page, excluded).not.toContain(excluded)
  }
  expect(toolbar).not.toContain('Shared links')
  expect(row).not.toContain("key: 'share'")
  expect(detail).not.toContain('onShare')
  expect(list).not.toContain('isSkillShareEligible')
  expect(rendererBoot).not.toContain('SkillWarningPreviewLauncher')
  expect(sidebarBridge).not.toContain('onOpenSkillShare')
  expect(sidebarBridge).not.toContain('consumePendingSkillShare')
  expect(
    existsSync(resolve(process.cwd(), 'src/renderer/src/components/skills/skills-page-view.ts'))
  ).toBe(false)

  expect(page).toContain('discoverSkillsForRuntimeTarget')
  expect(page).toContain('useSkillDeleteFlow')
  expect(list).toContain('SkillDetailDialog')
  expect(row).toContain("key: 'reveal'")
  expect(row).toContain("key: 'copy-path'")
  expect(row).toContain("key: 'delete'")
})

it('renders an actionable Delete skills control without vendor Cloud actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onClose = vi.fn()
  const onDelete = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <SkillsPageHeader
            skillCount={3}
            sourceEntries={[]}
            scannedSourceCount={0}
            hostLabel={null}
            onClose={onClose}
            deleteSupported
            deleteUnsupportedReason={null}
            onStartDelete={onDelete}
          />
        </TooltipProvider>
      )
    )
    expect(host.textContent).toContain('3 skills')
    expect(host.textContent).toContain('Delete skills')
    expect(host.textContent).not.toMatch(
      /Share skills|Install from link|Manage installs|Shared links/
    )
    const deleteButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Delete skills')
    )
    await act(async () => deleteButton?.click())
    expect(onDelete).toHaveBeenCalledOnce()
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('provides a truthful no-skills state and a working refresh action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onRefresh = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<SkillsEmptyState onRefresh={onRefresh} />))
    expect(host.textContent).toContain("Add a skill in your agent's skills folder")
    expect(host.textContent).not.toContain('Install from link')
    const refresh = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Refresh')
    )
    await act(async () => refresh?.click())
    expect(onRefresh).toHaveBeenCalledOnce()
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
