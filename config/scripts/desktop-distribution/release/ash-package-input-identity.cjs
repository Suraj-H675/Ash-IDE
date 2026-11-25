const { createHash, randomUUID } = require('node:crypto')
const {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync
} = require('node:fs')
const { lstat, mkdtemp, open, realpath, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')

const APP_ID = 'com.ashide.desktop'
const PRODUCT_NAME = 'Ash IDE'
const PACKAGE_NAME = 'ash-ide'
const COMPILED_CLI_PACKAGE_NAME = 'ash-ide-compiled-output'
const MAX_ASAR_BYTES = 512 * 1024 * 1024
const MAX_ASAR_HEADER_BYTES = 16 * 1024 * 1024
const MAX_ASAR_ENTRIES = 100_000
const MAX_CLI_PACKAGE_BYTES = 128 * 1024
const MAX_IDENTITY_BYTES = 64 * 1024
const COPY_CHUNK_BYTES = 1024 * 1024

function isSupportedPackageVersion(version) {
  return (
    typeof version === 'string' &&
    /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-[0-9A-Za-z.-]{1,64})?(?:\+[0-9A-Za-z.-]{1,64})?$/.test(
      version
    )
  )
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sameSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function assertNoDuplicateJsonKeys(source) {
  const stack = []
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      const start = index
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
        } else if (source[index] === '"') {
          break
        } else {
          index += 1
        }
      }
      const token = source.slice(start, index + 1)
      let next = index + 1
      while (/\s/.test(source[next] ?? '')) {
        next += 1
      }
      if (source[next] === ':' && stack.at(-1)?.kind === 'object') {
        const key = JSON.parse(token)
        if (stack.at(-1).keys.has(key)) {
          throw new Error('Ash package metadata contains duplicate JSON keys')
        }
        stack.at(-1).keys.add(key)
      }
      continue
    }
    if (character === '{') {
      stack.push({ kind: 'object', keys: new Set() })
    } else if (character === '[') {
      stack.push({ kind: 'array' })
    } else if (character === '}' || character === ']') {
      stack.pop()
    }
  }
}

