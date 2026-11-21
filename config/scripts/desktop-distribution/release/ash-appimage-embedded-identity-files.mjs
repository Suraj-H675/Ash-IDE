import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

export const MAX_APPIMAGE_BYTES = 512 * 1024 * 1024
const COPY_CHUNK_BYTES = 256 * 1024

function sameSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

export function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} is not valid UTF-8`)
  }
}

export async function assertPrivateDirectory(path, label) {
  const info = await lstat(path, { bigint: true })
  if (
    !info.isDirectory() ||
    info.uid !== BigInt(process.getuid()) ||
    (info.mode & 0o077n) !== 0n ||
    (await realpath(path)) !== resolve(path)
  ) {
    throw new Error(`${label} must be a private, owned real directory`)
  }
}

export async function openPinnedRegularFile(path, label, maxBytes, { privateFile = false } = {}) {
  const absolutePath = resolve(path)
  if ((await realpath(path)) !== absolutePath) {
    throw new Error(`${label} path must not contain symlink aliases`)
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const info = await handle.stat({ bigint: true })
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      info.size <= 0n ||
      info.size > BigInt(maxBytes) ||
      (privateFile && (info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n))
    ) {
      throw new Error(`${label} must be a bounded regular single-link file`)
    }
    return { handle, info, path: absolutePath }
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function assertPathStillMatches(path, pinned, label) {
  let currentPath
  try {
    const currentHandleInfo = await pinned.handle.stat({ bigint: true })
    currentPath = await lstat(path, { bigint: true })
    if (
      !currentHandleInfo.isFile() ||
      !currentPath.isFile() ||
      !sameSnapshot(pinned.info, currentHandleInfo) ||
      !sameSnapshot(pinned.info, currentPath) ||
      (await realpath(path)) !== resolve(path)
    ) {
      throw new Error(`${label} changed while being inspected`)
    }
  } catch (error) {
    if (error instanceof Error && error.message === `${label} changed while being inspected`) {
      throw error
    }
    throw new Error(`${label} changed while being inspected`, { cause: error })
  }
}

export async function copyPinnedAppImage(artifactPath, expectedSha256, snapshotPath) {
  const pinned = await openPinnedRegularFile(artifactPath, 'AppImage', MAX_APPIMAGE_BYTES)
  const hash = createHash('sha256')
  const header = Buffer.alloc(20)
  const buffer = Buffer.alloc(COPY_CHUNK_BYTES)
  let offset = 0
  let destination
  let retainSource = false
  try {
    destination = await open(snapshotPath, 'wx', 0o600)
    while (offset < Number(pinned.info.size)) {
      const { bytesRead } = await pinned.handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(pinned.info.size) - offset),
        offset
      )
      if (bytesRead === 0) {
        throw new Error('AppImage changed while being copied')
      }
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      if (offset < header.length) {
        chunk.copy(header, offset, 0, header.length - offset)
      }
      let written = 0
      while (written < bytesRead) {
        const result = await destination.write(
          chunk,
          written,
          bytesRead - written,
          offset + written
        )
        if (result.bytesWritten === 0) {
          throw new Error('Could not write the private AppImage snapshot')
        }
        written += result.bytesWritten
      }
      offset += bytesRead
    }
    await assertPathStillMatches(artifactPath, pinned, 'AppImage')
    const digest = hash.digest('hex')
    if (offset !== Number(pinned.info.size) || digest !== expectedSha256) {
      throw new Error('AppImage copy did not match the required outer SHA-256')
    }
    await destination.sync()
    await destination.close()
    destination = undefined
    retainSource = true
    return { handle: pinned.handle, info: pinned.info, digest, header }
  } finally {
    try {
      await destination?.close()
    } finally {
      if (!retainSource) {
        await pinned.handle.close()
        await rm(snapshotPath, { force: true })
      }
    }
  }
}

export async function hashPinnedFile(path, label, maxBytes) {
  const pinned = await openPinnedRegularFile(path, label, maxBytes, { privateFile: true })
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(COPY_CHUNK_BYTES)
  let offset = 0
  try {
    while (offset < Number(pinned.info.size)) {
      const { bytesRead } = await pinned.handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(pinned.info.size) - offset),
        offset
      )
      if (bytesRead === 0) {
        throw new Error(`${label} changed while being hashed`)
      }
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    await assertPathStillMatches(path, pinned, label)
    return hash.digest('hex')
  } finally {
    await pinned.handle.close()
  }
}

export async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length)
  let bytesReadTotal = 0
  while (bytesReadTotal < length) {
    const { bytesRead } = await handle.read(
      buffer,
      bytesReadTotal,
      length - bytesReadTotal,
      position + bytesReadTotal
    )
    if (bytesRead === 0) {
      return null
    }
    bytesReadTotal += bytesRead
  }
  return buffer
}
