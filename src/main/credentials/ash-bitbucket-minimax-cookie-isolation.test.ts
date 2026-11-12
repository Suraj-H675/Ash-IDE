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
  _resetBitbucketCredentialCache,
  clearStoredBitbucketCredential,
  getStoredBitbucketMetadata,
  hasStoredBitbucketCredential,
  loadStoredBitbucketSecret,
  saveBitbucketCredential
} from '../bitbucket/credential-store'
import {
  clearMiniMaxSessionCookie,
  hasMiniMaxSessionCookie,
  readMiniMaxSessionCookie,
  saveMiniMaxSessionCookie
} from '../minimax/minimax-cookie-store'

let home = ''
let profile = ''

function bitbucketInput(token: string) {
  return {
    authMode: 'token' as const,
    email: null,
    baseUrl: 'https://api.bitbucket.org',
    account: 'test-ash-account',
    accessToken: token,
    apiToken: null
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ash-git-cookie-isolation-'))
  profile = join(home, 'profile-a')
  setAppEnvironment({
    getPath: (name) => (name === 'userData' ? profile : home),
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
      throw new Error('synthetic-only')
    },
    decryptString: () => {
      throw new Error('synthetic-only')
    },
    describeProtectionGap: () => null
  })
  _resetBitbucketCredentialCache()
})

afterEach(() => {
  _resetBitbucketCredentialCache()
  rmSync(home, { recursive: true, force: true })
})

describe('Ash-owned Bitbucket credentials and MiniMax session cookie', () => {
  it('saves, reads and clears Ash-only credentials without touching Orca files', () => {
    const orca = join(home, '.orca')
    mkdirSync(orca)
    const filenames = [
      'bitbucket-credential.enc',
      'bitbucket-credential.json',
      'minimax-session-cookie.enc'
    ]
    for (const filename of filenames) {
      writeFileSync(join(orca, filename), 'foreign-app-sentinel', { mode: 0o644 })
    }
    expect(hasStoredBitbucketCredential()).toBe(false)
    expect(hasMiniMaxSessionCookie()).toBe(false)
    saveBitbucketCredential(bitbucketInput('synthetic-bitbucket-a'))
    saveMiniMaxSessionCookie('session=safe-cookie-a')
    const ashDir = join(profile, 'provider-credentials')
    expect(existsSync(join(ashDir, 'bitbucket-credential.enc'))).toBe(true)
    expect(existsSync(join(ashDir, 'bitbucket-credential.json'))).toBe(true)
    expect(existsSync(join(ashDir, 'minimax-session-cookie.enc'))).toBe(true)
    expect(hasStoredBitbucketCredential()).toBe(true)
    expect(getStoredBitbucketMetadata()?.account).toBe('test-ash-account')
    expect(loadStoredBitbucketSecret({ force: true })?.accessToken).toBe('synthetic-bitbucket-a')
    expect(readMiniMaxSessionCookie()).toBe('session=safe-cookie-a')
    clearStoredBitbucketCredential()
    clearMiniMaxSessionCookie()
    expect(hasStoredBitbucketCredential()).toBe(false)
    expect(hasMiniMaxSessionCookie()).toBe(false)
    for (const filename of filenames) {
      expect(readFileSync(join(orca, filename), 'utf8')).toBe('foreign-app-sentinel')
      expect(statSync(join(orca, filename)).mode & 0o777).toBe(0o644)
    }
  })

  it('does not reuse cached Bitbucket metadata/secret or MiniMax cookie after profile selection changes', () => {
    saveBitbucketCredential(bitbucketInput('bitbucket-profile-a'))
    saveMiniMaxSessionCookie('session=profile-a')
    const first = profile
    profile = join(home, 'profile-b')
    expect(getStoredBitbucketMetadata()).toBeNull()
    expect(loadStoredBitbucketSecret({ force: true })).toBeNull()
    expect(readMiniMaxSessionCookie()).toBeNull()
    saveBitbucketCredential(bitbucketInput('bitbucket-profile-b'))
    saveMiniMaxSessionCookie('session=profile-b')
    expect(loadStoredBitbucketSecret({ force: true })?.accessToken).toBe('bitbucket-profile-b')
    expect(readMiniMaxSessionCookie()).toBe('session=profile-b')
    clearStoredBitbucketCredential()
    clearMiniMaxSessionCookie()
    profile = first
    expect(getStoredBitbucketMetadata()?.account).toBe('test-ash-account')
    expect(loadStoredBitbucketSecret({ force: true })?.accessToken).toBe('bitbucket-profile-a')
    expect(readMiniMaxSessionCookie()).toBe('session=profile-a')
    clearStoredBitbucketCredential()
    clearMiniMaxSessionCookie()
  })

  it('refuses a linked Bitbucket metadata record before deleting any credential', () => {
    saveBitbucketCredential(bitbucketInput('existing-ash-secret'))
    const ashDir = join(profile, 'provider-credentials')
    const secretPath = join(ashDir, 'bitbucket-credential.enc')
    const metadataPath = join(ashDir, 'bitbucket-credential.json')
    const secret = readFileSync(secretPath, 'utf8')
    const foreign = join(home, '.orca')
    mkdirSync(foreign)
    const foreignMetadata = join(foreign, 'bitbucket-credential.json')
    writeFileSync(foreignMetadata, 'foreign-metadata', { mode: 0o644 })
    rmSync(metadataPath)
    symlinkSync(foreignMetadata, metadataPath)
    expect(() => clearStoredBitbucketCredential()).toThrow()
    expect(readFileSync(secretPath, 'utf8')).toBe(secret)
    expect(readFileSync(foreignMetadata, 'utf8')).toBe('foreign-metadata')
  })

  it('refuses an external MiniMax cookie symlink and hard link without hardening its file', () => {
    const foreign = join(home, '.orca')
    mkdirSync(foreign)
    const foreignCookie = join(foreign, 'minimax-session-cookie.enc')
    writeFileSync(foreignCookie, 'unrelated-cookie', { mode: 0o644 })
    const ashDir = join(profile, 'provider-credentials')
    mkdirSync(ashDir, { recursive: true })
    const cookiePath = join(ashDir, 'minimax-session-cookie.enc')
    symlinkSync(foreignCookie, cookiePath)
    expect(() => hasMiniMaxSessionCookie()).toThrow()
    rmSync(cookiePath)
    linkSync(foreignCookie, cookiePath)
    expect(() => hasMiniMaxSessionCookie()).toThrow()
    expect(readFileSync(foreignCookie, 'utf8')).toBe('unrelated-cookie')
    expect(statSync(foreignCookie).mode & 0o777).toBe(0o644)
  })
})