function parseUniqueJson(source) {
  assertNoDuplicateJsonKeys(source)
  return JSON.parse(source)
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function openPinnedRegularFile(path, label, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let info
  try {
    info = await handle.stat({ bigint: true })
  } catch (error) {
    await handle.close()
    throw error
  }
  if (!info.isFile() || info.nlink !== 1n || info.size <= 0n || info.size > BigInt(maxBytes)) {
    await handle.close()
    throw new Error(`${label} must be a bounded regular single-link file`)
  }
  return { handle, info }
}

function assertPinnedPathUnchanged(path, pinned, label) {
  let currentPathDescriptor
  try {
    const currentInfo = fstatSync(pinned.handle.fd, { bigint: true })
    currentPathDescriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const pathInfo = fstatSync(currentPathDescriptor, { bigint: true })
    if (
      !currentInfo.isFile() ||
      !pathInfo.isFile() ||
      currentInfo.nlink !== 1n ||
      pathInfo.nlink !== 1n ||
      !sameSnapshot(pinned.info, currentInfo) ||
      !sameSnapshot(pinned.info, pathInfo)
    ) {
      throw new Error(`${label} changed while being inspected`)
    }
  } catch (error) {
    if (error instanceof Error && error.message === `${label} changed while being inspected`) {
      throw error
    }
    throw new Error(`${label} changed while being inspected`, { cause: error })
  } finally {
    if (currentPathDescriptor !== undefined) {
      closeSync(currentPathDescriptor)
    }
  }
}

async function hashPinnedFile(path, pinned, label) {
  const before = await pinned.handle.stat({ bigint: true })
  if (!before.isFile() || before.nlink !== 1n || !sameSnapshot(pinned.info, before)) {
    throw new Error(`${label} changed while being inspected`)
  }
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(COPY_CHUNK_BYTES)
  let offset = 0
  while (offset < Number(before.size)) {
    const { bytesRead } = await pinned.handle.read(
      buffer,
      0,
      Math.min(buffer.length, Number(before.size) - offset),
      offset
    )
    if (bytesRead === 0) {
      throw new Error(`${label} changed while being inspected`)
    }
    hash.update(buffer.subarray(0, bytesRead))
    offset += bytesRead
  }
  const after = await pinned.handle.stat({ bigint: true })
  if (offset !== Number(before.size) || !sameSnapshot(before, after)) {
    throw new Error(`${label} changed while being inspected`)
  }
  assertPinnedPathUnchanged(path, pinned, label)
  return hash.digest('hex')
}

async function assertPinnedFileHash(path, pinned, expectedHash, label) {
  const currentHash = await hashPinnedFile(path, pinned, label)
  if (currentHash !== expectedHash) {
    throw new Error(`${label} digest changed while being inspected`)
  }
}

async function copyPinnedFileToPrivateTemp(path, label, directory) {
  const { handle, info } = await openPinnedRegularFile(path, label, MAX_ASAR_BYTES)
  const copyPath = join(directory, `package-${randomUUID()}.asar`)
  let destination
  let pinnedCopy
  let retainHandles = false
  const hash = createHash('sha256')
  let offset = 0
  try {
    destination = await open(copyPath, 'wx', 0o600)
    const buffer = Buffer.alloc(COPY_CHUNK_BYTES)
    while (offset < Number(info.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(info.size) - offset),
        offset
      )
      if (bytesRead === 0) {
        throw new Error(`${label} changed while being inspected`)
      }
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      await destination.writeFile(chunk)
      offset += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (offset !== Number(info.size) || !sameSnapshot(info, after)) {
      throw new Error(`${label} changed while being inspected`)
    }
    await destination.sync()
    await destination.close()
    destination = undefined
    const sourceHash = hash.digest('hex')
    pinnedCopy = await openPinnedRegularFile(copyPath, `${label} inspection copy`, MAX_ASAR_BYTES)
    const copyHash = await hashPinnedFile(copyPath, pinnedCopy, `${label} inspection copy`)
    if (copyHash !== sourceHash) {
      throw new Error(`${label} inspection copy digest does not match its source`)
    }
    retainHandles = true
    return {
      copyPath,
      sha256: sourceHash,
      handle,
      info,
      copyHandle: pinnedCopy.handle,
      copyInfo: pinnedCopy.info
    }
  } catch (error) {
    await rm(copyPath, { force: true })
    throw error
  } finally {
    try {
      await destination?.close()
    } finally {
      if (!retainHandles) {
        await Promise.allSettled([handle.close(), pinnedCopy?.handle.close()])
      }
    }
  }
}

async function readPinnedJson(path, label, maxBytes) {
  const { handle, info } = await openPinnedRegularFile(path, label, maxBytes)
  try {
    const bytes = Buffer.alloc(Number(info.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (offset !== Number(info.size) || !sameSnapshot(info, after)) {
      throw new Error(`${label} changed while being inspected`)
    }
    const source = decodeUtf8(bytes.subarray(0, offset))
    return { handle, info, bytes: bytes.subarray(0, offset), value: parseUniqueJson(source) }
  } catch (error) {
    await handle.close()
    throw error
  }
}

function readPinnedPackageFile(path, label, maxBytes, expectedSize) {
  const before = lstatSync(path, { bigint: true })
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size > BigInt(maxBytes) ||
    realpathSync(path) !== resolve(path)
  ) {
    throw new Error(`${label} must be a bounded regular single-link file without symlink aliases`)
  }
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      !sameSnapshot(before, opened) ||
      (expectedSize !== undefined && opened.size !== BigInt(expectedSize))
    ) {
      throw new Error(`${label} changed type or size while being inspected`)
    }
    const bytes = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (!count) {
        throw new Error(`${label} changed while being inspected`)
      }
      offset += count
    }
    if (!sameSnapshot(opened, fstatSync(descriptor, { bigint: true }))) {
      throw new Error(`${label} changed while being inspected`)
    }
    const pathDescriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      if (!sameSnapshot(opened, fstatSync(pathDescriptor, { bigint: true }))) {
        throw new Error(`${label} changed while being inspected`)
      }
    } finally {
      closeSync(pathDescriptor)
    }
    return bytes
  } finally {
    closeSync(descriptor)
  }
}

async function assertRealDirectory(path, label) {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== resolve(path)) {
    throw new Error(`${label} must be a real directory without symlink aliases`)
  }
}

function validatePackageMetadata(value, version, label, expectedName = PACKAGE_NAME) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value.name !== expectedName ||
    value.version !== version
  ) {
    throw new Error(`${label} does not identify the expected Ash IDE package version`)
  }
}

