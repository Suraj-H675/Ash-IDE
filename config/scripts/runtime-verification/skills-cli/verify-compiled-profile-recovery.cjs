// Production JavaScript build gate: exercise checkpoint + rollback through the
// compiled CLI, not a mocked handler or a source-only test.
const { spawnSync } = require('node:child_process')
const {
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

function verifyCompiledProfileRecovery(outDir = 'out') {
  const output = resolve(outDir)
  const cli = join(output, 'cli', 'index.js')
  const compiled = (name) => require(join(output, 'main', 'persistence', 'profile-state', name))
  const database = compiled('profile-state-database.js')
  const documents = compiled('profile-state-documents.js')
  const { ORCA_PROFILE_INDEX_SCHEMA_VERSION, createDefaultLocalOrcaProfile } = require(
    join(output, 'shared', 'orca-profiles.js')
  )
  if (!existsSync(cli)) {
    throw new Error('[profile-recovery-smoke] compiled Ash CLI entry is missing')
  }

  const fixture = mkdtempSync(join(tmpdir(), 'ash-compiled-profile-recovery-'))
  try {
    const userData = join(fixture, 'userdata')
    const runtime = join(fixture, 'runtime')
    const fixtureTmp = join(fixture, 'temp')
    const roaming = join(fixture, 'AppData', 'Roaming')
    const localAppData = join(fixture, 'AppData', 'Local')
    const profileId = 'compiled-smoke'
    const profileDirectory = join(userData, 'profiles', profileId)
    const databasePath = join(profileDirectory, 'profile-state.db')
    mkdirSync(profileDirectory, { recursive: true, mode: 0o700 })
    mkdirSync(runtime, { mode: 0o700 })
    mkdirSync(fixtureTmp, { mode: 0o700 })
    const original = { settings: { theme: 'before-checkpoint' }, other: { retained: true } }
    const changed = { settings: { theme: 'after-checkpoint' }, other: { retained: true } }
    const env = {
      // Never forward provider secrets, account routes or unrelated runtime
      // settings to a release-build fixture. Windows native loading still needs
      // its normal OS system paths and executable search path.
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      WINDIR: process.env.WINDIR ?? '',
      ComSpec: process.env.ComSpec ?? '',
      HOME: fixture,
      USERPROFILE: fixture,
      XDG_CONFIG_HOME: join(fixture, 'config'),
      XDG_CACHE_HOME: join(fixture, 'cache'),
      XDG_DATA_HOME: join(fixture, 'data'),
      XDG_STATE_HOME: join(fixture, 'state'),
      XDG_RUNTIME_DIR: runtime,
      TMPDIR: fixtureTmp,
      TMP: fixtureTmp,
      TEMP: fixtureTmp,
      APPDATA: roaming,
      LOCALAPPDATA: localAppData,
      ASH_USER_DATA_PATH: userData,
      ASH_DEV_USER_DATA_PATH: userData,
      ORCA_USER_DATA_PATH: userData,
      NODE_PATH: ''
    }
    function runCli(...args) {
      const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
        cwd: fixture,
        env,
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 1024 * 1024
      })
      if (result.error || result.status !== 0) {
        throw new Error(
          `[profile-recovery-smoke] compiled CLI ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout}`
        )
      }
      const parsed = JSON.parse(result.stdout)
      if (parsed.ok !== true) {
        throw new Error(
          '[profile-recovery-smoke] compiled CLI reported unsuccessful profile recovery'
        )
      }
      return parsed.result
    }

    function writeState(state, expectedRevision) {
      const opened = database.openProfileStateDatabase(databasePath, profileId)
      try {
        documents.importProfileStateJson(
          opened.db,
          JSON.stringify(state),
          expectedRevision === undefined ? undefined : { expectedRevision }
        )
      } finally {
        opened.db.close()
      }
    }

    function readState() {
      const opened = database.openProfileStateDatabaseReadOnly(databasePath, profileId)
      try {
        return JSON.parse(documents.readProfileStateSnapshot(opened.db).json)
      } finally {
        opened.db.close()
      }
    }

    const sentinels = [
      join(fixture, '.claude', 'settings.json'),
      join(fixture, '.codex', 'auth.json'),
      join(roaming, 'Code', 'User', 'settings.json'),
      join(localAppData, 'provider-profile', 'state.json'),
      join(fixture, 'projects', 'user-repository', '.git', 'config')
    ]
    for (const file of sentinels) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      writeFileSync(file, 'unrelated provider or project state', { mode: 0o600 })
    }
    const localProfile = { ...createDefaultLocalOrcaProfile(Date.now()), id: profileId }
    writeFileSync(
      join(userData, 'orca-profile-index.json'),
      JSON.stringify({
        schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
        activeProfileId: profileId,
        profiles: [localProfile]
      }),
      { mode: 0o600 }
    )
    writeState(original)
    const checkpoint = runCli('profile', 'state', 'checkpoint', '--profile-id', profileId)
    const backupPath = checkpoint.path
    const backupStat = statSync(backupPath)
    const suffix = relative(profileDirectory, backupPath)
    let windowsBackupPrivate = true
    if (process.platform === 'win32') {
      const { readPrivateWindowsFile } = require(
        join(output, 'shared', 'secure-path-windows-acl.js')
      )
      const verifiedBytes = readPrivateWindowsFile(backupPath, Math.max(1, backupStat.size))
      windowsBackupPrivate = Buffer.isBuffer(verifiedBytes)
    }
    if (
      !checkpoint.id ||
      !isAbsolute(backupPath) ||
      !suffix ||
      suffix === '..' ||
      suffix.startsWith(`..${sep}`) ||
      isAbsolute(suffix) ||
      !backupStat.isFile() ||
      !windowsBackupPrivate ||
      (process.platform !== 'win32' && (backupStat.mode & 0o077) !== 0)
    ) {
      throw new Error('[profile-recovery-smoke] checkpoint was not private or in the test profile')
    }
    writeState(changed, 1)
    if (readState().settings.theme !== 'after-checkpoint') {
      throw new Error('[profile-recovery-smoke] fixture did not advance its revision')
    }
    runCli('profile', 'state', 'rollback', '--backup', checkpoint.id, '--profile-id', profileId)
    if (JSON.stringify(readState()) !== JSON.stringify(original)) {
      throw new Error('[profile-recovery-smoke] compiled CLI failed to restore prior state')
    }
    for (const file of sentinels) {
      if (readFileSync(file, 'utf8') !== 'unrelated provider or project state') {
        throw new Error('[profile-recovery-smoke] unrelated provider or project data was changed')
      }
    }
    console.log('[profile-recovery-smoke] compiled CLI checkpoint and rollback passed')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    verifyCompiledProfileRecovery(process.argv[2] ?? 'out')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

module.exports = { verifyCompiledProfileRecovery }
