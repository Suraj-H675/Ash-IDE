#!/usr/bin/env node
// Run deb/rpm maintainer scripts on a private, rewritten fixture tree only.
// Never execute the package's actual install/remove hooks against /usr or /opt.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  chmodSync,
  unlinkSync,
  existsSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../../../..')
const sourceDir = join(repo, 'resources/linux/packaging')
const fixture = mkdtempSync(join(tmpdir(), 'ash-package-hooks-'))
const currentShim = join(fixture, 'opt/Ash IDE/resources/bin/ash-ide')
const legacyShim = join(fixture, 'opt/ash-ide/resources/bin/ash-ide')
const sandbox = join(fixture, 'opt/Ash IDE/chrome-sandbox')
const link = join(fixture, 'usr/bin/ash-ide')
const marker = join(fixture, '.ash-package-maintainer-test')

function rewrite(name) {
  const source = readFileSync(join(sourceDir, name), 'utf8')
  // Replace every absolute target path, including ownership checks. This is
  // deliberately not an environment override that a root package install can
  // receive from a user-controlled process.
  const rewritten = source
    .replaceAll('/usr/bin/ash-ide', link)
    .replaceAll('/opt/Ash IDE', join(fixture, 'opt/Ash IDE'))
    .replaceAll('/opt/ash-ide', join(fixture, 'opt/ash-ide'))
  const absoluteTargets = /\/(?:usr\/bin\/ash-ide|opt\/(?:Ash IDE|ash-ide))/g
  let targetCount = 0
  for (const match of rewritten.matchAll(absoluteTargets)) {
    targetCount++
    assert.equal(
      rewritten.slice(match.index - fixture.length, match.index),
      fixture,
      'all script target paths must be constrained to the disposable fixture'
    )
  }
  assert.ok(targetCount >= 3, 'both hook scripts must contain the expected target paths')
  assert.notEqual(source, rewritten)
  const file = join(fixture, name)
  writeFileSync(file, rewritten, { flag: 'wx', mode: 0o700 })
  return file
}

function writeExecutable(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, '#!/bin/sh\nexit 0\n', { flag: 'wx', mode: 0o755 })
}

function linkTarget() {
  return existsSync(link) || lstatIfExists(link) ? readlinkSync(link) : null
}

