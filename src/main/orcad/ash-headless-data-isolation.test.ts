import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createOrcadSecretStore } from './orcad-secret-store'
import { orcadSecretStatePath } from './orcad-secret-key-resolution'
import { assertAshUserDataPathIsIndependent, resolveUserDataPath } from './orcad-app-paths'
import {
  ashHeadlessSecretKeyDirectory,
  mayCreateAshHeadlessSecretKey
} from './orcad-secret-store-startup'

const fixtures: string[] = []

function fixture(): string {
  const path = mkdtempSync(join(tmpdir(), 'ash-secret-isolation-'))
  fixtures.push(path)
  return path
}

afterEach(() => {
  for (const path of fixtures.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('Ash standalone profile and credential isolation', () => {
  it('defaults to the actual Ash desktop profile, never the Orca data root', () => {
    const root = fixture()
    const environment = {
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'data'),
      ORCA_USER_DATA: join(root, 'legacy-orca')
    }
    const actual = resolveUserDataPath({ environment, platform: 'linux', homeDir: root })
    expect(actual).toBe(join(root, 'config', 'ash-ide'))
    expect(existsSync(join(root, 'legacy-orca'))).toBe(false)
  })

  it('keeps macOS/Windows default roots independent and rejects absent Windows APPDATA', () => {
    const root = fixture()
    expect(resolveUserDataPath({ environment: {}, platform: 'darwin', homeDir: root })).toBe(
      join(root, 'Library', 'Application Support', 'ash-ide')
    )
    expect(
      resolveUserDataPath({
        environment: { APPDATA: join(root, 'AppData', 'Roaming') },
        platform: 'win32',
        homeDir: root
      })
    ).toBe(join(root, 'AppData', 'Roaming', 'ash-ide'))
    expect(() =>
      resolveUserDataPath({ environment: {}, platform: 'win32', homeDir: root })
    ).toThrow('APPDATA')
  })

  it('refuses an explicit foreign data root, nested Orca paths, and symlink aliases', () => {
    const root = fixture()
    const orca = join(root, '.orca')
    mkdirSync(orca)
    writeFileSync(join(orca, 'foreign-token.enc'), 'orcas-data-sentinel')
    const alias = join(root, 'ash-alias')
    symlinkSync(orca, alias, 'dir')
    for (const location of [orca, join(orca, 'nested-ash'), alias]) {
      expect(() =>
        resolveUserDataPath({
          environment: { ASH_USER_DATA_PATH: location },
          platform: 'linux',
          homeDir: root
        })
      ).toThrow('ash_data_root_conflicts_with_orca')
    }
    expect(() =>
      assertAshUserDataPathIsIndependent('relative-profile', {
        platform: 'linux',
        homeDir: root,
        environment: {}
      })
    ).toThrow('ash_user_data_path_must_be_absolute')
    for (const ancestor of [dirname(root), '/']) {
      expect(() =>
        resolveUserDataPath({
          environment: { ASH_USER_DATA_PATH: ancestor },
          platform: 'linux',
          homeDir: root
        })
      ).toThrow('ash_data_root_conflicts_with_orca')
    }
    expect(readFileSync(join(orca, 'foreign-token.enc'), 'utf8')).toBe('orcas-data-sentinel')
  })

  it('fails closed before generating a new Ash key for pre-existing profile state', () => {
    const root = fixture()
    const profile = join(root, 'ash-profile')
    mkdirSync(profile)
    writeFileSync(join(profile, 'orca-profile-index.json'), 'existing-state-sentinel')
    const keyDir = ashHeadlessSecretKeyDirectory(profile)
    expect(
      mayCreateAshHeadlessSecretKey(profile, {
        temporaryProfile: false,
        keyRecordPresent: false
      })
    ).toBe(false)
    expect(existsSync(keyDir)).toBe(false)
    expect(readFileSync(join(profile, 'orca-profile-index.json'), 'utf8')).toBe(
      'existing-state-sentinel'
    )
    expect(
      mayCreateAshHeadlessSecretKey(profile, {
        temporaryProfile: false,
        keyRecordPresent: true
      })
    ).toBe(true)
  })

  it('does not follow a credential-key symlink outside the Ash profile', () => {
    const root = fixture()
    const profile = join(root, 'ash-profile')
    const unrelated = join(root, 'unrelated-credential-store')
    mkdirSync(profile)
    mkdirSync(unrelated)
    writeFileSync(join(unrelated, 'token.enc'), 'foreign-sentinel')
    symlinkSync(unrelated, join(profile, 'ash-headless-secret-keys'), 'dir')
    expect(() => ashHeadlessSecretKeyDirectory(profile)).toThrow(
      'ash_secret_key_path_escapes_profile'
    )
    expect(readFileSync(join(unrelated, 'token.enc'), 'utf8')).toBe('foreign-sentinel')
  })

  it('refuses a linked key record before it could touch another application key', () => {
    const root = fixture()
    const profile = join(root, 'ash-profile')
    const keyDir = ashHeadlessSecretKeyDirectory(profile)
    mkdirSync(keyDir, { recursive: true })
    const foreign = join(root, 'foreign-key-record')
    writeFileSync(foreign, 'unrelated-synthetic-record')
    symlinkSync(foreign, orcadSecretStatePath({ keyDir }), 'file')
    expect(() => mayCreateAshHeadlessSecretKey(profile)).toThrow(
      'ash_secret_key_record_not_private'
    )
    expect(readFileSync(foreign, 'utf8')).toBe('unrelated-synthetic-record')
  })

  it('creates a reusable host-bound key only inside the independent Ash profile', async () => {
    const root = fixture()
    const profile = join(root, 'ash-profile')
    const foreign = join(root, '.orca')
    mkdirSync(foreign)
    writeFileSync(join(foreign, 'foreign-token.enc'), 'orcas-data-sentinel')
    const keyDir = ashHeadlessSecretKeyDirectory(profile)
    const options = {
      keyDir,
      machineIdentity: () => 'ash-fixture-machine',
      legacyKeyring: null
    }
    const first = createOrcadSecretStore()
    expect(await first.prepare(options)).toBe(true)
    const secret = first.encryptString('ash-only-synthetic-value')
    const second = createOrcadSecretStore()
    expect(await second.prepare(options)).toBe(true)
    expect(second.decryptString(secret)).toBe('ash-only-synthetic-value')
    expect(lstatSync(keyDir).mode & 0o077).toBe(0)
    expect(readFileSync(join(foreign, 'foreign-token.enc'), 'utf8')).toBe('orcas-data-sentinel')
    expect(existsSync(join(foreign, 'orcad-secret-store-legacy.json'))).toBe(false)
  })

  it('keeps existing Ash ciphertext recoverable without minting a replacement key', async () => {
    const root = fixture()
    const profile = join(root, 'ash-profile')
    mkdirSync(profile)
    writeFileSync(join(profile, 'orca-profile-index.json'), 'existing-profile-sentinel')
    expect(
      mayCreateAshHeadlessSecretKey(profile, {
        temporaryProfile: false,
        keyRecordPresent: false
      })
    ).toBe(false)
    const keyDir = ashHeadlessSecretKeyDirectory(profile)
    const store = createOrcadSecretStore()
    expect(
      await store.prepare({
        keyDir,
        machineIdentity: () => 'ash-fixture-machine',
        legacyKeyring: null,
        allowNewKey: false
      })
    ).toBe(false)
    expect(store.describeProtectionGap()).toContain('ash_headless_secret_transition_required')
    expect(() => store.encryptString('should-not-appear-on-disk')).toThrow()
    expect(existsSync(keyDir)).toBe(false)
    expect(readFileSync(join(profile, 'orca-profile-index.json'), 'utf8')).toBe(
      'existing-profile-sentinel'
    )
  })

  it('never reads an old OS-keyring account or replaces its record without approval', async () => {
    const root = fixture()
    const profile = join(root, 'ash-profile')
    const keyDir = ashHeadlessSecretKeyDirectory(profile)
    mkdirSync(keyDir, { recursive: true, mode: 0o700 })
    const recordPath = orcadSecretStatePath({
      keyDir,
      machineIdentity: () => 'ash-fixture-machine'
    })
    const legacy = JSON.stringify({
      version: 1,
      backend: 'os-keyring',
      account: 'synthetic-other-app-account',
      check: 'synthetic-unrecoverable-check'
    })
    writeFileSync(recordPath, legacy, { mode: 0o600 })
    let keychainReads = 0
    const store = createOrcadSecretStore()
    expect(
      await store.prepare({
        keyDir,
        machineIdentity: () => 'ash-fixture-machine',
        allowLegacyKeyringMigration: false,
        legacyKeyring: async () => {
          keychainReads += 1
          throw new Error('forbidden keychain read')
        }
      })
    ).toBe(false)
    expect(keychainReads).toBe(0)
    expect(readFileSync(recordPath, 'utf8')).toBe(legacy)
    expect(store.describeProtectionGap()).toContain('user-approved migration')
  })
})
