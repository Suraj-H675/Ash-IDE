// Only used by the isolated Linux cross-version AppImage smoke.
// No real user-data roots, credentials, or release activation are used here.
const assert = require('node:assert/strict')
const { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join, relative, sep } = require('node:path')

const PROFILE_ID = 'native-cross-version'

const {
  requireFixture,
  stopVerifiedFixtureDaemon,
  stopVerifiedFixtureApp,
  stopVerifiedFixtureXvfb
} = require('./ash-two-version-native-process-cleanup.cjs')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function profileState(root, out) {
  requireFixture(root)
  assert.ok(isAbsolute(out))
  const dbPath = join(root, 'profile', 'profiles', PROFILE_ID, 'profile-state.db')
  const database = require(join(out, 'main/persistence/profile-state/profile-state-database.js'))
  const documents = require(join(out, 'main/persistence/profile-state/profile-state-documents.js'))
  return {
    dbPath,
    read() {
      const opened = database.openProfileStateDatabaseReadOnly(dbPath, PROFILE_ID)
      try {
        return JSON.parse(documents.readProfileStateSnapshot(opened.db).json)
      } finally {
        opened.db.close()
      }
    },
    write(value) {
      const opened = database.openProfileStateDatabase(dbPath, PROFILE_ID)
      try {
        documents.importProfileStateJson(opened.db, JSON.stringify(value))
      } finally {
        opened.db.close()
      }
    }
  }
}

function assertThemeAndRetained(root, out, theme) {
  const state = profileState(root, out).read()
  assert.equal(state.settings?.theme, theme)
  assert.equal(state.other?.retained, true)
}

function seedProfile(root, out) {
  const profile = profileState(root, out)
  const index = require(join(out, 'shared/orca-profiles.js'))
  const userData = join(root, 'profile')
  mkdirSync(dirname(profile.dbPath), { recursive: true, mode: 0o700 })
  writeFileSync(
    join(userData, 'orca-profile-index.json'),
    JSON.stringify({
      schemaVersion: index.ORCA_PROFILE_INDEX_SCHEMA_VERSION,
      activeProfileId: PROFILE_ID,
      profiles: [{ ...index.createDefaultLocalOrcaProfile(Date.now()), id: PROFILE_ID }]
    }),
    { mode: 0o600 }
  )
  profile.write({ settings: { theme: 'light' }, other: { retained: true } })
}

function mutateProfile(root, out) {
  const profile = profileState(root, out)
  const state = profile.read()
  assert.equal(state.settings?.theme, 'light')
  assert.equal(state.other?.retained, true)
  // A real desktop launch expands minimal fixture state with valid defaults.
  // Preserve that complete current record; change only a supported preference.
  profile.write({ ...state, settings: { ...state.settings, theme: 'dark' } })
}

