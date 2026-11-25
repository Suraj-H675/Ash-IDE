import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function fail(message) {
  throw new Error(message)
}

export function isWithin(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

export function resolveInputDirectory(value, label) {
  const absolute = resolve(value)
  let stat
  try {
    stat = lstatSync(absolute)
  } catch {
    fail(`${label} does not exist: ${absolute}`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be a real directory: ${absolute}`)
  }
  const real = realpathSync(absolute)
  if (real !== absolute) {
    fail(`${label} cannot pass through a symlink: ${absolute}`)
  }
  return real
}

function resolveTreeEntry(root, relativePath, label, expectedType) {
  const absoluteRoot = resolve(root)
  const rootStat = lstatSync(absoluteRoot)
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    realpathSync(absoluteRoot) !== absoluteRoot
  ) {
    fail(`${label} root must be a real directory: ${absoluteRoot}`)
  }
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    relativePath.includes('\\') ||
    isAbsolute(relativePath)
  ) {
    fail(`${label} contains an invalid relative path.`)
  }
  const segments = relativePath.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(`${label} contains an invalid relative path: ${relativePath}`)
  }
  let current = absoluteRoot
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index])
    let stat
    try {
      stat = lstatSync(current)
    } catch {
      fail(`${label} is missing: ${relativePath}`)
    }
    if (stat.isSymbolicLink()) {
      fail(`${label} cannot pass through a symlink: ${relativePath}`)
    }
    const final = index === segments.length - 1
    if (final ? !stat[expectedType]() : !stat.isDirectory()) {
      fail(`${label} has an unexpected file type: ${relativePath}`)
    }
  }
  if (!isWithin(absoluteRoot, current)) {
    fail(`${label} resolves outside its source tree: ${relativePath}`)
  }
  return current
}

export function resolveTreeFile(root, relativePath, label) {
  return resolveTreeEntry(root, relativePath, label, 'isFile')
}

export function resolveTreeDirectory(root, relativePath, label) {
  return resolveTreeEntry(root, relativePath, label, 'isDirectory')
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256File(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`Expected a regular file: ${path}`)
  }
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    if (!fstatSync(descriptor).isFile()) {
      fail(`Expected a regular file: ${path}`)
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor)
    }
  }
}

export function walkFiles(directory) {
  const root = resolveInputDirectory(directory, 'Tree root')
  const files = []
  const visit = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        fail(`Symlink is not allowed in the source tree: ${absolute}`)
      }
      if (entry.isDirectory()) {
        visit(absolute, relativePath)
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        fail(`Unsupported file type in the source tree: ${absolute}`)
      }
    }
  }
  visit(root, '')
  return files
}

export function sha256Tree(directory) {
  const root = resolveInputDirectory(directory, 'Tree root')
  const rows = walkFiles(root)
    .map((path) => `${path}\0${sha256File(resolveTreeFile(root, path, 'Source file'))}\n`)
    .join('')
  return sha256(rows)
}
