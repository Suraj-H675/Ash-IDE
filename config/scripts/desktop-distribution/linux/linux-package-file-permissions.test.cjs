// Standalone Node fixture: run in foundation CI without Electron or an RPM toolchain.
const assert = require('node:assert/strict')
const {
  chmodSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const {
  normalizeLinuxPackagedFilePermissions,
  inspectLinuxBundleModes
} = require('./linux-package-file-permissions.cjs')

const root = mkdtempSync(join(tmpdir(), 'ash-package-mode-test-'))
const bundle = join(root, 'linux-unpacked')
const external = join(root, 'outside-package')

function file(path, mode) {
  writeFileSync(path, 'test-owned payload\n', { flag: 'wx' })
  chmodSync(path, mode)
}

try {
  assert.equal(lstatSync(root).uid, process.getuid())
  assert.equal(lstatSync(root).mode & 0o777, 0o700)
  mkdirSync(bundle)
  mkdirSync(join(bundle, 'resources'))
  const executable = join(bundle, 'ash-ide')
  const data = join(bundle, 'resources', 'locale.pak')
  const safe = join(bundle, 'resources', 'safe')
  file(executable, 0o777)
  file(data, 0o666)
  file(safe, 0o640)
  chmodSync(join(bundle, 'resources'), 0o777)
  file(external, 0o666)
  symlinkSync(external, join(bundle, 'resources', 'outside-link'))

  const result = normalizeLinuxPackagedFilePermissions(bundle)
  assert.equal(result.changed, 3)
  assert.equal(result.symlinks, 1)
  assert.equal(lstatSync(executable).mode & 0o7777, 0o755)
  assert.equal(lstatSync(data).mode & 0o7777, 0o644)
  assert.equal(lstatSync(safe).mode & 0o7777, 0o640)
  assert.equal(lstatSync(join(bundle, 'resources')).mode & 0o7777, 0o755)
  assert.equal(lstatSync(external).mode & 0o7777, 0o666, 'never follow symlinks outside bundle')
  assert.equal(readFileSync(external, 'utf8'), 'test-owned payload\n')
  assert.equal(normalizeLinuxPackagedFilePermissions(bundle).changed, 0, 'must be idempotent')
  assert.equal(inspectLinuxBundleModes(bundle, false).checked, 5)

  // A hardlink to a file outside the bundle is *not* safe to chmod; reject
  // before changing any files even if another writable entry was scanned.
  const shared = join(bundle, 'resources', 'hardlinked')
  linkSync(external, shared)
  chmodSync(data, 0o666)
  assert.throws(
    () => normalizeLinuxPackagedFilePermissions(bundle),
    /Refusing to chmod multiply-linked Linux bundle file/
  )
  assert.equal(lstatSync(external).mode & 0o7777, 0o666)
  assert.equal(lstatSync(data).mode & 0o7777, 0o666, 'hardlink refusal must precede mutation')
  console.log(
    JSON.stringify({
      status: 'PASS',
      normalized: true,
      externalLinksUntouched: true,
      hardlinksFailBeforeMutation: true
    })
  )
} finally {
  const stat = lstatSync(root)
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700)
  rmSync(root, { recursive: true, force: false })
}
