import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import type * as CodexFsUtils from '../../../codex-accounts/fs-utils'

// Bypass platform-specific socket paths so asserted config bytes stay host-independent.
vi.mock('../shared-server/codex-daemon-socket-path-guard', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyCodexDaemonSocketGuard: (config: string) => config
}))

const { homedirMock, promotionTestState } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>(),
  promotionTestState: {
    failAtomicWrite: false,
    failRevocationWrite: false,
    allowNativeSettingsWrite: false,
    atomicWritePaths: [] as string[]
  }
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof Os>()
  return {
    ...actual,
    homedir: homedirMock
  }
})

vi.mock('../../../codex-accounts/fs-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof CodexFsUtils>()
  return {
    ...actual,
    writeFileAtomically: (...args: Parameters<typeof actual.writeFileAtomically>) => {
      promotionTestState.atomicWritePaths.push(args[0])
      if (promotionTestState.failAtomicWrite) {
        throw new Error('injected atomic write failure')
      }
      return actual.writeFileAtomically(...args)
    },
    writeFileAtomicallyIfUnchanged: (
      ...args: Parameters<typeof actual.writeFileAtomicallyIfUnchanged>
    ) => {
      if (promotionTestState.failRevocationWrite) {
        return false
      }
      return actual.writeFileAtomicallyIfUnchanged(...args)
    }
  }
})

vi.mock('../../../agent-hooks/ash-hook-ownership-policy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  canAshWriteProviderGlobalSettings: () => promotionTestState.allowNativeSettingsWrite
}))

import { syncSystemConfigIntoManagedCodexHome } from './codex-config-mirror'
import { getCodexConfigSyncStatus } from './config-sync-stall'
import { promoteCodexRuntimeSettingsToSystem } from './config-settings-promotion'

let tmpHome: string
let userDataDir: string
let previousUserDataPath: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'orca-codex-settings-home-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-codex-settings-user-data-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = userDataDir
  homedirMock.mockReturnValue(tmpHome)
  promotionTestState.failAtomicWrite = false
  promotionTestState.failRevocationWrite = false
  promotionTestState.allowNativeSettingsWrite = false
  promotionTestState.atomicWritePaths.length = 0
  if (homedir() !== tmpHome) {
    throw new Error('node:os homedir mock is not active; refusing to touch the real ~/.codex')
  }
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  vi.clearAllMocks()
})

function systemConfigPath(): string {
  return join(tmpHome, '.codex', 'config.toml')
}

function runtimeHomeDir(): string {
  return join(userDataDir, 'codex-runtime-home', 'home')
}

function runtimeConfigPath(): string {
  return join(runtimeHomeDir(), 'config.toml')
}

function baselinePath(): string {
  return join(runtimeHomeDir(), '.orca-config-settings-baseline.json')
}

function writeSystemConfig(content: string): void {
  mkdirSync(join(tmpHome, '.codex'), { recursive: true })
  writeFileSync(systemConfigPath(), content, 'utf-8')
}

function readSystemConfig(): string {
  return readFileSync(systemConfigPath(), 'utf-8')
}

function readRuntimeConfig(): string {
  return readFileSync(runtimeConfigPath(), 'utf-8')
}

function simulateCodexSettingWrite(key: string, rawValue: string): void {
  mkdirSync(runtimeHomeDir(), { recursive: true })
  const existing = existsSync(runtimeConfigPath()) ? readFileSync(runtimeConfigPath(), 'utf-8') : ''
  const linePattern = new RegExp(`^${key}[ \\t]*=.*$`, 'm')
  const rendered = `${key} = ${rawValue}`
  const next = linePattern.test(existing)
    ? existing.replace(linePattern, rendered)
    : `${rendered}\n${existing}`
  writeFileSync(runtimeConfigPath(), next, 'utf-8')
}

