// Identity-bound cleanup for disposable Ash native X11 process fixtures.
const assert = require('node:assert/strict')
const { existsSync, lstatSync, readFileSync } = require('node:fs')
const { join, isAbsolute } = require('node:path')

function requireFixture(root) {
  assert.match(root, /^\/var\/tmp\/ashcross\.[A-Za-z0-9]{6}$/)
  const info = lstatSync(root)
  assert.ok(info.isDirectory() && !info.isSymbolicLink())
  assert.equal(info.uid, process.getuid())
  assert.equal(info.mode & 0o777, 0o700)
  return root
}

function stopVerifiedFixtureDaemon(recordPath) {
  assert.ok(isAbsolute(recordPath))
  const root = requireFixture(join(recordPath, '..', '..', '..'))
  assert.equal(recordPath, join(root, 'profile', 'daemon', 'daemon-v55.pid'))
  if (!existsSync(recordPath)) {
    return
  }
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1)
  try {
    const command = readFileSync(`/proc/${record.pid}/cmdline`, 'utf8').split('\0')
    const stat = readFileSync(`/proc/${record.pid}/stat`, 'utf8')
      .split(') ')
      .at(-1)
      .trim()
      .split(' ')
    assert.ok(command.some((arg) => arg.endsWith('/daemon-entry.js')))
    assert.ok(command[0].startsWith(`${root}/home/.cache/ash-ide/appimage/`))
    assert.ok(command.indexOf('--pid-record') > 0)
    assert.ok(command.indexOf('--token') > 0)
    assert.equal(command[command.indexOf('--pid-record') + 1], recordPath)
    assert.equal(
      command[command.indexOf('--token') + 1],
      join(root, 'profile', 'daemon', 'daemon-v55.token')
    )
    const uid = Number(
      readFileSync(`/proc/${record.pid}/status`, 'utf8').match(/^Uid:\s+(\d+)/m)?.[1]
    )
    assert.equal(uid, process.getuid())
    assert.equal(stat[19], record.linuxStartTicks)
    process.kill(record.pid, 'SIGTERM')
    console.error('[native-two-version-qa] signaled verified test-owned daemon')
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ESRCH') {
      throw error
    }
  }
}

function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1)
  const status = readFileSync(`/proc/${pid}/status`, 'utf8')
  assert.equal(Number(status.match(/^Uid:\s+(\d+)/m)?.[1]), process.getuid())
  return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
}

function stopVerifiedFixtureApp(root, pid) {
  requireFixture(root)
  try {
    const command = processIdentity(pid)
    const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
    assert.ok(env.includes(`ASH_USER_DATA_PATH=${root}/profile`))
    assert.ok(command.some((arg) => arg.includes('ash-ide')))
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ESRCH') {
      throw error
    }
  }
}

function stopVerifiedFixtureXvfb(root, pid) {
  requireFixture(root)
  try {
    const command = processIdentity(pid)
    assert.match(command[0], /(?:^|\/)Xvfb$/)
    assert.ok(command.indexOf('-auth') > 0)
    assert.equal(command[command.indexOf('-auth') + 1], join(root, 'Xauthority'))
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ESRCH') {
      throw error
    }
  }
}

module.exports = {
  requireFixture,
  stopVerifiedFixtureDaemon,
  stopVerifiedFixtureApp,
  stopVerifiedFixtureXvfb
}
