'use strict'

// Isolated, disposable QA reader. fd 3 is a pre-opened database descriptor,
// never a user-supplied pathname. Do not emit profile IDs or database content.
const { readFileSync } = require('node:fs')
const { DatabaseSync } = require('node:sqlite')

const SCHEMA_VERSION = 3
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const COLUMNS = {
  profile_state_meta: ['key', 'value'],
  profile_state_documents: [
    'domain',
    'payload',
    'domain_version',
    'revision',
    'updated_at',
    'content_hash'
  ],
  profile_state_automation_runs_meta: [
    'domain',
    'presence',
    'domain_version',
    'revision',
    'updated_at',
    'content_hash'
  ],
  profile_state_automation_runs: [
    'run_id',
    'ordinal',
    'payload',
    'content_hash',
    'revision',
    'updated_at'
  ]
}
// A minimum matching name list is insufficient; preserve the production
// column type, NOT NULL, and primary-key contracts.
const PRIMARY_KEYS = new Set([
  'profile_state_meta.key',
  'profile_state_documents.domain',
  'profile_state_automation_runs_meta.domain',
  'profile_state_automation_runs.run_id'
])
const INTEGER_COLUMNS = new Set([
  'profile_state_documents.domain_version',
  'profile_state_documents.revision',
  'profile_state_documents.updated_at',
  'profile_state_automation_runs_meta.domain_version',
  'profile_state_automation_runs_meta.revision',
  'profile_state_automation_runs_meta.updated_at',
  'profile_state_automation_runs.ordinal',
  'profile_state_automation_runs.revision',
  'profile_state_automation_runs.updated_at'
])

function inspect(db, profileId) {
  const version = db.prepare('PRAGMA user_version').get()?.user_version
  if (!Number.isSafeInteger(version) || version !== SCHEMA_VERSION) {
    return 'unsupported-schema'
  }
  const check = db.prepare('PRAGMA quick_check(1)').all()
  if (check.length !== 1 || check[0]?.quick_check !== 'ok') {
    return 'integrity-unproven'
  }
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all()
    const byName = new Map(actual.map((column) => [column.name, column]))
    if (
      actual.length < columns.length ||
      columns.some((name) => {
        const observed = byName.get(name)
        const full = `${table}.${name}`
        return (
          !observed ||
          observed.type !== (INTEGER_COLUMNS.has(full) ? 'INTEGER' : 'TEXT') ||
          observed.notnull !== 1 ||
          observed.pk !== (PRIMARY_KEYS.has(full) ? 1 : 0)
        )
      })
    ) {
      return 'unsupported-schema'
    }
  }
  const row = db.prepare("SELECT value FROM profile_state_meta WHERE key = 'profile_id'").get()
  return row?.value === profileId ? 'schema-3-identity-observed' : 'identity-mismatch'
}

function main() {
  const profileId = readFileSync(0, 'utf8')
  if (profileId.length > 128 || !PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error('invalid profile identity')
  }
  const db = new DatabaseSync('file:/proc/self/fd/3?mode=ro&immutable=1', {
    readOnly: true,
    enableForeignKeyConstraints: false
  })
  try {
    return inspect(db, profileId)
  } finally {
    db.close()
  }
}

try {
  process.stdout.write(`${JSON.stringify({ state: main() })}\n`)
} catch {
  process.stdout.write('{"state":"unavailable"}\n')
}