describe('codex settings write-back promotion', () => {
  it('refuses a direct exported write-back call when provider settings ownership is unavailable', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    expect(readRuntimeConfig()).toContain('model = "gpt-5"')
    simulateCodexSettingWrite('model', '"o4"')

    const result = promoteCodexRuntimeSettingsToSystem({
      runtimeHomePath: runtimeHomeDir(),
      systemHomePath: join(tmpHome, '.codex')
    })

    expect(result).toMatchObject({ writeBackState: 'refused' })
    expect(readSystemConfig()).toBe('model = "gpt-5"\n')
    expect(readRuntimeConfig()).toContain('model = "o4"')
  })

  it('keeps pending scalar edits and reports degraded sync when write-back is refused', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    const baselineBeforeEdit = readFileSync(baselinePath(), 'utf-8')
    simulateCodexSettingWrite('model', '"o4"')

    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe('model = "gpt-5"\n')
    expect(readRuntimeConfig()).toContain('model = "o4"')
    expect(readFileSync(baselinePath(), 'utf-8')).toBe(baselineBeforeEdit)
    expect(getCodexConfigSyncStatus()).toMatchObject({
      state: 'stalled',
      reason: 'provider-writeback-refused'
    })
  })

  it('clears the refused write-back warning once the pending runtime edit is undone', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    simulateCodexSettingWrite('model', '"o4"')
    syncSystemConfigIntoManagedCodexHome()
    expect(getCodexConfigSyncStatus().reason).toBe('provider-writeback-refused')

    simulateCodexSettingWrite('model', '"gpt-5"')
    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe('model = "gpt-5"\n')
    expect(getCodexConfigSyncStatus()).toMatchObject({ state: 'synced', reason: null })
  })

  it('honors a native project trust revocation while keeping a pending local model edit', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    simulateCodexSettingWrite('model', '"o4"')
    writeFileSync(
      runtimeConfigPath(),
      `${readRuntimeConfig()}\n[projects."/tmp/revoked-workspace"]\ntrust_level = "trusted"\n`,
      'utf-8'
    )
    const nativeConfig =
      'model = "gpt-5"\n\n[projects."/tmp/revoked-workspace"]\ntrust_level = "untrusted"\n'
    writeSystemConfig(nativeConfig)

    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe(nativeConfig)
    expect(readRuntimeConfig()).toContain('model = "o4"')
    expect(readRuntimeConfig()).toContain('trust_level = "untrusted"')
    expect(readRuntimeConfig()).not.toContain('trust_level = "trusted"')
    expect(getCodexConfigSyncStatus().reason).toBe('provider-writeback-refused')
  })

  it('adds newly revoked native projects absent from the runtime during refused write-back', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    simulateCodexSettingWrite('model', '"o4"')
    const native =
      'model = "gpt-5"\n\n[projects."/tmp/new-revocation"]\ntrust_level = "untrusted"\n'
    writeSystemConfig(native)

    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe(native)
    expect(readRuntimeConfig()).toContain('model = "o4"')
    expect(readRuntimeConfig()).toContain('[projects."/tmp/new-revocation"]')
    expect(readRuntimeConfig()).toContain('trust_level = "untrusted"')
    const afterFirstSync = readRuntimeConfig()
    syncSystemConfigIntoManagedCodexHome()
    expect(readRuntimeConfig()).toBe(afterFirstSync)
  })

  it('refuses launch-time sync if a native revocation cannot be published to the runtime', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    simulateCodexSettingWrite('model', '"o4"')
    const existing = `${readRuntimeConfig()}\n[projects."/tmp/revoked-workspace"]\ntrust_level = "trusted"\n`
    writeFileSync(runtimeConfigPath(), existing, 'utf-8')
    const native =
      'model = "gpt-5"\n\n[projects."/tmp/revoked-workspace"]\ntrust_level = "untrusted"\n'
    writeSystemConfig(native)
    const originalBaseline = readFileSync(baselinePath(), 'utf-8')
    promotionTestState.failRevocationWrite = true

    expect(() => syncSystemConfigIntoManagedCodexHome()).toThrow(/project trust revocation/i)

    expect(readSystemConfig()).toBe(native)
    expect(readRuntimeConfig()).toBe(existing)
    expect(readFileSync(baselinePath(), 'utf-8')).toBe(originalBaseline)

    promotionTestState.failRevocationWrite = false
    syncSystemConfigIntoManagedCodexHome()
    expect(readRuntimeConfig()).toContain('trust_level = "untrusted"')
    expect(readRuntimeConfig()).not.toContain('trust_level = "trusted"')
    expect(readRuntimeConfig()).toContain('model = "o4"')
    expect(readSystemConfig()).toBe(native)
  })

  it('recovers native distrust if the ordinary runtime mirror write fails', () => {
    const trusted =
      'model = "gpt-5"\n\n[projects."/tmp/revoked-workspace"]\ntrust_level = "trusted"\n'
    writeSystemConfig(trusted)
    syncSystemConfigIntoManagedCodexHome()
    expect(readRuntimeConfig()).toContain('trust_level = "trusted"')
    const native = trusted.replace('"trusted"', '"untrusted"')
    writeSystemConfig(native)
    promotionTestState.failAtomicWrite = true

    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe(native)
    expect(readRuntimeConfig()).toContain('trust_level = "untrusted"')
    expect(readRuntimeConfig()).not.toContain('trust_level = "trusted"')
    promotionTestState.failAtomicWrite = false
    syncSystemConfigIntoManagedCodexHome()
    expect(readRuntimeConfig()).toContain('trust_level = "untrusted"')
    expect(readSystemConfig()).toBe(native)
  })

  it('refuses a failed mirror if its trust-revocation fallback also loses a write race', () => {
    const trusted =
      'model = "gpt-5"\n\n[projects."/tmp/revoked-workspace"]\ntrust_level = "trusted"\n'
    writeSystemConfig(trusted)
    syncSystemConfigIntoManagedCodexHome()
    const native = trusted.replace('"trusted"', '"untrusted"')
    writeSystemConfig(native)
    promotionTestState.failAtomicWrite = true
    promotionTestState.failRevocationWrite = true

    expect(() => syncSystemConfigIntoManagedCodexHome()).toThrow(/project trust revocation/i)
    expect(readSystemConfig()).toBe(native)
    expect(readRuntimeConfig()).toContain('trust_level = "trusted"')
  })

  it.skipIf(process.platform === 'win32')(
    'still applies native project distrust when an unreadable settings baseline stalls promotion',
    () => {
      writeSystemConfig('model = "gpt-5"\n')
      syncSystemConfigIntoManagedCodexHome()
      simulateCodexSettingWrite('model', '"o4"')
      writeFileSync(
        runtimeConfigPath(),
        `${readRuntimeConfig()}\n[projects."/tmp/revoked-workspace"]\ntrust_level = "trusted"\n`,
        'utf-8'
      )
      const native =
        'model = "gpt-5"\n\n[projects."/tmp/revoked-workspace"]\ntrust_level = "untrusted"\n'
      writeSystemConfig(native)
      rmSync(baselinePath())
      symlinkSync(baselinePath(), baselinePath())

      syncSystemConfigIntoManagedCodexHome()

      expect(readSystemConfig()).toBe(native)
      expect(readRuntimeConfig()).toContain('model = "o4"')
      expect(readRuntimeConfig()).toContain('trust_level = "untrusted"')
      expect(readRuntimeConfig()).not.toContain('trust_level = "trusted"')
      expect(lstatSync(baselinePath()).isSymbolicLink()).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses stale project trust if promotion fails and native source becomes unreadable',
    () => {
      writeSystemConfig('model = "gpt-5"\n')
      syncSystemConfigIntoManagedCodexHome()
      simulateCodexSettingWrite('model', '"o4"')
      const original = `${readRuntimeConfig()}\n[projects."/tmp/revoked-workspace"]\ntrust_level = "trusted"\n`
      writeFileSync(runtimeConfigPath(), original, 'utf-8')
      rmSync(baselinePath())
      symlinkSync(baselinePath(), baselinePath())
      rmSync(systemConfigPath())
      symlinkSync(systemConfigPath(), systemConfigPath())

      expect(() => syncSystemConfigIntoManagedCodexHome()).toThrow(/project trust revocation/i)
      expect(readRuntimeConfig()).toBe(original)
      expect(lstatSync(systemConfigPath()).isSymbolicLink()).toBe(true)
    }
  )

  it('does not create a native config when a pending setting cannot be written back', () => {
    writeSystemConfig(' \n')
    syncSystemConfigIntoManagedCodexHome()
    const baselineBeforeEdit = readFileSync(baselinePath(), 'utf-8')
    rmSync(join(tmpHome, '.codex'), { recursive: true, force: true })
    simulateCodexSettingWrite('model', '"o4"')

    syncSystemConfigIntoManagedCodexHome()

    expect(existsSync(systemConfigPath())).toBe(false)
    expect(existsSync(join(tmpHome, '.codex'))).toBe(false)
    expect(readRuntimeConfig()).toContain('model = "o4"')
    expect(readFileSync(baselinePath(), 'utf-8')).toBe(baselineBeforeEdit)
    expect(getCodexConfigSyncStatus()).toMatchObject({
      state: 'stalled',
      reason: 'provider-writeback-refused'
    })
  })

  it('keeps plugin and MCP registrations when native settings write-back is refused', () => {
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    const baselineBeforeEdit = readFileSync(baselinePath(), 'utf-8')
    const runtimeConfig = [
      '[marketplaces.ponytail]',
      'source_type = "git"',
      'source = "https://example.invalid/ponytail.git"',
      '',
      '[plugins."ponytail@ponytail"]',
      'enabled = true',
      '',
      '[mcp_servers.local]',
      'command = "local-mcp"',
      ''
    ].join('\n')
    writeFileSync(runtimeConfigPath(), `${readRuntimeConfig()}\n${runtimeConfig}`, 'utf-8')

    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe('model = "gpt-5"\n')
    expect(readFileSync(runtimeConfigPath(), 'utf-8')).toContain('[plugins."ponytail@ponytail"]')
    expect(readFileSync(runtimeConfigPath(), 'utf-8')).toContain('[mcp_servers.local]')
    expect(readFileSync(baselinePath(), 'utf-8')).toBe(baselineBeforeEdit)
    expect(getCodexConfigSyncStatus()).toMatchObject({
      state: 'stalled',
      reason: 'provider-writeback-refused'
    })
  })

  it.skipIf(process.platform === 'win32')(
    'leaves the native config and symlink target unchanged when write-back is refused',
    () => {
      mkdirSync(join(tmpHome, '.codex'), { recursive: true })
      const realConfigPath = join(tmpHome, 'dotfiles-config.toml')
      writeFileSync(realConfigPath, 'model = "gpt-5"\n', 'utf-8')
      symlinkSync(realConfigPath, systemConfigPath())
      syncSystemConfigIntoManagedCodexHome()
      simulateCodexSettingWrite('model', '"o4"')

      syncSystemConfigIntoManagedCodexHome()

      expect(lstatSync(systemConfigPath()).isSymbolicLink()).toBe(true)
      expect(readFileSync(realConfigPath, 'utf-8')).toBe('model = "gpt-5"\n')
      expect(readRuntimeConfig()).toContain('model = "o4"')
    }
  )

  it('retries a runtime change after a missing system config returns', () => {
    promotionTestState.allowNativeSettingsWrite = true
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    const baselineBeforeSourceLoss = readFileSync(baselinePath(), 'utf-8')

    rmSync(systemConfigPath())
    simulateCodexSettingWrite('model', '"o4"')
    syncSystemConfigIntoManagedCodexHome()

    expect(readRuntimeConfig()).toContain('model = "o4"')
    expect(existsSync(systemConfigPath())).toBe(false)
    expect(readFileSync(baselinePath(), 'utf-8')).toBe(baselineBeforeSourceLoss)

    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe('model = "o4"\n')
    expect(readRuntimeConfig()).toContain('model = "o4"')
  })

  it.skipIf(process.platform === 'win32')(
    'preserves a restrictive mode on the existing ~/.codex/config.toml',
    () => {
      promotionTestState.allowNativeSettingsWrite = true
      writeSystemConfig('model = "gpt-5"\n')
      chmodSync(systemConfigPath(), 0o600)
      syncSystemConfigIntoManagedCodexHome()

      simulateCodexSettingWrite('model', '"o4"')
      syncSystemConfigIntoManagedCodexHome()

      expect(readSystemConfig()).toBe('model = "o4"\n')
      expect(statSync(systemConfigPath()).mode & 0o777).toBe(0o600)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'creates a new ~/.codex/config.toml with owner-only permissions',
    () => {
      promotionTestState.allowNativeSettingsWrite = true
      syncSystemConfigIntoManagedCodexHome()

      simulateCodexSettingWrite('model', '"o4"')
      syncSystemConfigIntoManagedCodexHome()

      expect(statSync(systemConfigPath()).mode & 0o777).toBe(0o600)
      // The home may later hold auth.json, so directory permissions must also be private.
      expect(statSync(join(tmpHome, '.codex')).mode & 0o777).toBe(0o700)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'writes through a symlinked config.toml without replacing the link',
    () => {
      promotionTestState.allowNativeSettingsWrite = true
      mkdirSync(join(tmpHome, '.codex'), { recursive: true })
      const realConfigPath = join(tmpHome, 'dotfiles-config.toml')
      writeFileSync(realConfigPath, 'model = "gpt-5"\n', 'utf-8')
      symlinkSync(realConfigPath, systemConfigPath())
      syncSystemConfigIntoManagedCodexHome()

      simulateCodexSettingWrite('model', '"o4"')
      syncSystemConfigIntoManagedCodexHome()

      expect(lstatSync(systemConfigPath()).isSymbolicLink()).toBe(true)
      expect(readFileSync(realConfigPath, 'utf-8')).toBe('model = "o4"\n')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'preserves a dangling config.toml symlink and creates its target',
    () => {
      promotionTestState.allowNativeSettingsWrite = true
      mkdirSync(join(tmpHome, '.codex'), { recursive: true })
      const realConfigPath = join(tmpHome, 'dotfiles', 'config.toml')
      symlinkSync(realConfigPath, systemConfigPath())
      syncSystemConfigIntoManagedCodexHome()

      simulateCodexSettingWrite('model', '"o4"')
      syncSystemConfigIntoManagedCodexHome()

      expect(lstatSync(systemConfigPath()).isSymbolicLink()).toBe(true)
      expect(readFileSync(realConfigPath, 'utf-8')).toBe('model = "o4"\n')
    }
  )

  it('keeps the old baseline and retries after a transient promotion failure', () => {
    promotionTestState.allowNativeSettingsWrite = true
    writeSystemConfig('model = "gpt-5"\n')
    syncSystemConfigIntoManagedCodexHome()
    const baselineBeforeFailure = readFileSync(baselinePath(), 'utf-8')
    simulateCodexSettingWrite('model', '"o4"')

    promotionTestState.failAtomicWrite = true
    syncSystemConfigIntoManagedCodexHome()

    expect(readSystemConfig()).toBe('model = "gpt-5"\n')
    expect(readRuntimeConfig()).toBe('model = "o4"\n')
    expect(readFileSync(baselinePath(), 'utf-8')).toBe(baselineBeforeFailure)

    promotionTestState.failAtomicWrite = false
    syncSystemConfigIntoManagedCodexHome()
    expect(readSystemConfig()).toBe('model = "o4"\n')
  })
})
