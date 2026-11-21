const MAX_SQUASHFS_INODES = 50_000
const MAX_MAGIC_MATCHES = 4096
const MAX_LISTING_BYTES = 8 * 1024 * 1024
const SQUASHFS_MAGIC = Buffer.from('hsqs')
const SQUASHFS_SUPERBLOCK_BYTES = 96
const MAX_UINT64 = 0xffffffffffffffffn
const COMPRESSION_NAMES = Object.freeze({
  1: 'gzip',
  2: 'lzma',
  3: 'lzo',
  4: 'xz',
  5: 'lz4',
  6: 'zstd'
})
const REQUIRED_DIRECTORIES = Object.freeze([
  'resources',
  'resources/app.asar.unpacked',
  'resources/app.asar.unpacked/out'
])
export const REQUIRED_FILES = Object.freeze({
  'resources/app.asar': 64 * 1024 * 1024,
  'resources/app.asar.unpacked/out/package.json': 128 * 1024,
  'resources/ash-package-input-identity.json': 16 * 1024,
  'com.ashide.desktop.desktop': 8 * 1024
})

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} is not valid UTF-8`)
  }
}

function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

export function parseSquashfsSuperblock(bytes, offset, imageSize) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < SQUASHFS_SUPERBLOCK_BYTES ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(imageSize) ||
    offset < 0 ||
    offset + SQUASHFS_SUPERBLOCK_BYTES > imageSize ||
    !bytes.subarray(0, 4).equals(SQUASHFS_MAGIC)
  ) {
    return null
  }

  const inodeCount = bytes.readUInt32LE(4)
  const blockSize = bytes.readUInt32LE(12)
  const fragments = bytes.readUInt32LE(16)
  const compressionId = bytes.readUInt16LE(20)
  const blockLog = bytes.readUInt16LE(22)
  const flags = bytes.readUInt16LE(24)
  const idCount = bytes.readUInt16LE(26)
  const major = bytes.readUInt16LE(28)
  const minor = bytes.readUInt16LE(30)
  const rootInode = bytes.readBigUInt64LE(32)
  const bytesUsed = bytes.readBigUInt64LE(40)
  const tableOffsets = [48, 56, 64, 72, 80, 88].map((index) => bytes.readBigUInt64LE(index))
  const maxBytesUsed = BigInt(imageSize - offset)
  const requiredTableOffsets = [tableOffsets[0], tableOffsets[2], tableOffsets[3]]
  const optionalTableOffsets = [tableOffsets[1], tableOffsets[4], tableOffsets[5]]

  if (
    major !== 4 ||
    minor !== 0 ||
    inodeCount < 1 ||
    inodeCount > MAX_SQUASHFS_INODES ||
    fragments > MAX_SQUASHFS_INODES ||
    idCount < 1 ||
    idCount > MAX_SQUASHFS_INODES ||
    !Object.hasOwn(COMPRESSION_NAMES, compressionId) ||
    blockSize < 4096 ||
    blockSize > 1024 * 1024 ||
    (blockSize & (blockSize - 1)) !== 0 ||
    blockLog !== Math.log2(blockSize) ||
    flags > 0x0fff ||
    rootInode === MAX_UINT64 ||
    bytesUsed < BigInt(SQUASHFS_SUPERBLOCK_BYTES) ||
    bytesUsed > maxBytesUsed ||
    requiredTableOffsets.some((value) => value >= bytesUsed) ||
    optionalTableOffsets.some((value) => value !== MAX_UINT64 && value >= bytesUsed)
  ) {
    return null
  }

  return {
    offset,
    major,
    minor,
    inodeCount,
    blockSize,
    compressionId,
    compression: COMPRESSION_NAMES[compressionId],
    bytesUsed: Number(bytesUsed)
  }
}

export async function findSquashfsSuperblock(readAt, imageSize) {
  if (typeof readAt !== 'function' || !Number.isSafeInteger(imageSize) || imageSize <= 0) {
    throw new Error('SquashFS scan requires a bounded image reader')
  }
  const chunkBytes = 256 * 1024
  let position = 0
  let carry = Buffer.alloc(0)
  let magicMatches = 0
  const validCandidates = []
  while (position < imageSize) {
    const length = Math.min(chunkBytes, imageSize - position)
    const chunk = await readAt(position, length)
    if (!Buffer.isBuffer(chunk) || chunk.length !== length) {
      throw new Error('Private AppImage snapshot ended during SquashFS scan')
    }
    const data = Buffer.concat([carry, chunk])
    const dataOffset = position - carry.length
    let marker = data.indexOf(SQUASHFS_MAGIC)
    while (marker !== -1) {
      magicMatches += 1
      if (magicMatches > MAX_MAGIC_MATCHES) {
        throw new Error('AppImage contains too many SquashFS magic candidates')
      }
      const candidateOffset = dataOffset + marker
      const candidateBytes = await readAt(candidateOffset, SQUASHFS_SUPERBLOCK_BYTES)
      if (Buffer.isBuffer(candidateBytes)) {
        const candidate = parseSquashfsSuperblock(candidateBytes, candidateOffset, imageSize)
        if (candidate) {
          validCandidates.push(candidate)
          if (validCandidates.length > 1) {
            throw new Error('AppImage contains multiple structurally valid SquashFS filesystems')
          }
        }
      }
      marker = data.indexOf(SQUASHFS_MAGIC, marker + 1)
    }
    position += length
    carry = Buffer.from(data.subarray(Math.max(0, data.length - SQUASHFS_MAGIC.length + 1)))
  }
  if (validCandidates.length !== 1) {
    throw new Error('AppImage has no structurally valid SquashFS v4.0 filesystem')
  }
  return validCandidates[0]
}

export function parseSquashfsListing(output, inodeCount) {
  if (!Buffer.isBuffer(output) || output.length > MAX_LISTING_BYTES) {
    throw new Error('SquashFS listing exceeds the 8 MiB output limit')
  }
  const text = decodeUtf8(output, 'SquashFS listing')
  if (!text.endsWith('\n')) {
    throw new Error('SquashFS listing is incomplete')
  }
  const lines = text.slice(0, -1).split('\n')
  if (lines.length !== inodeCount || lines.length > MAX_SQUASHFS_INODES) {
    throw new Error('SquashFS listing does not match the bounded inode count')
  }

  const entries = new Map()
  let rootSeen = false
  for (const line of lines) {
    if (hasControlCharacters(line)) {
      throw new Error('SquashFS listing contains a control character in a path')
    }
    const match =
      /^([bcdlps-][rwxStTs-]{9})\s+\d+\/\d+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(
        line
      )
    if (!match) {
      throw new Error('SquashFS listing contains an unsupported entry')
    }
    const mode = match[1]
    const size = Number(match[2])
    const rawPath = match[3]
    const linkSeparator = rawPath.indexOf(' -> ')
    if (linkSeparator !== -1 && mode[0] !== 'l') {
      throw new Error('SquashFS listing contains an ambiguous path')
    }
    const path = linkSeparator === -1 ? rawPath : rawPath.slice(0, linkSeparator)
    if (path === 'squashfs-root') {
      if (rootSeen || mode[0] !== 'd') {
        throw new Error('SquashFS root is not a directory')
      }
      rootSeen = true
      continue
    }
    if (!path.startsWith('squashfs-root/')) {
      throw new Error('SquashFS listing contains a path outside its root')
    }
    const relativePath = path.slice('squashfs-root/'.length)
    const components = relativePath.split('/')
    if (
      components.some((component) => component === '' || component === '.' || component === '..')
    ) {
      throw new Error('SquashFS listing contains an unsafe path')
    }
    if (entries.has(relativePath)) {
      throw new Error('SquashFS listing contains a duplicate path')
    }
    entries.set(relativePath, { kind: mode[0], mode, size })
  }

  if (!rootSeen) {
    throw new Error('SquashFS listing is missing its root directory')
  }
  for (const directory of REQUIRED_DIRECTORIES) {
    if (entries.get(directory)?.kind !== 'd') {
      throw new Error(`Required SquashFS directory is absent or not regular: ${directory}`)
    }
  }
  for (const [path, maxBytes] of Object.entries(REQUIRED_FILES)) {
    const entry = entries.get(path)
    if (entry?.kind !== '-') {
      throw new Error(`Required SquashFS file is absent or not regular: ${path}`)
    }
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > maxBytes) {
      throw new Error(`Required SquashFS file exceeds its size limit: ${path}`)
    }
  }
  return entries
}