function inspectAppAsar(asarPath, expectedVersion, asar) {
  let archiveSize
  let dataOffset
  const descriptor = openSync(
    asarPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const archiveInfo = fstatSync(descriptor)
    const prefix = Buffer.alloc(8)
    if (
      !archiveInfo.isFile() ||
      archiveInfo.nlink !== 1 ||
      archiveInfo.size <= prefix.length ||
      archiveInfo.size > MAX_ASAR_BYTES ||
      readSync(descriptor, prefix, 0, prefix.length, 0) !== prefix.length
    ) {
      throw new Error('Packaged app.asar header is invalid or exceeds its inspection limit')
    }
    const picklePayloadBytes = prefix.readUInt32LE(0)
    const headerPickleBytes = prefix.readUInt32LE(4)
    if (
      picklePayloadBytes !== 4 ||
      headerPickleBytes < 12 ||
      headerPickleBytes > MAX_ASAR_HEADER_BYTES ||
      headerPickleBytes % 4 !== 0 ||
      headerPickleBytes + prefix.length > archiveInfo.size
    ) {
      throw new Error('Packaged app.asar header is malformed or exceeds its inspection limit')
    }
    archiveSize = archiveInfo.size
    dataOffset = headerPickleBytes + prefix.length
  } finally {
    closeSync(descriptor)
  }
  const listedEntries = asar.listPackage(asarPath)
  if (
    !Array.isArray(listedEntries) ||
    listedEntries.length === 0 ||
    listedEntries.length > MAX_ASAR_ENTRIES
  ) {
    throw new Error('Packaged app.asar entry count is invalid or exceeds its inspection limit')
  }
  const normalizedEntries = listedEntries.map((entryPath) => {
    if (typeof entryPath !== 'string') {
      throw new Error('Packaged app.asar contains an invalid entry name')
    }
    const normalized = entryPath.replace(/\\/g, '/')
    const relative = normalized.startsWith('/') ? normalized.slice(1) : normalized
    if (
      normalized.startsWith('//') ||
      relative.startsWith('/') ||
      relative.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) {
      throw new Error('Packaged app.asar contains an ambiguous or traversing entry name')
    }
    return relative
  })
  if (new Set(normalizedEntries).size !== normalizedEntries.length) {
    throw new Error('Packaged app.asar contains duplicate normalized entry names')
  }
  const entries = new Map()
  for (const relative of normalizedEntries) {
    const metadata = asar.statFile(asarPath, relative, false)
    if (!metadata || typeof metadata !== 'object') {
      throw new Error('Packaged app.asar contains a missing entry')
    }
    if ('link' in metadata) {
      throw new Error('Packaged app.asar linked entry is not a regular archive entry')
    }
    if (metadata.files !== undefined) {
      if (
        typeof metadata.files !== 'object' ||
        metadata.files === null ||
        Array.isArray(metadata.files)
      ) {
        throw new Error('Packaged app.asar contains an invalid directory entry')
      }
      entries.set(relative, { kind: 'directory', metadata })
      continue
    }
    const size = metadata.size
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ASAR_BYTES) {
      throw new Error('Packaged app.asar contains a file with an invalid or oversized size')
    }
    if (metadata.unpacked !== undefined && typeof metadata.unpacked !== 'boolean') {
      throw new Error('Packaged app.asar contains an invalid unpacked entry flag')
    }
    let offset
    if (metadata.unpacked !== true) {
      if (typeof metadata.offset !== 'string' || !/^\d+$/.test(metadata.offset)) {
        throw new Error('Packaged app.asar contains a packed entry with an invalid offset')
      }
      offset = Number(metadata.offset)
      if (!Number.isSafeInteger(offset) || offset < 0 || dataOffset + offset + size > archiveSize) {
        throw new Error('Packaged app.asar contains an invalid packed entry offset')
      }
    }
    entries.set(relative, { kind: 'file', metadata, size, offset })
  }
  const packageEntry = entries.get('package.json')
  if (
    !packageEntry ||
    packageEntry.kind !== 'file' ||
    packageEntry.metadata.unpacked === true ||
    packageEntry.size <= 0 ||
    packageEntry.size > MAX_CLI_PACKAGE_BYTES
  ) {
    throw new Error('Packaged app.asar package.json must be a regular archive entry')
  }
  const packageBytes = asar.extractFile(asarPath, 'package.json', false)
  if (
    !Buffer.isBuffer(packageBytes) ||
    packageBytes.length !== packageEntry.size ||
    packageBytes.length > MAX_CLI_PACKAGE_BYTES
  ) {
    throw new Error('Packaged app.asar package.json exceeds its size limit')
  }
  const packageMetadata = parseUniqueJson(decodeUtf8(packageBytes))
  validatePackageMetadata(packageMetadata, expectedVersion, 'Packaged app.asar')
  return { entries, packageMetadata }
}