function assertCheckpoint(root, file) {
  requireFixture(root)
  const result = readJson(file)
  assert.equal(result.ok, true)
  assert.ok(result.result.id)
  const backupPath = result.result.path
  assert.ok(isAbsolute(backupPath))
  const profileRoot = join(root, 'profile', 'profiles', PROFILE_ID)
  const suffix = relative(profileRoot, backupPath)
  assert.ok(suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  const info = lstatSync(backupPath)
  assert.ok(info.isFile() && !info.isSymbolicLink())
  assert.equal(info.mode & 0o077, 0)
  process.stdout.write(`${result.result.id}\n`)
}

function statusIsReady(file, version) {
  const status = readJson(file)
  assert.equal(status.ok, true)
  assert.equal(status.result.runtime.appVersion, version)
  assert.equal(status.result.runtime.state, 'ready')
  assert.equal(status.result.app.desktopWindowStatus, 'available')
  assert.ok(Number.isSafeInteger(status.result.app.pid))
  assert.ok(status.result.app.pid > 0)
  process.stdout.write(`${status.result.app.pid}\n`)
}

function verifyPhase(root, name, version) {
  requireFixture(root)
  const file = (suffix) => readJson(join(root, `${name}.${suffix}.json`))
  const status = file('status')
  const native = file('x11-window')
  const settings = file('settings')
  const daemon = file('daemon-stop')
  const runtime = file('runtime-stop')
  const naturalExit = file('natural-exit')
  assert.equal(status.ok, true)
  assert.equal(status.result.runtime.appVersion, version)
  assert.equal(status.result.runtime.state, 'ready')
  assert.equal(status.result.app.desktopWindowStatus, 'available')
  assert.ok(Number.isSafeInteger(status.result.app.pid) && status.result.app.pid > 0)
  assert.equal(native.ok, true)
  assert.equal(native.nativeX11, true)
  assert.equal(native.class, 'com.ashide.desktop')
  assert.equal(native.pid, status.result.app.pid)
  assert.ok(native.width >= 500 && native.height >= 300)
  assert.equal(settings.ok, true)
  assert.equal(settings.settingsRead, true)
  assert.equal(daemon.ok, true)
  assert.equal(daemon.result.status, 'stopped')
  assert.equal(daemon.result.killedCount, 0) // No PTYs created in this fixture.
  assert.equal(
    daemon._meta?.runtimeId,
    status.result.runtime.runtimeId,
    'daemon stop must refer to the exact authenticated phase runtime'
  )
  assert.equal(runtime.ok, true)
  assert.equal(runtime.result.status, 'stopping')
  assert.equal(runtime.result.runtimeId, status.result.runtime.runtimeId)
  assert.ok(
    ['exited', 'already-exited'].includes(naturalExit.status),
    'a runtime.stop acceptance is not proof that the app exited'
  )
  return status.result.runtime.runtimeId
}

function verifySummary(root, previousVersion, candidateVersion) {
  requireFixture(root)
  for (const [label, version] of [
    ['previous', previousVersion],
    ['candidate', candidateVersion]
  ]) {
    const embedded = readJson(join(root, `${label}-embedded-receipt.json`))
    assert.equal(embedded.status, 'matched-offline-QA-only')
    assert.equal(embedded.version, version)
    assert.equal(embedded.embeddedRuntime, true)
    assert.equal(embedded.productionActivationAvailable, false)
  }
  const phases = [
    ['first-previous', previousVersion],
    ['second-candidate', candidateVersion],
    ['third-previous', previousVersion]
  ]
  const ids = phases.map(([name, version]) => verifyPhase(root, name, version))
  assert.equal(new Set(ids).size, phases.length)
  for (const name of [
    'seed',
    'after-first-read',
    'upgrade-write',
    'after-second-read',
    'rollback-checked',
    'final-read'
  ]) {
    assert.equal(readJson(join(root, `${name}.json`)).ok, true)
  }
  assert.equal(readJson(join(root, 'rollback.json')).ok, true)
  assert.equal(existsSync(join(root, 'profile', 'daemon', 'daemon-v55.pid')), false)
  return {
    status: 'PASS',
    nativeX11: true,
    actualAppVersions: [previousVersion, candidateVersion, previousVersion],
    separateRuntimeCount: ids.length,
    naturalRuntimeExitVerified: true,
    helperCodeFromVerifiedAppImages: true,
    restoredDisposableProfile: true,
    productionUpdaterActivated: false
  }
}

async function readSettings(compiledOut) {
  const { RuntimeClient } = require(join(compiledOut, 'cli', 'runtime', 'client.js'))
  const client = new RuntimeClient(process.env.ASH_USER_DATA_PATH)
  const result = await client.call('settings.get')
  assert.equal(result.ok, true)
  assert.ok(result.result?.settings && typeof result.result.settings === 'object')
  process.stdout.write(`${JSON.stringify({ ok: true, settingsRead: true })}\n`)
}

async function main(argv) {
  const [command, ...args] = argv
  switch (command) {
    case 'seed':
      seedProfile(args[0], args[1])
      break
    case 'mutate':
      mutateProfile(args[0], args[1])
      break
    case 'assert-before':
      assertThemeAndRetained(args[0], args[1], 'light')
      break
    case 'assert-after':
      assertThemeAndRetained(args[0], args[1], 'dark')
      break
    case 'checkpoint-id':
      assertCheckpoint(args[0], args[1])
      return
    case 'status':
      statusIsReady(args[0], args[1])
      return
    case 'settings':
      await readSettings(args[0])
      return
    case 'verify-summary':
      process.stdout.write(`${JSON.stringify(verifySummary(...args))}\n`)
      return
    case 'stop-fixture-daemon':
      stopVerifiedFixtureDaemon(args[0])
      return
    case 'stop-fixture-app':
      stopVerifiedFixtureApp(args[0], Number(args[1]), args[2])
      return
    case 'stop-fixture-xvfb':
      stopVerifiedFixtureXvfb(args[0], Number(args[1]), args[2])
      return
    default:
      throw new Error('Unknown native two-version QA operation')
  }
  process.stdout.write(`${JSON.stringify({ ok: true, operation: command })}\n`)
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[native-two-version-qa] ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { main, verifyPhase }
