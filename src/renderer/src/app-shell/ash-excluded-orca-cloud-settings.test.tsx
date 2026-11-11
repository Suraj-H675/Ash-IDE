// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import {
  buildCapabilitySettingsSections,
  buildSetupSettingsSections
} from '../hooks/settings-navigation-capability-sections'
import { isSettingsNavigationTarget } from '../lib/settings-navigation-types'
import { DevToolsPane } from '../components/settings/advanced/DevToolsPane'
import { ArtifactsPageUnavailableState } from '../components/artifacts/ArtifactsPageStates'
import { useAppStore } from '../store/index'
import type {
  OrcaProfileAuthStatus,
  OrcaProfileSummary,
  TransferOrcaProfileProjectArgs,
  TransferOrcaProfileProjectResult
} from '../../../shared/orca-profiles'

const toastEffects = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn()
}))

vi.mock('sonner', () => ({ toast: toastEffects }))

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

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('removes Orca cloud account Settings navigation and deep links while retaining provider accounts', () => {
  const sections = [
    ...buildCapabilitySettingsSections(settingsOptions),
    ...buildSetupSettingsSections(settingsOptions)
  ]
  const sectionIds = sections.map((section) => section.id)
  const accountSection = sections.find((section) => section.id === 'accounts')

  expect(sectionIds).not.toContain('orca-account')
  expect(accountSection?.title).toBe('AI Provider Accounts')
  expect(isSettingsNavigationTarget({ pane: 'orca-account', repoId: null })).toBe(false)
  expect(isSettingsNavigationTarget({ pane: 'accounts', repoId: null })).toBe(true)
  expect(isSettingsNavigationTarget({ pane: 'git', repoId: null })).toBe(true)
  expect(
    source('src/renderer/src/components/settings/page/settings-page-renderer.tsx')
  ).not.toMatch(/renderOrcaAccountSettingsSection/)
  expect(
    existsSync(
      resolve(
        process.cwd(),
        'src/renderer/src/components/settings/accounts/orca/OrcaAccountSettingsPane.tsx'
      )
    )
  ).toBe(false)
  expect(
    existsSync(
      resolve(
        process.cwd(),
        'src/renderer/src/components/settings/accounts/orca/orca-account-settings-search.ts'
      )
    )
  ).toBe(false)
  expect(
    existsSync(
      resolve(
        process.cwd(),
        'src/renderer/src/components/orca-profiles/OrcaProfileSignOutConfirmDialog.tsx'
      )
    )
  ).toBe(false)
})

it('keeps developer toast diagnostics active without the Orca Cloud login preview', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DevToolsPane />))
    expect(host.textContent).not.toMatch(/Orca Cloud|Connect profile|Sign in to Orca/)
    const infoToast = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Info toast')
    )
    expect(infoToast).toBeDefined()
    act(() => infoToast?.click())
    expect(toast.info).toHaveBeenCalledOnce()
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('shows cloud artifact sharing as unavailable without sign-in or Settings actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ArtifactsPageUnavailableState />))
    expect(host.textContent).toContain('Cloud artifact sharing is unavailable in Ash IDE.')
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.textContent).not.toMatch(/Sign in|Orca account|Open account settings/i)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('keeps local profile create, switch, and project-transfer behavior available', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const profile: OrcaProfileSummary = {
    id: 'local-work',
    name: 'Work',
    avatar: { kind: 'initials', initials: 'W', color: 'neutral' },
    kind: 'local',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1
  }
  const created = { activeProfileId: profile.id, profiles: [profile], profile }
  const authStatus: OrcaProfileAuthStatus = {
    activeProfileId: profile.id,
    configured: false,
    state: 'local',
    persistence: 'none'
  }
  const transferArgs: TransferOrcaProfileProjectArgs = {
    sourceProfileId: 'local-first',
    targetProfileId: profile.id,
    repoId: 'repo-1',
    mode: 'move'
  }
  const transferResult: TransferOrcaProfileProjectResult = {
    status: 'transferred',
    mode: 'move',
    sourceProfileId: transferArgs.sourceProfileId,
    targetProfileId: transferArgs.targetProfileId,
    sourceRepoId: transferArgs.repoId,
    targetRepoId: transferArgs.repoId,
    targetProjectId: 'project-1'
  }
  const profileApi = {
    createLocal: vi.fn(async () => created),
    authStatus: vi.fn(async () => authStatus),
    switchProfile: vi.fn(async () => ({ status: 'relaunching' as const })),
    transferProject: vi.fn(async () => transferResult)
  }
  const previousApi = window.api
  const previousStore = useAppStore.getState()
  Object.defineProperty(window, 'api', { configurable: true, value: { orcaProfiles: profileApi } })

  try {
    await expect(useAppStore.getState().createLocalOrcaProfile('Work')).resolves.toEqual(profile)
    expect(profileApi.createLocal).toHaveBeenCalledWith({ name: 'Work' })
    expect(useAppStore.getState().activeOrcaProfileId).toBe(profile.id)
    await expect(useAppStore.getState().switchOrcaProfile('local-next')).resolves.toEqual({
      status: 'relaunching'
    })
    expect(profileApi.switchProfile).toHaveBeenCalledWith({ profileId: 'local-next' })
    await expect(useAppStore.getState().transferOrcaProfileProject(transferArgs)).resolves.toEqual(
      transferResult
    )
    expect(profileApi.transferProject).toHaveBeenCalledWith(transferArgs)
  } finally {
    useAppStore.setState(previousStore, true)
    if (previousApi) {
      Object.defineProperty(window, 'api', { configurable: true, value: previousApi })
    } else {
      Reflect.deleteProperty(window, 'api')
    }
  }
})
