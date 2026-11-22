// QA-only pidfd signaling. Never send a signal through a reusable numeric PID.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { lstatSync, readFileSync } = require('node:fs')
const { join, isAbsolute } = require('node:path')

function requireFixture(root) {
  assert.match(root, /^\/var\/tmp\/ashcross\.[A-Za-z0-9]{6}$/)
  const info = lstatSync(root)
  assert.ok(info.isDirectory() && !info.isSymbolicLink())
  assert.equal(info.uid, process.getuid())
  assert.equal(info.mode & 0o777, 0o700)
  assert.equal(
    readFileSync(join(root, '.ash-native-cross-version-fixture'), 'utf8'),
    'Test-owned Ash IDE native cross-version fixture\n'
  )
  return root
}

function signalBoundInstance(kind, root, pid, ticks) {
  requireFixture(root)
  assert.ok(['daemon', 'app', 'xvfb'].includes(kind))
  assert.ok(Number.isSafeInteger(pid) && pid > 1)
  assert.match(String(ticks), /^[1-9]\d*$/)
  const result = spawnSync(
    'python3',
    [
      join(__dirname, 'ash-two-version-native-pidfd.py'),
      'signal',
      kind,
      root,
      String(pid),
      String(ticks)
    ],
    { encoding: 'utf8', timeout: 8_000, maxBuffer: 64 * 1024 }
  )
  if (result.error || result.status !== 0) {
    throw new Error(`Refused ${kind} signal: ${result.error?.message ?? result.stderr?.trim()}`)
  }
  return JSON.parse(result.stdout)
}

function stopVerifiedFixtureDaemon(recordPath) {
  assert.ok(isAbsolute(recordPath))
  const root = requireFixture(join(recordPath, '..', '..', '..'))
  assert.equal(recordPath, join(root, 'profile', 'daemon', 'daemon-v55.pid'))
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  return signalBoundInstance('daemon', root, record.pid, record.linuxStartTicks)
}

function stopVerifiedFixtureApp(root, pid, startTicks) {
  return signalBoundInstance('app', root, pid, startTicks)
}

function stopVerifiedFixtureXvfb(root, pid, startTicks) {
  return signalBoundInstance('xvfb', root, pid, startTicks)
}

module.exports = {
  requireFixture,
  stopVerifiedFixtureDaemon,
  stopVerifiedFixtureApp,
  stopVerifiedFixtureXvfb
}