async function withAshPackageInputSnapshot(
  resourcesDir,
  inspect,
  asar = require('@electron/asar')
) {
  await assertRealDirectory(resourcesDir, 'Ash package resources path')
  const realResources = await realpath(resourcesDir)
  if (basename(realResources) !== 'resources') {
    throw new Error('Ash package inspection requires a resources directory')
  }
  const archivePath = join(realResources, 'app.asar')
  const unpackedDir = join(realResources, 'app.asar.unpacked')
  const compiledOutDir = join(unpackedDir, 'out')
  const sidecarPath = join(realResources, 'ash-package-input-identity.json')
  const cliPackagePath = join(compiledOutDir, 'package.json')
  await assertRealDirectory(unpackedDir, 'Unpacked application directory')
  await assertRealDirectory(compiledOutDir, 'Compiled CLI directory')
  const sidecar = await readPinnedJson(
    sidecarPath,
    'Ash package identity sidecar',
    MAX_IDENTITY_BYTES
  )
  let cliPackage
  let archiveCopy
  let privateDir
  try {
    privateDir = await mkdtemp(join(tmpdir(), 'ash-package-inspection-'))
    cliPackage = await readPinnedJson(
      cliPackagePath,
      'Compiled CLI package.json',
      MAX_CLI_PACKAGE_BYTES
    )
    validatePackageMetadata(
      cliPackage.value,
      sidecar.value.version,
      'Compiled CLI package.json',
      COMPILED_CLI_PACKAGE_NAME
    )
    if (cliPackage.value.type !== 'commonjs' || cliPackage.value.private !== true) {
      throw new Error('Compiled CLI package.json must identify the private CommonJS output')
    }
    archiveCopy = await copyPinnedFileToPrivateTemp(archivePath, 'Packaged app.asar', privateDir)
    assertPinnedPathUnchanged(
      archiveCopy.copyPath,
      { handle: archiveCopy.copyHandle, info: archiveCopy.copyInfo },
      'Packaged app.asar inspection copy'
    )
    const archive = inspectAppAsar(archiveCopy.copyPath, sidecar.value.version, asar)
    const snapshot = {
      resourcesDir: realResources,
      identity: sidecar.value,
      identityBytes: sidecar.bytes,
      cliPackage: cliPackage.value,
      cliPackageBytes: cliPackage.bytes,
      archiveSha256: archiveCopy.sha256,
      archivePath: archiveCopy.copyPath,
      archiveEntries: archive.entries,
      packageMetadata: archive.packageMetadata,
      unpackedDir,
      readEntry(relative, maxBytes) {
        const entry = archive.entries.get(relative)
        if (!entry || entry.kind !== 'file') {
          return null
        }
        if (entry.size > maxBytes) {
          return null
        }
        if (entry.metadata.unpacked === true) {
          return readPinnedPackageFile(
            join(unpackedDir, ...relative.split('/')),
            `Unpacked ASAR entry ${relative}`,
            maxBytes,
            entry.size
          )
        }
        const bytes = asar.extractFile(archiveCopy.copyPath, relative, false)
        if (!Buffer.isBuffer(bytes) || bytes.length !== entry.size) {
          throw new Error(`Packed ASAR entry ${relative} has an inconsistent size`)
        }
        return bytes
      },
      async assertInputsUnchanged() {
        await assertPinnedFileHash(
          archiveCopy.copyPath,
          { handle: archiveCopy.copyHandle, info: archiveCopy.copyInfo },
          archiveCopy.sha256,
          'Packaged app.asar inspection copy'
        )
        assertPinnedPathUnchanged(archivePath, archiveCopy, 'Packaged app.asar')
        assertPinnedPathUnchanged(sidecarPath, sidecar, 'Ash package identity sidecar')
        assertPinnedPathUnchanged(cliPackagePath, cliPackage, 'Compiled CLI package.json')
      }
    }
    const result = await inspect(snapshot)
    await snapshot.assertInputsUnchanged()
    return result
  } finally {
    await Promise.allSettled([
      archiveCopy?.handle.close(),
      archiveCopy?.copyHandle.close(),
      sidecar.handle.close(),
      cliPackage?.handle.close()
    ])
    if (privateDir) {
      try {
        if (archiveCopy) {
          asar.uncache?.(archiveCopy.copyPath)
        }
      } finally {
        await rm(privateDir, { recursive: true, force: true })
      }
    }
  }
}

