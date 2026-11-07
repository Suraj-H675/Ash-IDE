#!/usr/bin/env node
// Seeds an empty Ash dev profile from a disposable source path explicitly selected by the caller.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  getWorktreeDevProfilesRoot,
  readDevInstanceRecord,
  resolveDevProfile,
  sameFilesystemPath
} from '../instance-isolation/dev-instance-isolation.mjs'
import { isProcessAlive } from '../remote-session-cleanup/remote-agent-session-process-cleanup.mjs'

// Only local workspace and appearance data may be copied. Credentials, SSH targets, active sessions,
// schedules, and telemetry stay out of Ash dev profiles.
export const SEEDED_PROFILE_STATE_DOMAINS = [
  'schemaVersion',
  'repos',
  'projects',
  'projectGroups',
  'folderWorkspaces',
  'sparsePresetsByRepo',
  'worktreeMeta',
  'worktreeMetaByIdentity',
  'worktreeIdentityAliases',
  'worktreeLineageById',
  'workspaceLineageByChildKey',
  'settings',
  'ui',
  'onboarding'
]
const PROFILE_INDEX_FILE = 'orca-profile-index.json'
const LEGACY_DATA_FILE = 'orca-data.json'
const PROFILE_STATE_DATABASE_FILE = 'profile-state.db'
const PROFILE_ID_PATTERN = /^[A-Za-z0-9._-]+$/
export const SEED_RECEIPT_FILE = 'ash-dev-seed.json'

export function profileHasState(userDataPath) {
  return (
    existsSync(path.join(userDataPath, PROFILE_INDEX_FILE)) ||
    existsSync(path.join(userDataPath, 'profiles')) ||
    existsSync(path.join(userDataPath, LEGACY_DATA_FILE))
  )
}

async function readProfileStateDatabaseDomains(databasePath) {
  const { DatabaseSync } = await import('node:sqlite')
  // Why readOnly: the source may belong to a running Orca; a reader never writes its pages.
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const domains = {}
    for (const row of db.prepare('SELECT domain, payload FROM profile_state_documents').all()) {
      domains[row.domain] = JSON.parse(row.payload)
    }
    return domains
  } finally {
    db.close()
  }
}

async function readProfileDomains(profileDir) {
  const databasePath = path.join(profileDir, PROFILE_STATE_DATABASE_FILE)
  if (existsSync(databasePath)) {
    return readProfileStateDatabaseDomains(databasePath)
  }
  const legacyPath = path.join(profileDir, LEGACY_DATA_FILE)
  return existsSync(legacyPath) ? JSON.parse(readFileSync(legacyPath, 'utf8')) : null
}

function pickSeededDomains(domains) {
  const picked = {}
  for (const domain of SEEDED_PROFILE_STATE_DOMAINS) {
    if (domains[domain] !== undefined) {
      picked[domain] = domains[domain]
    }
  }
  return picked
}

function writePrivateJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  writeFileSync(filePath, JSON.stringify(value), { mode: 0o600 })
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// Seed legacy JSON for first-launch SQLite migration; never copy live databases or write to sourceDir.
export async function seedDevProfile({ sourceDir, targetDir, report = console.error }) {
  if (!profileHasState(sourceDir)) {
    throw new Error(`Seed source has no Orca profile state: ${sourceDir}`)
  }
  if (isInside(sourceDir, targetDir) || isInside(targetDir, sourceDir)) {
    throw new Error('Seed source and target must be separate directories')
  }
  if (profileHasState(targetDir)) {
    throw new Error(`Target profile already has state: ${targetDir}`)
  }
  mkdirSync(targetDir, { recursive: true, mode: 0o700 })

  const seededProfiles = []
  const indexPath = path.join(sourceDir, PROFILE_INDEX_FILE)
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    const profileIds = (Array.isArray(index?.profiles) ? index.profiles : [])
      .map((profile) => profile?.id)
      .filter((id) => typeof id === 'string' && PROFILE_ID_PATTERN.test(id))
    for (const profileId of profileIds) {
      const sourceProfileDir = path.join(sourceDir, 'profiles', profileId)
      const targetProfileDir = path.join(targetDir, 'profiles', profileId)
      const domains = await readProfileDomains(sourceProfileDir)
      if (domains) {
        writePrivateJson(path.join(targetProfileDir, LEGACY_DATA_FILE), pickSeededDomains(domains))
      }
      seededProfiles.push(profileId)
    }
    writePrivateJson(path.join(targetDir, PROFILE_INDEX_FILE), index)
  } else {
    // Pre-profile layout: the Ash dev app reads the root data file itself.
    const domains = JSON.parse(readFileSync(path.join(sourceDir, LEGACY_DATA_FILE), 'utf8'))
    writePrivateJson(path.join(targetDir, LEGACY_DATA_FILE), pickSeededDomains(domains))
  }
  writePrivateJson(path.join(targetDir, SEED_RECEIPT_FILE), {
    version: 1,
    sourceDir: path.resolve(sourceDir),
    seededAt: new Date().toISOString(),
    profiles: seededProfiles
  })
  report(
    `[ash-ide-dev] Seeded ${targetDir} from ${sourceDir} (${seededProfiles.length || 'legacy'} profile(s))`
  )
}

function parseArgs(argv) {
  const options = { reset: false }
  for (const arg of argv) {
    if (arg === '--reset') {
      options.reset = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length)
    } else if (arg.startsWith('--to=')) {
      options.to = arg.slice('--to='.length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function assertResettable(targetDir, repoRoot) {
  const underWorktreeProfiles = isInside(getWorktreeDevProfilesRoot(), targetDir)
  if (!underWorktreeProfiles || sameFilesystemPath(getWorktreeDevProfilesRoot(), targetDir)) {
    throw new Error(`--reset only removes per-worktree dev profiles; delete ${targetDir} yourself`)
  }
  const record = readDevInstanceRecord(repoRoot)
  if (
    record &&
    sameFilesystemPath(record.userData, targetDir) &&
    Number.isInteger(record.runnerPid) &&
    isProcessAlive(record.runnerPid)
  ) {
    throw new Error('Stop this worktree’s `pnpm dev` before resetting its profile')
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      [
        'Usage: pnpm dev:seed-profile --from=<disposable profile dir> [--to=<profile dir>] [--reset]',
        '',
        'Copies local projects, workspaces, and settings from the explicitly selected source into an',
        'empty Ash dev profile. No installed-app profile or credential files are selected implicitly.',
        'Default --to: this',
        "worktree's `pnpm dev` profile. --reset first deletes an existing per-worktree profile."
      ].join('\n')
    )
    return
  }
  const repoRoot = path.resolve(import.meta.dirname, '../../../..')
  if (!options.from) {
    throw new Error('Pass --from=<disposable profile dir>; no profile is selected implicitly')
  }
  const targetDir = path.resolve(
    options.to ??
      resolveDevProfile({ repoRoot, instanceKey: process.env.ASH_DEV_INSTANCE_KEY }).userDataPath
  )
  const sourceDir = path.resolve(options.from)
  if (options.reset && existsSync(targetDir)) {
    assertResettable(targetDir, repoRoot)
    rmSync(targetDir, { recursive: true, force: true })
  }
  await seedDevProfile({ sourceDir, targetDir })
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`[ash-ide-dev] ${error.message}`)
    process.exitCode = 1
  })
}
