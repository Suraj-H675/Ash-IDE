import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import {
  assertPrivateDirectory,
  decodeUtf8,
  hashPinnedFile,
  openPinnedRegularFile
} from './ash-appimage-embedded-identity-files.mjs'

const READER_SHA256 = '461e1fd9eac39c12e673042807459985636030d5557319343fc3a6ed4ba1677c'
export const READER_VERSION = '4.7.5'
const MAX_READER_BYTES = 2 * 1024 * 1024
const READER_TIMEOUT_MS = 10_000
export const READER_MAX_BUFFER_BYTES = 64 * 1024
const ELF_MACHINES = Object.freeze({ x64: 62, arm64: 183 })

export function runReader(readerPath, args, maxBuffer, cwd) {
  const result = spawnSync(readerPath, args, {
    cwd,
    env: { LC_ALL: 'C' },
    encoding: null,
    maxBuffer,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: READER_TIMEOUT_MS,
    windowsHide: true
  })
  if (result.error) {
    if (result.error.code === 'EPERM') {
      throw new Error('Host policy blocked the private SquashFS reader (EPERM)')
    }
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error('Private SquashFS reader exceeded the 10 second limit')
    }
    throw new Error('Could not start the private SquashFS reader')
  }
  if (result.status !== 0) {
    throw new Error(`Private SquashFS reader failed with status ${result.status ?? 'unknown'}`)
  }
  return result.stdout ?? Buffer.alloc(0)
}

export async function verifyReader(readerPath) {
  const pinned = await openPinnedRegularFile(readerPath, 'SquashFS reader', MAX_READER_BYTES, {
    privateFile: true
  })
  try {
    await assertPrivateDirectory(dirname(pinned.path), 'SquashFS reader directory')
    if ((pinned.info.mode & 0o111n) === 0n) {
      throw new Error('Private SquashFS reader is not executable')
    }
    const digest = await hashPinnedFile(readerPath, 'SquashFS reader', MAX_READER_BYTES)
    if (digest !== READER_SHA256) {
      throw new Error('SquashFS reader does not match the approved private binary digest')
    }
    return { path: pinned.path, digest }
  } finally {
    await pinned.handle.close()
  }
}

export async function assertReaderUnchanged(reader) {
  const digest = await hashPinnedFile(reader.path, 'SquashFS reader', MAX_READER_BYTES)
  if (digest !== reader.digest) {
    throw new Error('SquashFS reader changed while being used')
  }
}

export function squashfsArgs(offset, action, snapshotPath, target) {
  return [
    '-offset',
    String(offset),
    '-mem',
    '32M',
    '-processors',
    '1',
    action,
    snapshotPath,
    ...(target ? [target] : [])
  ]
}

export function parseSquashfsStats(output, superblock) {
  const text = decodeUtf8(output, 'SquashFS stat output')
  const hasValidVersion = /^Found a valid SQUASHFS 4:0 superblock on /m.test(text)
  const bytesUsed = /^Filesystem size (\d+) bytes/m.exec(text)?.[1]
  const blockSize = /^Block size (\d+)/m.exec(text)?.[1]
  const inodeCount = /^Number of inodes (\d+)/m.exec(text)?.[1]
  const compression = /^Compression ([A-Za-z0-9]+)/m.exec(text)?.[1]
  if (
    !hasValidVersion ||
    Number(bytesUsed) !== superblock.bytesUsed ||
    Number(blockSize) !== superblock.blockSize ||
    Number(inodeCount) !== superblock.inodeCount ||
    compression !== superblock.compression
  ) {
    throw new Error('Private reader output disagrees with the validated SquashFS superblock')
  }
}

export function isExpectedAppImage(header, architecture) {
  return (
    header.length >= 20 &&
    header[0] === 0x7f &&
    header.toString('ascii', 1, 4) === 'ELF' &&
    header[4] === 2 &&
    header[5] === 1 &&
    header[6] === 1 &&
    header[8] === 0x41 &&
    header[9] === 0x49 &&
    header[10] === 2 &&
    header.readUInt16LE(18) === ELF_MACHINES[architecture]
  )
}
