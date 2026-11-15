// Seed/read ONLY a marker-verified, freshly created Ash native-X11 QA profile.
// This uses Ash's real default state and legacy JSON importer; it never edits
// a running database, a user profile, or another application's state.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const [mode, root, defaultStateModule, preference] = process.argv.slice(2)
assert.ok(mode === 'seed' || mode === 'verify', 'expected seed or verify')
assert.ok(preference === 'global' || preference === 'agent-complete', 'unknown test-only opt-out')
assert.match(root ?? '', /^\/var\/tmp\/ashx11\.[A-Za-z0-9]{6}$/)
const fixture = fs.statSync(root)
assert.equal(fixture.uid, process.getuid())
assert.equal(fixture.mode & 0o777, 0o700)
assert.equal(fs.existsSync(path.join(root, '.ash-desktop-lifecycle-fixture')), true)
assert.equal(process.env.ASH_USER_DATA_PATH, path.join(root, 'profile'))
const profileDir = path.join(root, 'profile', 'profiles', 'local-default')
const legacyState = path.join(profileDir, 'orca-data.json')
const stateDatabase = path.join(profileDir, 'profile-state.db')

if (mode === 'seed') {
  assert.equal(fs.existsSync(stateDatabase), false, 'cannot modify an existing profile state DB')
  assert.equal(fs.existsSync(legacyState), false, 'cannot replace existing profile state')
  assert.equal(path.resolve(defaultStateModule), path.join(root, 'private-settings-defaults.cjs'))
  const { getDefaultPersistedState } = require(defaultStateModule)
  const state = getDefaultPersistedState(path.join(root, 'home'))
  assert.equal(state.settings.notifications.enabled, true, 'baseline defaults changed unexpectedly')
  assert.equal(state.settings.notifications.agentTaskComplete, true)
  if (preference === 'global') {
    state.settings.notifications.enabled = false
  } else {
    state.settings.notifications.agentTaskComplete = false
  }
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(legacyState, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(
    JSON.stringify({
      ok: true,
      seededPrivateProfile: true,
      preference,
      notificationsEnabled: state.settings.notifications.enabled,
      agentTaskComplete: state.settings.notifications.agentTaskComplete
    })
  )
} else {
  // The packaged main process migrates the initial JSON using its real schema,
  // hashes and revision fences. Verify its durable setting without mutation.
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(stateDatabase, { readOnly: true })
  try {
    const row = db
      .prepare("SELECT payload,content_hash FROM profile_state_documents WHERE domain='settings'")
      .get()
    assert.ok(row, 'packaged app did not migrate private settings')
    assert.equal(createHash('sha256').update(row.payload).digest('hex'), row.content_hash)
    const settings = JSON.parse(row.payload)
    assert.equal(settings.notifications?.enabled, preference !== 'global')
    assert.equal(settings.notifications?.agentTaskComplete, preference !== 'agent-complete')
    console.log(
      JSON.stringify({
        ok: true,
        loadedDisabledPreference: true,
        preference,
        notificationsEnabled: settings.notifications.enabled,
        agentTaskComplete: settings.notifications.agentTaskComplete
      })
    )
  } finally {
    db.close()
  }
}
