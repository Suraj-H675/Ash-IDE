import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseStrictProfileIndexIds } from './inspect-ash-profile-index-qa.mjs'
import { inspectAshProfileCoverage } from './inspect-ash-profile-coverage-qa.mjs'

const testRoots = []
const script = fileURLToPath(new URL('./inspect-ash-profile-coverage-qa.mjs', import.meta.url))

function fixture(ids = ['first']) {
  const root = mkdtempSync(join(tmpdir(), 'ash-pk06-index-'))
  chmodSync(root, 0o700)
  testRoots.push(root)
  mkdirSync(join(root, 'profiles'), { mode: 0o700 })
  for (const id of ids) {
    mkdirSync(join(root, 'profiles', id), { mode: 0o700 })
  }
  writeFileSync(join(root, 'orca-profile-index.json'), JSON.stringify(index(ids)), {
    mode: 0o600
  })
  return root
}

function index(ids) {
  return {
    schemaVersion: 1,
    activeProfileId: ids[0] ?? 'missing',
    profiles: ids.map((id) => ({
      id,
      name: `private name ${id}`,
      kind: 'local',
      avatar: { kind: 'initials', initials: 'A', color: 'neutral' }
    }))
  }
}

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform !== 'linux')('opt-in index-to-directory recovery evidence', () => {
  it('reconciles all indexed profiles with real directory identities without printing any IDs', () => {
    const root = fixture(['alpha', 'beta'])
    const output = inspectAshProfileCoverage(root, { verifyProfileIndex: true })
    expect(output).toMatchObject({
      outcome: 'coverage-unproven',
      activationAvailable: false,
      profileIndexValidationState: 'validated-id-list',
      profileIndexContentsRead: true,
      profileIndexDirectoryCheck: {
        state: 'matching-ids-only',
        indexedProfileCount: 2,
        missingProfileDirectoryCount: 0,
        unindexedProfileDirectoryCount: 0
      },
      fullStateRollbackVerified: false,
      liveWriterAdmissionVerified: false
    })
    expect(JSON.stringify(output)).not.toMatch(/alpha|beta|private name/)
    const cli = spawnSync(process.execPath, [script, '--root', root, '--verify-profile-index'], {
      encoding: 'utf8'
    })
    expect(cli.status).toBe(0)
    expect(JSON.parse(cli.stdout).profileIndexDirectoryCheck.state).toBe('matching-ids-only')
    expect(cli.stdout).not.toContain(root)
    expect(cli.stdout).not.toContain('alpha')
  })

  it('counts missing and orphaned profiles without exposing their names', () => {
    const root = fixture(['present', 'orphan'])
    rmSync(join(root, 'profiles', 'orphan'), { recursive: true })
    mkdirSync(join(root, 'profiles', 'unindexed'), { mode: 0o700 })
    const report = inspectAshProfileCoverage(root, { verifyProfileIndex: true })
    expect(report.profileIndexDirectoryCheck).toEqual({
      state: 'mismatch',
      indexedProfileCount: 2,
      missingProfileDirectoryCount: 1,
      unindexedProfileDirectoryCount: 1
    })
    for (const privateId of ['present', 'orphan', 'unindexed']) {
      expect(JSON.stringify(report)).not.toContain(`"${privateId}"`)
    }
    expect(report.activationAvailable).toBe(false)
  })

  it('rejects duplicate, traversal, unexpected schema, and missing active ID', () => {
    for (const value of [
      index(['duplicate', 'duplicate']),
      index(['../escape']),
      { ...index(['valid']), schemaVersion: 19 },
      { ...index(['valid']), activeProfileId: 'not-indexed' },
      { ...index(['valid']), profiles: [] }
    ]) {
      expect(() => parseStrictProfileIndexIds(JSON.stringify(value))).toThrow()
    }
  })

  it('accounts for the source-backed recovery index backup but never equates it with a valid primary', () => {
    const root = fixture(['indexed'])
    writeFileSync(join(root, 'orca-profile-index.json.bak'), JSON.stringify(index(['retired'])), {
      mode: 0o600
    })
    const report = inspectAshProfileCoverage(root, { verifyProfileIndex: true })
    expect(report.observedDomainEntryCounts['profile-state']).toBe(3)
    expect(report.unclassifiedEntryCount).toBe(0)
    expect(report.profileIndexDirectoryCheck.state).toBe('matching-ids-only')
    expect(report.outcome).toBe('coverage-unproven')
    expect(JSON.stringify(report)).not.toContain('retired')
  })

  it('never opens the index in default metadata-only mode, even when unreadable', () => {
    const root = fixture()
    chmodSync(join(root, 'orca-profile-index.json'), 0o000)
    const defaultReport = inspectAshProfileCoverage(root)
    expect(defaultReport.profileIndexContentsRead).toBeUndefined()
    expect(defaultReport.profileIndexDirectoryCheck).toBeUndefined()
    const optIn = inspectAshProfileCoverage(root, { verifyProfileIndex: true })
    expect(optIn.profileIndexValidationState).toBe('unavailable')
    expect(optIn.profileIndexDirectoryCheck).toEqual({ state: 'unavailable' })
    expect(optIn.activationAvailable).toBe(false)
  })

  it('refuses linked and oversized index files instead of treating them as verified', () => {
    const linked = fixture()
    linkSync(join(linked, 'orca-profile-index.json'), join(linked, 'copy'))
    expect(inspectAshProfileCoverage(linked, { verifyProfileIndex: true })).toMatchObject({
      profileIndexValidationState: 'unavailable',
      activationAvailable: false
    })
    const oversized = fixture()
    writeFileSync(join(oversized, 'orca-profile-index.json'), 'a'.repeat(512 * 1024 + 1), {
      mode: 0o600
    })
    expect(inspectAshProfileCoverage(oversized, { verifyProfileIndex: true })).toMatchObject({
      profileIndexValidationState: 'unavailable',
      activationAvailable: false
    })
    const symlinked = fixture()
    rmSync(join(symlinked, 'orca-profile-index.json'))
    symlinkSync('/etc/passwd', join(symlinked, 'orca-profile-index.json'))
    expect(inspectAshProfileCoverage(symlinked, { verifyProfileIndex: true })).toMatchObject({
      profileIndexValidationState: 'unavailable',
      activationAvailable: false
    })
  })
})
