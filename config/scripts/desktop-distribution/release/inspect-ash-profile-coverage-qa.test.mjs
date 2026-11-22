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
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectAshProfileCoverage } from './inspect-ash-profile-coverage-qa.mjs'

const ownedRoots = []
const script = fileURLToPath(new URL('./inspect-ash-profile-coverage-qa.mjs', import.meta.url))

function privateRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ash-pk06-coverage-'))
  ownedRoots.push(root)
  chmodSync(root, 0o700)
  return root
}

afterEach(() => {
  for (const root of ownedRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform !== 'linux')(
  'read-only PK-06 actual Ash profile-root discovery',
  () => {
    it('finds real storage ownership categories but never claims complete recovery', () => {
      const root = privateRoot()
      mkdirSync(join(root, 'profiles'), { mode: 0o700 })
      mkdirSync(join(root, 'Partitions'), { mode: 0o700 })
      mkdirSync(join(root, 'daemon'), { mode: 0o700 })
      mkdirSync(join(root, 'terminal-history'), { mode: 0o700 })
      writeFileSync(join(root, 'orca-profile-index.json'), '{"profiles":[]}', { mode: 0o600 })
      writeFileSync(join(root, 'agent-session-authority.key'), 'do-not-read', { mode: 0o000 })
      writeFileSync(join(root, 'private-customer-project-token'), 'private-content', {
        mode: 0o000
      })
      const report = inspectAshProfileCoverage(root)
      expect(report).toMatchObject({
        checkpoint: 'PK-06',
        schema: 1,
        outcome: 'coverage-unproven',
        activationAvailable: false,
        requiredAnchorsPresent: true,
        totalRootEntries: 7,
        unclassifiedEntryCount: 1,
        unsafeEntryCount: 0,
        mismatchedKnownEntryCount: 0,
        uninspectedNestedState: true,
        liveWriterAdmissionVerified: false,
        crossVersionCompatibilityVerified: false,
        fullStateRollbackVerified: false
      })
      expect(report.observedDomainEntryCounts).toEqual({
        'profile-state': 2,
        'browser-persistent-state': 1,
        'runtime-pty-and-provider-state': 3,
        'cache-and-diagnostic-state': 0
      })
      expect(JSON.stringify(report)).not.toContain(root)
      expect(JSON.stringify(report)).not.toContain('private-customer-project-token')
      expect(JSON.stringify(report)).not.toContain('private-content')
      expect(JSON.stringify(report)).not.toContain('do-not-read')
    })

    it('reports a symlink and mismatched known storage without following either', () => {
      const root = privateRoot()
      symlinkSync('/etc/passwd', join(root, 'profiles'))
      writeFileSync(join(root, 'orca-profile-index.json'), 'not-a-database', { mode: 0o600 })
      writeFileSync(join(root, 'daemon'), '', { mode: 0o600 })
      const report = inspectAshProfileCoverage(root)
      expect(report).toMatchObject({
        outcome: 'coverage-unproven',
        requiredAnchorsPresent: false,
        unclassifiedEntryCount: 0,
        unsafeEntryCount: 1,
        mismatchedKnownEntryCount: 2,
        activationAvailable: false
      })
    })

    it('accounts for SQLite WAL, backups, quarantines and profile-scoped secrets without reading them', () => {
      const root = privateRoot()
      const profiles = join(root, 'profiles')
      const profile = join(profiles, 'native-cross-version')
      mkdirSync(profile, { recursive: true, mode: 0o700 })
      writeFileSync(join(root, 'orca-profile-index.json'), '{}', { mode: 0o600 })
      for (const file of [
        'profile-state.db',
        'profile-state.db-wal',
        'profile-state.db-shm',
        'profile-state.db.authority',
        'orca-secret-protection.json',
        'active-view.json'
      ]) {
        writeFileSync(join(profile, file), `private:${file}`, { mode: 0o000 })
      }
      const suffix = '1795318048562-08c3e96a-9ea6-4bae-b1a7-8b4fbcdb216e'
      writeFileSync(join(profile, `profile-state.db.backup.${suffix}.db`), 'retained', {
        mode: 0o000
      })
      mkdirSync(join(profile, `profile-state-corrupt-${suffix}`), { mode: 0o700 })
      writeFileSync(join(profile, 'unexpected-user-private-note'), 'never read', { mode: 0o000 })
      const report = inspectAshProfileCoverage(root)
      expect(report.profileInventory).toMatchObject({
        profileDirectoryCount: 1,
        inspectedProfileEntryCount: 9,
        unclassifiedProfileEntryCount: 1,
        unsafeProfileEntryCount: 0,
        observedProfileDomainEntryCounts: {
          'sqlite-and-recovery': 6,
          'profile-layout-and-browser': 1,
          'profile-identity-and-secrets': 1
        }
      })
      expect(report.outcome).toBe('coverage-unproven')
      expect(JSON.stringify(report)).not.toContain('native-cross-version')
      expect(JSON.stringify(report)).not.toContain('unexpected-user-private-note')
      expect(JSON.stringify(report)).not.toContain('never read')
    })

    it('does not follow a symlinked profile or a symlinked nested state item', () => {
      const root = privateRoot()
      const profiles = join(root, 'profiles')
      mkdirSync(profiles, { mode: 0o700 })
      mkdirSync(join(profiles, 'normal'), { mode: 0o700 })
      symlinkSync('/etc', join(profiles, 'replaced-profile'))
      symlinkSync('/etc/passwd', join(profiles, 'normal', 'profile-state.db'))
      const report = inspectAshProfileCoverage(root)
      expect(report.profileInventory).toMatchObject({
        profileDirectoryCount: 1,
        inspectedProfileEntryCount: 1,
        unclassifiedProfileEntryCount: 1,
        unsafeProfileEntryCount: 2
      })
      expect(report.activationAvailable).toBe(false)
    })

    it('classifies hard-linked files as unsafe instead of treating them as covered state', () => {
      const root = privateRoot()
      writeFileSync(join(root, 'keybindings.json'), 'test', { mode: 0o600 })
      linkSync(join(root, 'keybindings.json'), join(root, 'another-copy'))
      const report = inspectAshProfileCoverage(root)
      expect(report.unsafeEntryCount).toBe(2)
      expect(report.mismatchedKnownEntryCount).toBe(1)
      expect(report.unclassifiedEntryCount).toBe(1)
      expect(report.activationAvailable).toBe(false)
    })

    it('rejects a nonprivate root and noncanonical or symlinked root aliases', () => {
      const root = privateRoot()
      chmodSync(root, 0o755)
      expect(() => inspectAshProfileCoverage(root)).toThrow(/private owned/)
      chmodSync(root, 0o700)
      expect(() => inspectAshProfileCoverage(`${root}/../${basename(root)}`)).toThrow(
        /absolute canonical/
      )
      const alias = `${root}-alias`
      ownedRoots.push(alias)
      symlinkSync(root, alias)
      expect(() => inspectAshProfileCoverage(alias)).toThrow(/private owned/)
    })

    it('offers a standalone metadata-only CLI with no sensitive paths in output or failure', () => {
      const root = privateRoot()
      mkdirSync(join(root, 'profiles'), { mode: 0o700 })
      writeFileSync(join(root, 'orca-profile-index.json'), '{}', { mode: 0o600 })
      const pass = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })
      expect(pass.status).toBe(0)
      expect(JSON.parse(pass.stdout)).toMatchObject({
        outcome: 'coverage-unproven',
        requiredAnchorsPresent: true,
        activationAvailable: false
      })
      expect(pass.stdout).not.toContain(root)
      const fail = spawnSync(process.execPath, [script, '--root', join(root, 'missing')], {
        encoding: 'utf8'
      })
      expect(fail.status).not.toBe(0)
      expect(fail.stderr).not.toContain(root)
      expect(fail.stderr).toMatch(/failed closed/)
    })
  }
)
