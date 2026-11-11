import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  buildCapabilitySettingsSections,
  buildSetupSettingsSections
} from '../hooks/settings-navigation-capability-sections'
import { getGeneralPaneSearchEntries } from '../components/settings/general/general-search'
import { getRuntimeEnvironmentsSearchEntry } from '../components/settings/runtime-environments/catalog/runtime-environments-search'
import { isSettingsNavigationTarget } from '../lib/settings-navigation-types'
import { createUiTaskActions } from '../store/slices/ui/ui-slice-task-actions'
import type { UISliceGet, UISliceSet } from '../store/slices/ui/ui-slice-contract'

afterEach(() => {
  vi.unstubAllGlobals()
})

const settingsOptions = {
  isMac: false,
  isWindows: false,
  isLocalWindowsHost: false,
  isWindowsTerminalHost: false,
  isWebClient: false,
  hostQueuesMessages: false,
  managedBrowserCreationEnabled: true,
  mobileEmulatorCreationEnabled: true,
  isDev: false,
  isLinearConnected: false,
  repos: []
}

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

it('removes Mobile pairing from desktop Settings navigation and search', () => {
  const sections = [
    ...buildCapabilitySettingsSections(settingsOptions),
    ...buildSetupSettingsSections(settingsOptions)
  ]
  const sectionIds = sections.map((section) => section.id)
  const entries = sections.flatMap((section) => section.searchEntries)
  const entryText = entries
    .flatMap((entry) => [entry.title, entry.description, ...(entry.keywords ?? [])])
    .join(' ')
    .toLowerCase()

  expect(sectionIds).not.toContain('mobile')
  expect(sectionIds).toContain('general')
  expect(isSettingsNavigationTarget({ pane: 'mobile', repoId: null })).toBe(false)
  expect(entryText).not.toContain('show orca mobile button')
  expect(entryText).not.toContain('mobile pairing')
  expect(
    source('src/renderer/src/components/settings/page/settings-page-renderer.tsx')
  ).not.toContain('renderMobileSettingsSection')
  expect(
    source(
      'src/renderer/src/components/settings/page/settings-setup-workflow-section-renderers.tsx'
    )
  ).not.toContain('MobileSettingsPane')
})

it('removes desktop mobile-view actions while preserving safe legacy view hydration', () => {
  const set = vi.fn() as unknown as UISliceSet
  const get = vi.fn() as unknown as UISliceGet
  const actions = createUiTaskActions(set, get)
  actions.setActiveView?.('mobile')

  expect(set).toHaveBeenCalledWith({ activeView: 'terminal' })
  expect(source('src/renderer/src/store/slices/ui/ui-slice-view-actions.ts')).not.toMatch(
    /openMobilePage|closeMobilePage/
  )
  expect(source('src/renderer/src/app-shell/AppWorkspaceShell.tsx')).not.toContain('MobilePage')
})

it('does not publish the obsolete mobile bridge from Electron preload', () => {
  const preload = source('src/preload/index.ts')
  const apiTypes = source('src/preload/api-types.ts')

  expect(preload).not.toContain("from './api/mobile-bridge'")
  expect(preload).not.toMatch(/\bmobile:\s*mobileApi/)
  expect(apiTypes).toMatch(/mobile\?: MobileApi/)
  expect(apiTypes).toMatch(/settings: SettingsApi/)
  expect(apiTypes).toMatch(/pty: PtyApi/)
  expect(apiTypes).toMatch(/nativeChat: NativeChatApi/)
  expect(preload).toMatch(/settings: settingsApi/)
  expect(preload).toMatch(/pty: ptyApi/)
  expect(preload).toMatch(/nativeChat: nativeChatApi/)
})

it('does not ship dormant phone pairing pages, settings, or their bridge callers', () => {
  const archivedCallers = [
    'src/renderer/src/components/mobile/use-mobile-pairing-generation.ts',
    'src/renderer/src/components/mobile/use-mobile-page-paired-devices.ts',
    'src/renderer/src/components/mobile/paired-mobile-devices.ts',
    'src/renderer/src/components/mobile/WindowsFirewallNotice.tsx',
    'src/renderer/src/components/mobile/MobilePage.tsx',
    'src/renderer/src/components/settings/mobile/pairing/use-mobile-paired-device-revocation.ts',
    'src/renderer/src/components/settings/mobile/pairing/MobilePairingConnectionOptions.tsx',
    'src/renderer/src/components/settings/mobile/MobilePane.tsx',
    'src/renderer/src/components/settings/runtime-environments/pairing/runtime-share-computer-button.tsx',
    'src/renderer/src/components/settings/runtime-environments/pairing/RuntimePairingUrlGenerator.tsx'
  ]
  for (const path of archivedCallers) {
    expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
  }
  for (const path of [
    'src/renderer/src/components/settings/mobile/pairing',
    'src/renderer/src/components/settings/mobile/MobileSettingsPane.tsx',
    'src/renderer/src/components/sidebar/mobile-sidebar-onboarding-badge.ts',
    'src/renderer/src/lib/require-legacy-mobile-api.ts'
  ]) {
    expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
  }
  // The emulator still uses the shared iOS/Android icons; remove pairing
  // content, not reusable local-emulator presentation assets.
  const sharedMobileAssets = resolve(process.cwd(), 'src/renderer/src/components/mobile')
  expect(readdirSync(sharedMobileAssets)).toEqual(['MobileBrandIcons.tsx'])
  // The optional local emulator is a separate retained desktop capability.
  const emulatorRoot = resolve(process.cwd(), 'src/renderer/src/components/settings/mobile')
  expect(readdirSync(emulatorRoot)).toEqual(['emulator'])
  expect(existsSync(resolve(emulatorRoot, 'emulator/MobileEmulatorSettingsPane.tsx'))).toBe(true)
  expect(
    source(
      'src/renderer/src/components/settings/page/settings-interface-primary-section-renderers.tsx'
    )
  ).toContain('MobileEmulatorSettingsPane')

  const serverActions = source(
    'src/renderer/src/components/settings/runtime-environments/runtime-servers-header-actions.tsx'
  )
  const runtimeSearch = getRuntimeEnvironmentsSearchEntry()
  expect(serverActions).not.toContain('RuntimeShareComputerButton')
  expect(runtimeSearch.description?.toLowerCase() ?? '').not.toContain('share this computer')
  expect(runtimeSearch.keywords?.map((keyword) => keyword.toLowerCase())).not.toContain(
    'share this computer'
  )
  expect(getGeneralPaneSearchEntries().length).toBeGreaterThan(0)
})
