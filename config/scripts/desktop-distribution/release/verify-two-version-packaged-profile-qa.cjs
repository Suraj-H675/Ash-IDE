#!/usr/bin/env node
// Offline QA only: exercise two genuine packaged CLI builds against disposable profile data.
// Not an installer, migration mechanism, provider-session fence, or release trust verifier.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')

const SHA256_RE = /^[a-f0-9]{64}$/
const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/

function parseArgs(argv) {
  const allowed = [
    'previous-resources',
    'candidate-resources',
    'previous-artifact',
    'candidate-artifact',
    'previous-report',
    'candidate-report',
    'previous-version',
    'candidate-version',
    'previous-sha256',
    'candidate-sha256'
  ]
  const options = {}
  if (argv.length !== allowed.length * 2) {
    throw new Error('All ten two-version QA inputs are required')
  }
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    if (
      !flag?.startsWith('--') ||
      !allowed.includes(flag.slice(2)) ||
      options[flag.slice(2)] !== undefined ||
      !argv[i + 1]
    ) {
      throw new Error('Unknown or repeated two-version QA input')
    }
    options[flag.slice(2)] = argv[i + 1]
  }
  return options
}

async function sha256File(path) {
  const info = statSync(path)
  assert.ok(info.isFile() && info.size > 0, 'QA input must be a nonempty file')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function verifyPackagedVersion(options, prefix) {
  const get = (key) => options[`${prefix}-${key}`]
  const version = get('version')
  const sha256 = get('sha256')
  assert.match(version, VERSION_RE)
  assert.match(sha256, SHA256_RE)
  for (const field of ['resources', 'artifact', 'report']) {
    assert.ok(isAbsolute(get(field)), 'QA inputs must use absolute paths')
  }
  const resources = resolve(get('resources'))
  const report = JSON.parse(readFileSync(get('report'), 'utf8'))
  const identity = JSON.parse(
    readFileSync(join(resources, 'ash-package-input-identity.json'), 'utf8')
  )
  const packagedOut = join(resources, 'app.asar.unpacked', 'out')
  const compiledPackagePath = join(packagedOut, 'package.json')
  const compiledPackageBytes = readFileSync(compiledPackagePath)
  const compiledPackage = JSON.parse(compiledPackageBytes.toString('utf8'))
  assert.equal(report.checkpoint?.outcome, 'matched')
  assert.equal(report.outerArtifact?.sha256, sha256)
  assert.equal(report.outerArtifact?.sha256VerifiedBefore, true)
  assert.equal(report.outerArtifact?.sha256VerifiedAfter, true)
  assert.equal(report.outerArtifact?.architecture, identity.architecture)
  assert.equal(report.candidateIdentity?.state, 'unverified')
  assert.equal(report.activationAvailable, false)
  assert.equal(report.ashPackageIdentityVerified, false)
  assert.equal(identity.appId, 'com.ashide.desktop')
  assert.equal(identity.evidenceKind, 'packaging-input-snapshot')
  assert.equal(identity.version, version)
  assert.equal(report.embeddedIdentity?.version, version)
  assert.equal(report.embeddedIdentity?.appId, identity.appId)
  assert.equal(report.embeddedIdentity?.sourceCommit, identity.sourceCommit)
  assert.equal(report.embeddedIdentity?.capturedAppAsarSha256, identity.capturedAppAsarSha256)
  assert.equal(report.embeddedIdentity?.appAsarSha256, identity.capturedAppAsarSha256)
  assert.equal(
    report.embeddedIdentity?.capturedCompiledCliPackageJsonSha256,
    identity.capturedCompiledCliPackageJsonSha256
  )
  assert.equal(
    report.embeddedIdentity?.compiledCliPackageJsonSha256,
    identity.capturedCompiledCliPackageJsonSha256
  )
  assert.equal(compiledPackage.name, 'ash-ide-compiled-output')
  assert.equal(compiledPackage.version, version)
  assert.equal(compiledPackage.private, true)
  assert.equal(compiledPackage.type, 'commonjs')
  assert.equal(await sha256File(get('artifact')), sha256)
  assert.equal(await sha256File(join(resources, 'app.asar')), identity.capturedAppAsarSha256)
  assert.equal(
    createHash('sha256').update(compiledPackageBytes).digest('hex'),
    identity.capturedCompiledCliPackageJsonSha256
  )
  for (const name of [
    'cli/index.js',
    'main/persistence/profile-state/profile-state-database.js',
    'main/persistence/profile-state/profile-state-documents.js',
    'shared/orca-profiles.js'
  ]) {
    assert.ok(existsSync(join(packagedOut, name)), 'Required packaged CLI dependency missing')
  }
  return { version, sha256, out: packagedOut }
}

function exerciseDisposableProfile(previous, candidate) {
  const fixture = mkdtempSync(join(tmpdir(), 'ash-two-version-packaged-profile-'))
  try {
    const profileId = 'two-version-qa'
    const userData = join(fixture, 'userdata')
    const profileDirectory = join(userData, 'profiles', profileId)
    const dbPath = join(profileDirectory, 'profile-state.db')
    const runtime = join(fixture, 'runtime')
    const temp = join(fixture, 'temp')
    const sentinel = join(fixture, 'provider-sentinel', 'state.json')
    for (const dir of [profileDirectory, runtime, temp, dirname(sentinel)]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    writeFileSync(sentinel, 'unrelated provider state', { mode: 0o600 })
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: fixture,
      USERPROFILE: fixture,
      XDG_CONFIG_HOME: join(fixture, 'config'),
      XDG_CACHE_HOME: join(fixture, 'cache'),
      XDG_DATA_HOME: join(fixture, 'data'),
      XDG_STATE_HOME: join(fixture, 'state'),
      XDG_RUNTIME_DIR: runtime,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      APPDATA: join(fixture, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(fixture, 'AppData', 'Local'),
      ASH_USER_DATA_PATH: userData,
      ASH_DEV_USER_DATA_PATH: userData,
      ORCA_USER_DATA_PATH: userData,
      NODE_PATH: ''
    }
    const moduleAt = (build, name) => require(join(build.out, name))
    const { createDefaultLocalOrcaProfile, ORCA_PROFILE_INDEX_SCHEMA_VERSION } = moduleAt(
      previous,
      'shared/orca-profiles.js'
    )
    writeFileSync(
      join(userData, 'orca-profile-index.json'),
      JSON.stringify({
        schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
        activeProfileId: profileId,
        profiles: [{ ...createDefaultLocalOrcaProfile(Date.now()), id: profileId }]
      }),
      { mode: 0o600 }
    )
    function runCli(build, ...args) {
      const result = spawnSync(
        process.execPath,
        [join(build.out, 'cli', 'index.js'), ...args, '--json'],
        {
          cwd: fixture,
          env,
          encoding: 'utf8',
          timeout: 20_000,
          maxBuffer: 1024 * 1024
        }
      )
      assert.equal(result.status, 0, `Packaged ${build.version} profile command failed`)
      const parsed = JSON.parse(result.stdout)
      assert.equal(parsed.ok, true)
      return parsed.result
    }
    function writeState(build, value, revision) {
      const db = moduleAt(
        build,
        'main/persistence/profile-state/profile-state-database.js'
      ).openProfileStateDatabase(dbPath, profileId)
      try {
        moduleAt(
          build,
          'main/persistence/profile-state/profile-state-documents.js'
        ).importProfileStateJson(
          db.db,
          JSON.stringify(value),
          revision === undefined ? undefined : { expectedRevision: revision }
        )
      } finally {
        db.db.close()
      }
    }
    function readState(build) {
      const db = moduleAt(
        build,
        'main/persistence/profile-state/profile-state-database.js'
      ).openProfileStateDatabaseReadOnly(dbPath, profileId)
      try {
        return JSON.parse(
          moduleAt(
            build,
            'main/persistence/profile-state/profile-state-documents.js'
          ).readProfileStateSnapshot(db.db).json
        )
      } finally {
        db.db.close()
      }
    }
    function assertCheckpoint(checkpoint) {
      assert.ok(checkpoint.id && isAbsolute(checkpoint.path))
      const inside = relative(profileDirectory, checkpoint.path)
      assert.ok(inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
      const info = statSync(checkpoint.path)
      assert.ok(info.isFile())
      assert.equal(info.mode & 0o077, 0)
    }
    const original = { settings: { theme: 'previous-build' }, other: { retained: true } }
    const changed = { settings: { theme: 'candidate-build' }, other: { retained: true } }
    writeState(previous, original)
    assert.deepEqual(readState(previous), original)
    const oldBackup = runCli(previous, 'profile', 'state', 'checkpoint', '--profile-id', profileId)
    assertCheckpoint(oldBackup)
    assert.deepEqual(readState(candidate), original)
    writeState(candidate, changed, 1)
    assert.deepEqual(readState(candidate), changed)
    const newBackup = runCli(candidate, 'profile', 'state', 'checkpoint', '--profile-id', profileId)
    assertCheckpoint(newBackup)
    assert.deepEqual(readState(previous), changed)
    runCli(
      previous,
      'profile',
      'state',
      'rollback',
      '--backup',
      oldBackup.id,
      '--profile-id',
      profileId
    )
    assert.deepEqual(readState(previous), original)
    assert.deepEqual(readState(candidate), original)
    assert.equal(readFileSync(sentinel, 'utf8'), 'unrelated provider state')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

async function verifyTwoVersionPackagedProfileRecovery(options) {
  if (process.platform !== 'linux') {
    throw new Error('Two-version packaged profile QA currently requires Linux')
  }
  const previous = await verifyPackagedVersion(options, 'previous')
  const candidate = await verifyPackagedVersion(options, 'candidate')
  const parts = [previous.version, candidate.version].map((v) => v.split('.').map(Number))
  assert.ok(
    parts[1].some((n, i) => n !== parts[0][i]),
    'Versions must differ'
  )
  const firstDifference = parts[1].findIndex((n, i) => n !== parts[0][i])
  assert.ok(parts[1][firstDifference] > parts[0][firstDifference], 'Candidate must be newer')
  assert.notEqual(previous.sha256, candidate.sha256)
  exerciseDisposableProfile(previous, candidate)
  return {
    status: 'PASS',
    versions: [previous.version, candidate.version],
    tested: 'packaged CLI checkpoint, cross-version SQLite read/write, rollback, sentinel',
    productionActivationAvailable: false
  }
}

if (require.main === module) {
  verifyTwoVersionPackagedProfileRecovery(parseArgs(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(`[two-version-profile-qa] ${error.message}`)
      process.exitCode = 1
    })
}

module.exports = { parseArgs, verifyTwoVersionPackagedProfileRecovery }
