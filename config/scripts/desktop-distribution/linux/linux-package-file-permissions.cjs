// Electron's Linux zip can contain 0777 executables and 0666 resource files.
// The AppImage is read-only, but copying those modes into a root-installed
// DEB/RPM lets any local user replace application code. Normalize the *copied*
// bundle once, before electron-builder creates any Linux distribution target.
const { chmodSync, lstatSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

function inspectLinuxBundleModes(root, collectChanges) {
  const pending = [root]
  const changes = []
  let checked = 0
  let symlinks = 0
  while (pending.length > 0) {
    const path = pending.pop()
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      // Do not follow links out of the copied bundle or chmod their targets.
      symlinks++
      continue
    }
    if (!stat.isDirectory() && !stat.isFile()) {
      throw new Error(`Linux packaged bundle contains an unsupported special file: ${path}`)
    }
    checked++
    if ((stat.mode & 0o022) !== 0) {
      // Mutating an unsafe hardlink can chmod the source pnpm store or another
      // user's file. Fail before touching *any* mode in the bundle.
      if (stat.isFile() && stat.nlink !== 1) {
        throw new Error(`Refusing to chmod multiply-linked Linux bundle file: ${path}`)
      }
      if (!collectChanges) {
        throw new Error(`World/group-writable file remains in Linux package: ${path}`)
      }
      changes.push({ path, mode: stat.mode & 0o7777 & ~0o022 })
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) {
        pending.push(join(path, name))
      }
    }
  }
  return { changes, checked, symlinks }
}

function normalizeLinuxPackagedFilePermissions(appOutDir) {
  const { changes, checked, symlinks } = inspectLinuxBundleModes(appOutDir, true)
  for (const change of changes) {
    chmodSync(change.path, change.mode)
  }
  // Assert the actual modes after changes, rather than claiming success just
  // because chmod() did not throw. This also detects drift in future hooks.
  const verification = inspectLinuxBundleModes(appOutDir, false)
  console.log(
    `[linux-package-modes] OK — normalized ${changes.length} writable entries, ` +
      `verified ${verification.checked} files/directories, skipped ${symlinks} symlinks`
  )
  return { changed: changes.length, checked, symlinks }
}

module.exports = { normalizeLinuxPackagedFilePermissions, inspectLinuxBundleModes }
