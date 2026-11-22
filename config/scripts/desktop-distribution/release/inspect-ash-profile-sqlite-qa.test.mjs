import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createProfileStateTablesSql,
  PROFILE_STATE_DATABASE_SCHEMA_VERSION
} from '../../../../src/main/persistence/profile-state/profile-state-database-schema'
import { inspectAshProfileCoverage } from './inspect-ash-profile-coverage-qa.mjs'

const roots = []
const CLI = fileURLToPath(new URL('./inspect-ash-profile-coverage-qa.mjs', import.meta.url))

function fixture(id = 'profile-fixture') {
  const root = mkdtempSync(join(tmpdir(), 'ash-pk06-sqlite-'))
  roots.push(root)
  chmodSync(root, 0o700)
  mkdirSync(join(root, 'profiles'), { mode: 0o700 })
  mkdirSync(join(root, 'profiles', id), { mode: 0o700 })
  writeFileSync(
    join(root, 'orca-profile-index.json'),
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId: id,
      profiles: [{ id, name: 'private-test-profile' }]
    }),
    { mode: 0o600 }
  )
  return { root, id, dbPath: join(root, 'profiles', id, 'profile-state.db') }
}

function seedSqlite(dbPath, id, { version = 3, shape = 'complete', dbIdentity = id } = {}) {
  const db = new DatabaseSync(dbPath)
  try {
    const productionSchema = createProfileStateTablesSql()
    db.exec(
      shape === 'wrong-column-type'
        ? productionSchema.replace(
            'domain_version INTEGER NOT NULL',
            'domain_version TEXT NOT NULL'
          )
        : productionSchema
    )
    if (shape !== 'complete') {
      db.exec('DROP TABLE profile_state_automation_runs')
    }
    db.exec(`PRAGMA user_version = ${version}`)
    db.prepare('INSERT INTO profile_state_meta (key, value) VALUES (?, ?)').run(
      'profile_id',
      dbIdentity
    )
  } finally {
    db.close()
  }
  chmodSync(dbPath, 0o600)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform !== 'linux')(
  'QA-only pinned SQLite schema/identity observation',
  () => {
    it('pins schema 3 to the production schema builder so migrations force review', () => {
      expect(PROFILE_STATE_DATABASE_SCHEMA_VERSION).toBe(3)
    })

    it('observes schema 3, integrity and profile identity without changing file metadata', () => {
      const { root, id, dbPath } = fixture()
      seedSqlite(dbPath, id)
      const before = statSync(dbPath, { bigint: true })
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      const after = statSync(dbPath, { bigint: true })
      expect(report).toMatchObject({
        outcome: 'coverage-unproven',
        activationAvailable: false,
        crossVersionCompatibilityVerified: false,
        fullStateRollbackVerified: false,
        profileSqliteEvidence: {
          state: 'schema-3-shape-and-identities-observed',
          statuses: { 'schema-3-identity-observed': 1 },
          readOnlyImmutable: true,
          liveWriterFenceEstablished: false
        }
      })
      expect(report.profileInventory.profileSqliteEvidence).toBeUndefined()
      expect(JSON.stringify(report)).not.toContain(id)
      expect(JSON.stringify(report)).not.toContain(root)
      for (const field of ['size', 'mtimeNs', 'ctimeNs', 'ino']) {
        expect(after[field]).toBe(before[field])
      }
    })

    it.each([
      [{ version: 4 }, 'unsupported-schema'],
      [{ version: 3, shape: 'missing-automation-runs' }, 'unsupported-schema'],
      [{ version: 3, shape: 'wrong-column-type' }, 'unsupported-schema'],
      [{ version: 3, dbIdentity: 'another-private-id' }, 'identity-mismatch']
    ])('rejects incompatible SQLite profile evidence %j', (options, expected) => {
      const { root, id, dbPath } = fixture()
      seedSqlite(dbPath, id, options)
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report.profileSqliteEvidence).toMatchObject({
        state: 'incomplete',
        statuses: { [expected]: 1 }
      })
      expect(report.activationAvailable).toBe(false)
      expect(JSON.stringify(report)).not.toContain('another-private-id')
    })

    it('classifies absent SQLite state rather than inventing an empty compatible database', () => {
      const { root } = fixture()
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report.profileSqliteEvidence).toMatchObject({
        state: 'incomplete',
        statuses: { missing: 1 }
      })
    })

    it('does not inspect SQLite contents when the required profile index is unavailable', () => {
      const { root, id, dbPath } = fixture()
      seedSqlite(dbPath, id)
      chmodSync(join(root, 'orca-profile-index.json'), 0o000)
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report).toMatchObject({
        profileIndexValidationState: 'unavailable',
        profileSqliteEvidence: { state: 'incomplete' },
        activationAvailable: false
      })
      expect(report.profileSqliteEvidence.statuses).toBeUndefined()
    })

    it('rejects a nonempty WAL without loading an immutable snapshot that ignores pending writes', () => {
      const { root, id, dbPath } = fixture()
      seedSqlite(dbPath, id)
      writeFileSync(`${dbPath}-wal`, Buffer.from('pending-writer-fixture'), { mode: 0o600 })
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report.profileSqliteEvidence).toMatchObject({
        state: 'incomplete',
        statuses: { 'unfrozen-journal-state': 1 }
      })
      expect(report.activationAvailable).toBe(false)
    })

    it('accepts stale bounded SHM metadata after an otherwise cold WAL checkpoint', () => {
      const { root, id, dbPath } = fixture()
      seedSqlite(dbPath, id)
      writeFileSync(`${dbPath}-wal`, Buffer.alloc(0), { mode: 0o600 })
      writeFileSync(`${dbPath}-shm`, Buffer.alloc(32768), { mode: 0o600 })
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report.profileSqliteEvidence).toMatchObject({
        state: 'schema-3-shape-and-identities-observed',
        statuses: { 'schema-3-identity-observed': 1, 'unfrozen-journal-state': 0 }
      })
    })

    it('rejects corrupt or non-SQLite input without leaking its bytes', () => {
      const { root, dbPath } = fixture()
      writeFileSync(dbPath, Buffer.from('private invalid database credentials fixture'), {
        mode: 0o600
      })
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report.profileSqliteEvidence).toMatchObject({
        state: 'incomplete',
        statuses: { unavailable: 1 }
      })
      expect(JSON.stringify(report)).not.toContain('credentials fixture')
    })

    it('does not spawn any SQLite workers above the 64-profile inspection budget', () => {
      const ids = Array.from({ length: 65 }, (_, i) => `p-${i}`)
      const { root } = fixture(ids[0])
      const indexPath = join(root, 'orca-profile-index.json')
      writeFileSync(
        indexPath,
        JSON.stringify({
          schemaVersion: 1,
          activeProfileId: ids[0],
          profiles: ids.map((id) => ({ id }))
        }),
        { mode: 0o600 }
      )
      for (const id of ids.slice(1)) {
        mkdirSync(join(root, 'profiles', id), { mode: 0o700 })
      }
      const report = inspectAshProfileCoverage(root, {
        verifyProfileIndex: true,
        verifyProfileSqlite: true
      })
      expect(report.profileSqliteEvidence).toMatchObject({
        state: 'incomplete',
        maxProbes: 64
      })
      expect(report.profileSqliteEvidence.statuses).toBeUndefined()
      expect(report.activationAvailable).toBe(false)
    })

    it('rejects symlinked and hardlinked database paths without following their contents', () => {
      const linked = fixture('linked')
      seedSqlite(linked.dbPath, linked.id)
      linkSync(linked.dbPath, join(linked.root, 'copy'))
      expect(
        inspectAshProfileCoverage(linked.root, {
          verifyProfileIndex: true,
          verifyProfileSqlite: true
        }).profileSqliteEvidence.statuses.unavailable
      ).toBe(1)
      const symlink = fixture('symlinked')
      symlinkSync('/etc/passwd', symlink.dbPath)
      expect(
        inspectAshProfileCoverage(symlink.root, {
          verifyProfileIndex: true,
          verifyProfileSqlite: true
        }).profileSqliteEvidence.statuses.unavailable
      ).toBe(1)
    })

    it('keeps default mode content-free and requires explicit index opt-in', () => {
      const { root, id, dbPath } = fixture()
      seedSqlite(dbPath, id)
      const plain = inspectAshProfileCoverage(root)
      expect(plain.profileSqliteEvidence).toBeUndefined()
      expect(plain.profileIndexReadAttempted).toBeUndefined()
      expect(() => inspectAshProfileCoverage(root, { verifyProfileSqlite: true })).toThrow(
        /requires verified profile-index opt-in/
      )
      const cli = spawnSync(
        process.execPath,
        [CLI, '--root', root, '--verify-profile-index', '--verify-profile-sqlite'],
        {
          encoding: 'utf8',
          timeout: 5_000
        }
      )
      expect(cli.status).toBe(0)
      expect(
        JSON.parse(cli.stdout).profileSqliteEvidence.statuses['schema-3-identity-observed']
      ).toBe(1)
      expect(cli.stdout).not.toContain(id)
      expect(cli.stdout).not.toContain(root)
    })
  }
)
