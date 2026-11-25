import { spawnSync } from 'node:child_process'
import { accessSync, chmodSync, constants, lstatSync, realpathSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { sha256File } from './agent-browser-owned-source-files.mjs'

const systemToolDirectories = ['/usr/bin', '/bin', '/usr/local/bin']

function isWithin(directory, path) {
  const relativePath = relative(directory, path)
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function ownerUid() {
  const uid = userInfo().uid
  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error('Filesystem owner checks require a POSIX user ID.')
  }
  return uid
}

export function captureSafeDirectoryChain(directory, label = 'Filesystem') {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error(`${label} directory must be absolute.`)
  }
  const absolute = resolve(directory)
  if (realpathSync(absolute) !== absolute) {
    throw new Error(`${label} directory cannot pass through a symlink: ${absolute}`)
  }
  const uid = ownerUid()
  const root = parse(absolute).root
  const osRootUid = lstatSync(root).uid
  const segments = absolute.slice(root.length).split(sep).filter(Boolean)
  const paths = [root]
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    paths.push(current)
  }
  const directories = paths.map((path) => {
    let stat
    try {
      stat = lstatSync(path)
    } catch {
      throw new Error(`${label} directory does not exist: ${path}`)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} path must contain only real directories: ${path}`)
    }
    const mode = stat.mode & 0o7777
    const writableByOther = (mode & 0o022) !== 0
    const stickyBoundary = (mode & 0o1000) !== 0
    const ownerWritable = (mode & 0o200) !== 0
    const trustedOwner = stat.uid === uid || stat.uid === osRootUid
    if (writableByOther && !stickyBoundary) {
      throw new Error(`${label} path is writable by other users without sticky protection: ${path}`)
    }
    if (writableByOther && stickyBoundary && !trustedOwner) {
      throw new Error(`${label} shared writable path has an untrusted owner: ${path}`)
    }
    if (ownerWritable && !trustedOwner) {
      throw new Error(`${label} path is owner-writable by an untrusted user: ${path}`)
    }
    return {
      path,
      device: stat.dev,
      inode: stat.ino,
      mode,
      uid: stat.uid,
      gid: stat.gid,
      currentUserWritable: stat.uid === uid && ownerWritable,
      ownerWritableByTrustedOs: stat.uid === osRootUid && stat.uid !== uid && ownerWritable,
      sharedWritableWithStickyProtection: writableByOther && stickyBoundary
    }
  })
  return { path: absolute, directories }
}

export function assertSafeDirectoryPath(directory, label = 'Filesystem') {
  return captureSafeDirectoryChain(directory, label)
}

export function assertDirectoryChainUnchanged(boundary, label = 'Filesystem') {
  const current = captureSafeDirectoryChain(boundary.path, label)
  if (JSON.stringify(current.directories) !== JSON.stringify(boundary.directories)) {
    throw new Error(`${label} directory boundary changed after validation: ${boundary.path}`)
  }
  return current
}

function inspectExecutable(path, label) {
  const uid = ownerUid()
  const parent = captureSafeDirectoryChain(dirname(path), label)
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular executable file: ${path}`)
  }
  const mode = stat.mode & 0o7777
  if ((mode & 0o6022) !== 0 || !isExecutable(path)) {
    throw new Error(`${label} must not be writable by other users or have set-id bits: ${path}`)
  }
  return { parent, stat, currentUserWritable: stat.uid === uid && (mode & 0o200) !== 0 }
}

export function captureExecutableIdentity(value, label = 'Toolchain executable') {
  const executable = resolveExecutableFile(value, label, { requireCanonical: false })
  const { parent, stat, currentUserWritable } = inspectExecutable(executable, label)
  return {
    path: executable,
    type: 'regular-executable',
    mode: stat.mode & 0o7777,
    uid: stat.uid,
    gid: stat.gid,
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    sha256: requireSha256(executable),
    currentUserWritable:
      currentUserWritable || parent.directories.some((directory) => directory.currentUserWritable),
    ancestors: parent.directories
  }
}

function requireSha256(path) {
  return sha256File(path)
}

export function assertExecutableIdentityUnchanged(identity) {
  let current
  try {
    current = captureExecutableIdentity(identity.path)
  } catch (error) {
    throw new Error(
      `Toolchain executable changed after validation: ${identity.path}. ${error.message}`
    )
  }
  if (JSON.stringify(current) !== JSON.stringify(identity)) {
    throw new Error(`Toolchain executable changed after validation: ${identity.path}`)
  }
  return current
}

export function resolveExecutableFile(value, label, { requireCanonical = true } = {}) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute executable path.`)
  }
  const absolute = resolve(value)
  let stat
  try {
    stat = lstatSync(absolute)
  } catch {
    throw new Error(`${label} does not exist: ${absolute}`)
  }
  if (requireCanonical && stat.isSymbolicLink()) {
    throw new Error(`${label} must be the canonical executable path, not a symlink: ${absolute}`)
  }
  const executable = realpathSync(absolute)
  if (requireCanonical && executable !== absolute) {
    throw new Error(`${label} must not pass through a symlink: ${absolute}`)
  }
  inspectExecutable(executable, label)
  return executable
}

export function resolveSystemExecutable(name, { required = true } = {}) {
  for (const directory of systemToolDirectories) {
    const candidate = join(directory, name)
    try {
      const executable = resolveExecutableFile(candidate, name, { requireCanonical: false })
      if (
        systemToolDirectories.some((directory) => isWithin(realpathSync(directory), executable))
      ) {
        return executable
      }
    } catch {
      continue
    }
  }
  if (!required) {
    return undefined
  }
  throw new Error(`Required system executable is missing from trusted system directories: ${name}`)
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function writeToolWrappers(directory, entries, shellPath) {
  const shell = resolveExecutableFile(shellPath, 'Wrapper shell')
  for (const [name, executable] of Object.entries(entries)) {
    if (!executable) {
      continue
    }
    const path = join(directory, name)
    writeFileSync(path, `#!${shell}\nexec ${shellQuote(executable)} "$@"\n`, {
      flag: 'wx',
      mode: 0o700
    })
    chmodSync(path, 0o700)
  }
}

export function runChecked(command, args, options) {
  if (!isAbsolute(command)) {
    throw new Error('Subprocess command must be an absolute executable path.')
  }
  resolveExecutableFile(command, 'Subprocess command')
  if (!options || !options.cwd || !options.env || typeof options.env !== 'object') {
    throw new Error('Subprocess calls require an explicit working directory and environment.')
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.inherit ? undefined : 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    shell: false,
    timeout: options.timeout,
    stdio: options.inherit ? 'inherit' : 'pipe'
  })
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return options.inherit ? '' : result.stdout.trim()
}

export function executableDirectory(path) {
  return dirname(path)
}
