import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAppEnvironment } from '../../shared/app-environment'
import { setSecretStore } from '../../shared/secret-store'
import {
  clearOpenCodeGoApiKey,
  hasOpenCodeGoApiKey,
  readOpenCodeGoApiKey,
  saveOpenCodeGoApiKey
} from '../opencode/opencode-go-api-key-store'
import {
  clearZcodePlanApiKey,
  readZcodePlanApiKey,
  saveZcodePlanApiKey
} from '../zcode/zcode-plan-api-key-store'
import { ashProviderApiKeyPath } from './ash-provider-api-key-path'

let home = ''
let selectedProfile = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ash-provider-keys-'))
  selectedProfile = join(home, 'profile-a')
  setAppEnvironment({
    getPath: (name) => {
      if (name === 'userData') {
        return selectedProfile
      }
      return home
    },
    getAppPath: () => home,
    getVersion: () => '0.1.0-test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
  setSecretStore({
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('unused synthetic encryption')
    },
    decryptString: () => {
      throw new Error('unused synthetic decryption')
    },
    describeProtectionGap: () => null
  })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('Ash-owned provider API keys', () => {
  it('does not reuse cached GLM and OpenCode Go keys across Ash profiles', () => {
    saveZcodePlanApiKey('zcode-profile-a')
    saveOpenCodeGoApiKey('go-profile-a')
    expect(readZcodePlanApiKey()).toBe('zcode-profile-a')
    expect(readOpenCodeGoApiKey()).toBe('go-profile-a')
    const first = selectedProfile
    selectedProfile = join(home, 'profile-b')
    expect(readZcodePlanApiKey()).toBeNull()
    expect(readOpenCodeGoApiKey()).toBeNull()
    saveZcodePlanApiKey('zcode-profile-b')
    saveOpenCodeGoApiKey('go-profile-b')
    expect(readZcodePlanApiKey()).toBe('zcode-profile-b')
    expect(readOpenCodeGoApiKey()).toBe('go-profile-b')
    clearZcodePlanApiKey()
    clearOpenCodeGoApiKey()
    selectedProfile = first
    expect(readZcodePlanApiKey()).toBe('zcode-profile-a')
    expect(readOpenCodeGoApiKey()).toBe('go-profile-a')
    clearZcodePlanApiKey()
    clearOpenCodeGoApiKey()
  })

  it('refuses provider-key symlinks and hard links before reading or hardening a foreign record', () => {
    const foreignDir = join(home, '.orca')
    mkdirSync(foreignDir)
    const foreignKey = join(foreignDir, 'opencode-go-api-key.enc')
    writeFileSync(foreignKey, 'other-app-key-bytes', { mode: 0o644 })
    const keyDir = join(selectedProfile, 'provider-credentials')
    mkdirSync(keyDir, { recursive: true })
    const keyPath = join(keyDir, 'opencode-go-api-key.enc')
    symlinkSync(foreignKey, keyPath)
    expect(() => hasOpenCodeGoApiKey()).toThrow('ash_secret_key_path_escapes_profile')
    rmSync(keyPath)
    linkSync(foreignKey, keyPath)
    expect(() => hasOpenCodeGoApiKey()).toThrow('ash_provider_api_key_record_not_private')
    rmSync(keyPath)
    rmSync(keyDir, { recursive: true })
    symlinkSync(foreignDir, keyDir, 'dir')
    expect(() => hasOpenCodeGoApiKey()).toThrow('ash_secret_key_path_escapes_profile')
    expect(readFileSync(foreignKey, 'utf8')).toBe('other-app-key-bytes')
    expect(statSync(foreignKey).mode & 0o777).toBe(0o644)
  })

  it('rejects a profile alias pointing at the foreign Orca application home', () => {
    const foreignDir = join(home, '.orca')
    mkdirSync(foreignDir)
    const foreignKey = join(foreignDir, 'opencode-go-api-key.enc')
    writeFileSync(foreignKey, 'untouched')
    symlinkSync(foreignDir, selectedProfile, 'dir')
    expect(() => ashProviderApiKeyPath('opencode-go-api-key.enc')).toThrow(
      'ash_data_root_conflicts_with_orca'
    )
    expect(readFileSync(foreignKey, 'utf8')).toBe('untouched')
  })

  it('rejects unsanitized API-key filenames before creating directories', () => {
    expect(() => ashProviderApiKeyPath('../provider.enc')).toThrow(
      'ash_provider_api_key_filename_invalid'
    )
    expect(existsSync(selectedProfile)).toBe(false)
  })
})