async function writeInputIdentityClaim(
  resourcesDir,
  inputClaim,
  verifyCopy,
  verifyInputs,
  beforeSidecarPublish
) {
  const output = join(resourcesDir, 'ash-package-input-identity.json')
  const temporary = join(resourcesDir, `.ash-package-input-identity-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o644)
  try {
    await handle.writeFile(`${JSON.stringify(inputClaim)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await beforeSidecarPublish()
    await verifyCopy()
    // Do not yield between the final source identity checks and publication.
    verifyInputs()
    renameSync(temporary, output)
    const directory = openSync(resourcesDir, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      fsyncSync(directory)
    } finally {
      closeSync(directory)
    }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

async function createAshPackageInputIdentityClaim({
  resourcesDir,
  appId,
  productName,
  version,
  architecture,
  sourceCommit,
  asar = require('@electron/asar'),
  beforeSidecarPublish = () => {}
}) {
  if (
    appId !== APP_ID ||
    productName !== PRODUCT_NAME ||
    !isSupportedPackageVersion(version) ||
    !['x64', 'arm64'].includes(architecture)
  ) {
    throw new Error('Ash package identity inputs do not match the supported release contract')
  }
  const commit =
    /^[a-f0-9]{40}$/.test(sourceCommit ?? '') && sourceCommit !== '0'.repeat(40)
      ? sourceCommit
      : null
  const realResources = await realpath(resourcesDir)
  const resourceInfo = await lstat(realResources)
  if (
    resolve(resourcesDir) !== realResources ||
    basename(realResources) !== 'resources' ||
    !resourceInfo.isDirectory() ||
    resourceInfo.isSymbolicLink()
  ) {
    throw new Error('Ash package identity resources path must be a real resources directory')
  }
  const archivePath = join(realResources, 'app.asar')
  const unpackedDir = join(realResources, 'app.asar.unpacked')
  const compiledOutDir = join(unpackedDir, 'out')
  await assertRealDirectory(unpackedDir, 'Unpacked application directory')
  await assertRealDirectory(compiledOutDir, 'Compiled CLI directory')
  const cliPackagePath = join(realResources, 'app.asar.unpacked', 'out', 'package.json')
  const privateDir = await mkdtemp(join(tmpdir(), 'ash-package-identity-'))
  let archiveCopy
  let cliPackage
  try {
    archiveCopy = await copyPinnedFileToPrivateTemp(archivePath, 'Packaged app.asar', privateDir)
    assertPinnedPathUnchanged(
      archiveCopy.copyPath,
      { handle: archiveCopy.copyHandle, info: archiveCopy.copyInfo },
      'Packaged app.asar inspection copy'
    )
    await inspectAppAsar(archiveCopy.copyPath, version, asar)
    cliPackage = await readPinnedJson(
      cliPackagePath,
      'Compiled CLI package.json',
      MAX_CLI_PACKAGE_BYTES
    )
    validatePackageMetadata(
      cliPackage.value,
      version,
      'Compiled CLI package.json',
      COMPILED_CLI_PACKAGE_NAME
    )
    if (cliPackage.value.type !== 'commonjs' || cliPackage.value.private !== true) {
      throw new Error('Compiled CLI package.json must identify the private CommonJS output')
    }
    // An unbound development package remains possible, but a known source
    // claim cannot contradict the compiled CLI's own build metadata.
    if (commit !== null && cliPackage.value.commit !== commit) {
      throw new Error('Compiled CLI commit does not match the package sourceCommit')
    }
    const inputClaim = {
      schema: 1,
      evidenceKind: 'packaging-input-snapshot',
      appId: APP_ID,
      productName: PRODUCT_NAME,
      packageName: PACKAGE_NAME,
      version,
      architecture,
      sourceCommit: commit,
      capturedAppAsarSha256: archiveCopy.sha256,
      capturedCompiledCliPackageJsonSha256: sha256(cliPackage.bytes)
    }
    await writeInputIdentityClaim(
      realResources,
      inputClaim,
      async () => {
        await assertPinnedFileHash(
          archiveCopy.copyPath,
          { handle: archiveCopy.copyHandle, info: archiveCopy.copyInfo },
          archiveCopy.sha256,
          'Packaged app.asar inspection copy'
        )
      },
      () => {
        assertPinnedPathUnchanged(archivePath, archiveCopy, 'Packaged app.asar')
        assertPinnedPathUnchanged(cliPackagePath, cliPackage, 'Compiled CLI package.json')
      },
      beforeSidecarPublish
    )
    return inputClaim
  } finally {
    await Promise.allSettled([
      archiveCopy?.handle.close(),
      archiveCopy?.copyHandle.close(),
      cliPackage?.handle.close()
    ])
    try {
      if (archiveCopy) {
        asar.uncache?.(archiveCopy.copyPath)
      }
    } finally {
      await rm(privateDir, { recursive: true, force: true })
    }
  }
}

module.exports = {
  createAshPackageInputIdentityClaim,
  withAshPackageInputSnapshot,
  isSupportedPackageVersion
}
