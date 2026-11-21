const { createHash, randomUUID } = require('node:crypto')
const {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
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
const COPY_CHUNK_BYTES = 1024 * 1024

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

async function copyPinnedFileToPrivateTemp(path, label, directory) {
  const { handle, info } = await openPinnedRegularFile(path, label, MAX_ASAR_BYTES)
  const copyPath = join(directory, `package-${randomUUID()}.asar`)
  let destination
  let retainHandle = false
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
    retainHandle = true
    return { copyPath, sha256: hash.digest('hex'), handle, info }
  } catch (error) {
    await rm(copyPath, { force: true })
    throw error
  } finally {
    try {
      await destination?.close()
    } finally {
      if (!retainHandle) {
        await handle.close()
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

async function inspectAppAsar(asarPath, expectedVersion, asar) {
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
  } finally {
    closeSync(descriptor)
  }
  const entries = asar.listPackage(asarPath)
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ASAR_ENTRIES) {
    throw new Error('Packaged app.asar entry count is invalid or exceeds its inspection limit')
  }
  const normalizedEntries = entries.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('Packaged app.asar contains an invalid entry name')
    }
    const normalized = entry.replace(/\\/g, '/')
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
  const packageEntries = normalizedEntries.filter((entry) => entry === 'package.json')
  if (packageEntries.length !== 1) {
    throw new Error('Packaged app.asar must contain exactly one root package.json')
  }
  const entry = asar.statFile(asarPath, 'package.json', false)
  if (
    !entry ||
    'link' in entry ||
    entry.unpacked === true ||
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0 ||
    entry.size > MAX_CLI_PACKAGE_BYTES ||
    typeof entry.offset !== 'string' ||
    !/^\d+$/.test(entry.offset)
  ) {
    throw new Error('Packaged app.asar package.json must be a regular archive entry')
  }
  const bytes = asar.extractFile(asarPath, 'package.json', false)
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_CLI_PACKAGE_BYTES) {
    throw new Error('Packaged app.asar package.json exceeds its size limit')
  }
  const value = parseUniqueJson(decodeUtf8(bytes))
  validatePackageMetadata(value, expectedVersion, 'Packaged app.asar')
}

async function writeInputIdentityClaim(
  resourcesDir,
  inputClaim,
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
    beforeSidecarPublish()
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
    typeof version !== 'string' ||
    !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-[0-9A-Za-z.-]{1,64})?(?:\+[0-9A-Za-z.-]{1,64})?$/.test(
      version
    ) ||
    !['x64', 'arm64'].includes(architecture)
  ) {
    throw new Error('Ash package identity inputs do not match the supported release contract')
  }
  const commit = /^[a-f0-9]{40}$/.test(sourceCommit ?? '') ? sourceCommit : null
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
      () => {
        assertPinnedPathUnchanged(archivePath, archiveCopy, 'Packaged app.asar')
        assertPinnedPathUnchanged(cliPackagePath, cliPackage, 'Compiled CLI package.json')
      },
      beforeSidecarPublish
    )
    return inputClaim
  } finally {
    await Promise.allSettled([archiveCopy?.handle.close(), cliPackage?.handle.close()])
    await rm(privateDir, { recursive: true, force: true })
  }
}

module.exports = { createAshPackageInputIdentityClaim }