function lstatIfExists(file) {
  try {
    return lstatSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function clearLink() {
  const stat = lstatIfExists(link)
  if (stat) {
    assert.ok(stat.isFile() || stat.isSymbolicLink())
    unlinkSync(link)
  }
}

const exec = promisify(execFile)

async function run(file, ...args) {
  await exec('bash', [file, ...args], {
    timeout: 5000,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: join(fixture, 'home/qa'),
      XDG_CONFIG_HOME: join(fixture, 'home/qa/.config'),
      CODEX_HOME: join(fixture, 'home/qa/.codex'),
      CLAUDE_CONFIG_DIR: join(fixture, 'home/qa/.claude')
    }
  })
}

try {
  assert.equal(lstatSync(fixture).uid, process.getuid())
  assert.equal(lstatSync(fixture).mode & 0o777, 0o700)
  writeFileSync(marker, 'owned disposable Ash maintainer test\n', { flag: 'wx' })
  const install = rewrite('after-install.sh')
  const remove = rewrite('after-remove.sh')
  mkdirSync(dirname(link), { recursive: true, mode: 0o700 })
  writeExecutable(currentShim)
  writeExecutable(sandbox)

  const preserved = new Map([
    ['home/qa/.config/ash-ide/profiles/personal/profile-state.db', 'Ash profile'],
    ['home/qa/.config/ash-ide/browser/sentinel', 'Ash browser state'],
    ['home/qa/.config/Orca/sentinel', 'Orca profile'],
    ['home/qa/.codex/config.toml', 'Provider configuration'],
    ['home/qa/workspace/project/sentinel', 'User project']
  ])
  for (const [relative, bytes] of preserved) {
    const path = join(fixture, relative)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
  }

  await run(install)
  assert.equal(linkTarget(), currentShim, 'current install prefix must own CLI link')
  assert.equal(lstatSync(sandbox).mode & 0o7777, 0o4755, 'sandbox setuid mode must be applied')
  await run(install)
  assert.equal(linkTarget(), currentShim, 'repeat install must be idempotent')

  clearLink()
  writeFileSync(link, 'another app owns this pathname\n', { flag: 'wx' })
  await run(install)
  assert.equal(
    readFileSync(link, 'utf8'),
    'another app owns this pathname\n',
    'unrelated file must not be overwritten'
  )
  clearLink()
  symlinkSync(join(fixture, 'opt/another-app/resources/bin/ash-ide'), link)
  await run(install)
  assert.match(linkTarget(), /another-app/, 'unrelated dangling symlink must not be overwritten')

  clearLink()
  symlinkSync(legacyShim, link) // Previous package path may now be nonexistent.
  await run(install)
  assert.equal(linkTarget(), currentShim, 'own stale legacy link must migrate to new prefix')
  await run(remove, '1')
  assert.equal(linkTarget(), currentShim, 'rpm upgrade must retain CLI link')
  await run(remove, 'upgrade')
  assert.equal(linkTarget(), currentShim, 'deb upgrade must retain CLI link')
  await run(remove, '0')
  assert.equal(lstatIfExists(link), null, 'rpm final uninstall removes only owned link')

  symlinkSync(currentShim, link)
  await run(remove, 'remove')
  assert.equal(lstatIfExists(link), null, 'deb uninstall removes only owned link')
  symlinkSync(join(fixture, 'opt/another-app/resources/bin/ash-ide'), link)
  await run(remove, '0')
  assert.match(linkTarget(), /another-app/, 'unrelated CLI link survives uninstall')
  clearLink()
  chmodSync(sandbox, 0o755)
  unlinkSync(currentShim)
  writeExecutable(legacyShim)
  const legacySandbox = join(fixture, 'opt/ash-ide/chrome-sandbox')
  writeExecutable(legacySandbox)
  await run(install)
  assert.equal(linkTarget(), legacyShim, 'older install layout remains supported')
  assert.equal(lstatSync(legacySandbox).mode & 0o7777, 0o4755)
  await run(remove, '0')
  assert.equal(lstatIfExists(link), null, 'older package symlink remains scoped to Ash')
  unlinkSync(legacyShim)
  await run(install)
  assert.equal(lstatIfExists(link), null, 'missing package shim cannot create a dead link')
  assert.equal(
    lstatSync(sandbox).mode & 0o7777,
    0o755,
    'missing shim must not chmod an unrelated sandbox'
  )

  writeExecutable(currentShim)
  await run(install)
  assert.equal(linkTarget(), currentShim, 'reinstallation restores only the package link')
  for (const [relative, bytes] of preserved) {
    const path = join(fixture, relative)
    assert.equal(readFileSync(path, 'utf8'), bytes)
    assert.equal(lstatSync(path).mode & 0o777, 0o600)
  }

  assert.equal(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).license, 'MIT')
  assert.match(readFileSync(join(repo, 'LICENSE'), 'utf8'), /^MIT License\n/)
  console.log(
    JSON.stringify({
      status: 'PASS',
      testedPaths: 'private-fixture-only',
      install: true,
      upgrade: true,
      remove: true,
      thirdPartyLinksPreserved: true,
      ashAndForeignUserDataPreserved: true,
      sandboxMode: true,
      licenseMetadata: 'MIT'
    })
  )
} finally {
  const stat = lstatSync(fixture)
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700)
  assert.equal(readFileSync(marker, 'utf8'), 'owned disposable Ash maintainer test\n')
  rmSync(fixture, { recursive: true, force: false })
}
