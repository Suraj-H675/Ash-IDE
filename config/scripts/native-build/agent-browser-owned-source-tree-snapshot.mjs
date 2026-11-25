import { lstatSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  fail,
  isWithin,
  resolveInputDirectory,
  sha256,
  sha256File
} from './agent-browser-owned-source-files.mjs'

function validateSnapshotPath(path, label) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    isAbsolute(path) ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    fail(`${label} contains an unsafe relative path.`)
  }
  return path
}

function assertSnapshotMode(stat, path, label, symlink = false) {
  const mode = stat.mode & 0o7777
  if (!symlink && (mode & 0o6022) !== 0) {
    fail(`${label} has unsafe writable or set-id permissions: ${path}`)
  }
  return mode
}

function snapshotEntry(root, relativePath, label, allowInternalSymlinks) {
  const absolute = relativePath === '.' ? root : join(root, relativePath)
  const before = lstatSync(absolute)
  if (before.isSymbolicLink()) {
    if (!allowInternalSymlinks) {
      fail(`${label} contains a symlink outside a generated directory: ${relativePath}`)
    }
    const mode = assertSnapshotMode(before, relativePath, label, true)
    const target = readlinkSync(absolute)
    if (isAbsolute(target)) {
      fail(`${label} contains an absolute generated symlink: ${relativePath}`)
    }
    const lexicalTarget = resolve(absolute, '..', target)
    if (!isWithin(root, lexicalTarget)) {
      fail(`${label} contains a generated symlink outside the source tree: ${relativePath}`)
    }
    let realTarget
    let targetStat
    try {
      realTarget = realpathSync(absolute)
      targetStat = statSync(realTarget)
    } catch {
      fail(`${label} contains a broken or cyclic generated symlink: ${relativePath}`)
    }
    const after = lstatSync(absolute)
    if (
      !isWithin(root, realTarget) ||
      (!targetStat.isFile() && !targetStat.isDirectory()) ||
      !after.isSymbolicLink() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      readlinkSync(absolute) !== target
    ) {
      fail(`${label} contains an unsafe or changed generated symlink: ${relativePath}`)
    }
    return {
      path: relativePath,
      type: 'symlink',
      mode,
      target,
      sha256: sha256(Buffer.from(target))
    }
  }

  const mode = assertSnapshotMode(before, relativePath, label)
  if (before.isFile()) {
    const digest = sha256File(absolute)
    const after = lstatSync(absolute)
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      (after.mode & 0o7777) !== mode ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      fail(`${label} changed while its digest was read: ${relativePath}`)
    }
    return { path: relativePath, type: 'file', mode, sha256: digest }
  }
  if (before.isDirectory()) {
    return { path: relativePath, type: 'directory', mode }
  }
  fail(`${label} contains an unsupported file type: ${relativePath}`)
}

function pathIsExcluded(path, excludedRoots) {
  return excludedRoots.some((root) => path === root || path.startsWith(`${root}/`))
}

function directoryChildren(directory) {
  return readdirSync(directory).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function captureDirectoryEntries(root, relativePath, entries, options) {
  const absolute = relativePath === '.' ? root : join(root, relativePath)
  const before = lstatSync(absolute)
  const namesBefore = directoryChildren(absolute)
  for (const name of namesBefore) {
    const childPath = relativePath === '.' ? name : `${relativePath}/${name}`
    if (pathIsExcluded(childPath, options.excludedRoots)) {
      continue
    }
    const entry = snapshotEntry(root, childPath, options.label, options.allowInternalSymlinks)
    entries.push(entry)
    if (entry.type === 'directory') {
      captureDirectoryEntries(root, childPath, entries, options)
    }
  }
  const after = lstatSync(absolute)
  const namesAfter = directoryChildren(absolute)
  if (
    !after.isDirectory() ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    (after.mode & 0o7777) !== (before.mode & 0o7777) ||
    JSON.stringify(namesBefore) !== JSON.stringify(namesAfter)
  ) {
    fail(`${options.label} directory changed while its entries were read: ${relativePath}`)
  }
}

function finishSnapshot(entries) {
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return {
    entryCount: entries.length,
    entries,
    sha256: sha256(Buffer.from(JSON.stringify(entries)))
  }
}

export function captureTreeSnapshot(
  directory,
  {
    excludedRoots = [],
    onlyRoots,
    allowMissingRoots = false,
    allowInternalSymlinks = false,
    label = 'Source input tree'
  } = {}
) {
  const root = resolveInputDirectory(directory, label)
  for (const path of excludedRoots) {
    validateSnapshotPath(path, label)
  }
  const entries = []
  if (onlyRoots === undefined) {
    const rootEntry = snapshotEntry(root, '.', label, false)
    if (rootEntry.type !== 'directory') {
      fail(`${label} root is not a directory.`)
    }
    entries.push(rootEntry)
    captureDirectoryEntries(root, '.', entries, { excludedRoots, allowInternalSymlinks, label })
    return finishSnapshot(entries)
  }

  const roots = [...new Set(onlyRoots)].sort()
  for (let index = 0; index < roots.length; index += 1) {
    validateSnapshotPath(roots[index], label)
    if (index > 0 && isWithin(roots[index - 1], roots[index])) {
      fail(`${label} generated directories overlap.`)
    }
    const absolute = join(root, roots[index])
    let stat
    try {
      stat = lstatSync(absolute)
    } catch (error) {
      if (error.code !== 'ENOENT' || !allowMissingRoots) {
        fail(`${label} generated directory is missing: ${roots[index]}`)
      }
      entries.push({ path: roots[index], type: 'missing', mode: 0 })
      continue
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`${label} generated root must be a real directory: ${roots[index]}`)
    }
    entries.push(snapshotEntry(root, roots[index], label, allowInternalSymlinks))
    captureDirectoryEntries(root, roots[index], entries, {
      excludedRoots: [],
      allowInternalSymlinks,
      label
    })
  }
  return finishSnapshot(entries)
}

export function assertTreeSnapshotUnchanged(directory, expected, options = {}) {
  const actual = captureTreeSnapshot(directory, options)
  if (
    expected.sha256 !== actual.sha256 ||
    expected.entryCount !== actual.entryCount ||
    JSON.stringify(expected.entries) !== JSON.stringify(actual.entries)
  ) {
    fail(`${options.label ?? 'Source input tree'} changed after its snapshot was captured.`)
  }
  return actual
}

/** Git-mode identity for every original file and directory, independent of extraction umask. */
export function assertPinnedTreeIdentity(directory, expected, label) {
  const snapshot = captureTreeSnapshot(directory, { label })
  const rows = snapshot.entries
    .filter((entry) => entry.path !== '.')
    .map((entry) => {
      if (entry.type === 'directory') {
        return [entry.path, 'directory']
      }
      if (entry.type !== 'file' || (entry.mode & 0o111 && !(entry.mode & 0o100))) {
        fail(`${label} has an invalid Git file type or executable mode: ${entry.path}`)
      }
      return [entry.path, 'file', entry.mode & 0o100 ? '100755' : '100644', entry.sha256]
    })
  const actual = { entryCount: rows.length, sha256: sha256(Buffer.from(JSON.stringify(rows))) }
  if (actual.entryCount !== expected.entryCount || actual.sha256 !== expected.sha256) {
    fail(
      `${label} does not match the pinned complete tree identity (expected ${expected.sha256}, got ${actual.sha256}).`
    )
  }
  return actual
}
