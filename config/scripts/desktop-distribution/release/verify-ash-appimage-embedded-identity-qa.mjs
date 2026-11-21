import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  REQUIRED_FILES,
  findSquashfsSuperblock as scanSquashfsSuperblock,
  parseSquashfsListing
} from './ash-appimage-embedded-identity-squashfs.mjs'
import { verifyEmbeddedIdentityFiles } from './ash-appimage-embedded-identity-payload.mjs'
import {
  MAX_APPIMAGE_BYTES,
  assertPathStillMatches,
  assertPrivateDirectory,
  copyPinnedAppImage,
  hashPinnedFile,
  openPinnedRegularFile,
  readExactly
} from './ash-appimage-embedded-identity-files.mjs'
import {
  READER_MAX_BUFFER_BYTES,
  READER_VERSION,
  assertReaderUnchanged,
  isExpectedAppImage,
  parseSquashfsStats,
  runReader,
  squashfsArgs,
  verifyReader
} from './ash-appimage-embedded-identity-reader.mjs'

const MAX_LISTING_BYTES = 8 * 1024 * 1024

async function findSquashfsSuperblock(snapshotPath, imageSize) {
  const pinned = await openPinnedRegularFile(
    snapshotPath,
    'Private AppImage snapshot',
    MAX_APPIMAGE_BYTES,
    { privateFile: true }
  )
  try {
    const superblock = await scanSquashfsSuperblock(
      (position, length) => readExactly(pinned.handle, length, position),
      imageSize
    )
    await assertPathStillMatches(snapshotPath, pinned, 'Private AppImage snapshot')
    return superblock
  } finally {
    await pinned.handle.close()
  }
}

export async function verifyAshAppImageEmbeddedIdentity({
  artifactPath,
  expectedSha256,
  architecture,
  readerPath,
  onVerified
}) {
  if (process.platform !== 'linux') {
    throw new Error('Embedded AppImage identity QA requires Linux')
  }
  if (!['x64', 'arm64'].includes(architecture)) {
    throw new Error('Expected architecture must be x64 or arm64')
  }
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('A caller-pinned lowercase AppImage SHA-256 is required')
  }
  if (
    typeof artifactPath !== 'string' ||
    !artifactPath.startsWith('/') ||
    typeof readerPath !== 'string' ||
    !readerPath.startsWith('/')
  ) {
    throw new Error('AppImage and reader paths must be absolute')
  }

  const workRoot = await mkdtemp(join(tmpdir(), 'ash-appimage-identity-qa-'))
  let pinnedArtifact
  let reader
  try {
    await assertPrivateDirectory(workRoot, 'AppImage QA scratch directory')
    const snapshotPath = join(workRoot, 'candidate.AppImage')
    pinnedArtifact = await copyPinnedAppImage(artifactPath, expectedSha256, snapshotPath)
    if (!isExpectedAppImage(pinnedArtifact.header, architecture)) {
      throw new Error('AppImage ELF header does not match the expected architecture')
    }
    const beforeDigest = await hashPinnedFile(
      snapshotPath,
      'Private AppImage snapshot',
      MAX_APPIMAGE_BYTES
    )
    if (beforeDigest !== expectedSha256) {
      throw new Error('Private AppImage snapshot failed its pre-inspection SHA-256 check')
    }

    const superblock = await findSquashfsSuperblock(snapshotPath, Number(pinnedArtifact.info.size))
    reader = await verifyReader(readerPath)
    const statOutput = runReader(
      reader,
      squashfsArgs(superblock.offset, '-stat', snapshotPath),
      READER_MAX_BUFFER_BYTES,
      workRoot
    )
    parseSquashfsStats(statOutput, superblock)
    const listingOutput = runReader(
      reader,
      squashfsArgs(superblock.offset, '-lln', snapshotPath),
      MAX_LISTING_BYTES,
      workRoot
    )
    const entries = parseSquashfsListing(listingOutput, superblock.inodeCount)
    const extracted = new Map()
    for (const [target, maxBytes] of Object.entries(REQUIRED_FILES)) {
      const entry = entries.get(target)
      const output = runReader(
        reader,
        squashfsArgs(superblock.offset, '-cat', snapshotPath, target),
        Math.min(maxBytes + 1, entry.size + 1),
        workRoot
      )
      if (output.length !== entry.size) {
        throw new Error(`SquashFS reader returned an unexpected byte count for ${target}`)
      }
      extracted.set(target, output)
    }
    const identity = await verifyEmbeddedIdentityFiles(extracted, architecture)
    await assertReaderUnchanged(reader)
    const afterDigest = await hashPinnedFile(
      snapshotPath,
      'Private AppImage snapshot',
      MAX_APPIMAGE_BYTES
    )
    if (afterDigest !== expectedSha256 || afterDigest !== beforeDigest) {
      throw new Error('Private AppImage snapshot changed during embedded identity inspection')
    }
    await assertPathStillMatches(artifactPath, pinnedArtifact, 'AppImage')

    const result = {
      checkpoint: {
        id: 'PK-05',
        kind: 'embedded-appimage-identity-diagnostic',
        outcome: 'matched'
      },
      outerArtifact: {
        sha256: expectedSha256,
        sha256VerifiedBefore: true,
        sha256VerifiedAfter: true,
        size: Number(pinnedArtifact.info.size),
        architecture
      },
      squashfs: {
        offset: superblock.offset,
        version: `${superblock.major}.${superblock.minor}`,
        compression: superblock.compression,
        blockSize: superblock.blockSize,
        bytesUsed: superblock.bytesUsed,
        inodeCount: superblock.inodeCount
      },
      embeddedIdentity: {
        schema: identity.claim.schema,
        evidenceKind: identity.claim.evidenceKind,
        appId: identity.claim.appId,
        productName: identity.claim.productName,
        packageName: identity.claim.packageName,
        version: identity.claim.version,
        architecture: identity.claim.architecture,
        sourceCommit: identity.claim.sourceCommit,
        capturedAppAsarSha256: identity.claim.capturedAppAsarSha256,
        capturedCompiledCliPackageJsonSha256: identity.claim.capturedCompiledCliPackageJsonSha256,
        appAsarSha256: identity.appAsarSha256,
        compiledCliPackageJsonSha256: identity.compiledCliPackageJsonSha256,
        desktopSha256: identity.desktopSha256,
        sidecarSha256: identity.sidecarSha256,
        desktopName: identity.desktop.name,
        desktopStartupWMClass: identity.desktop.startupWmClass,
        desktopVersion: identity.desktop.version
      },
      reader: { version: READER_VERSION, sha256: reader.digest },
      candidateIdentity: {
        state: 'unverified',
        reason: 'diagnostic-payload-match-does-not-establish-release-authenticity'
      },
      ashPackageIdentityVerified: false,
      activationAvailable: false
    }
    onVerified?.(result)
    return result
  } finally {
    try {
      await reader?.handle.close()
    } finally {
      try {
        await pinnedArtifact?.handle.close()
      } finally {
        await rm(workRoot, { recursive: true, force: true })
      }
    }
  }
}

function parseArgs(args) {
  const options = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (
      !['--artifact', '--sha256', '--architecture', '--reader'].includes(key) ||
      typeof value !== 'string' ||
      options.has(key)
    ) {
      throw new Error(
        'Usage: verify-ash-appimage-embedded-identity-qa.mjs --artifact PATH --sha256 HEX --architecture x64|arm64 --reader PATH'
      )
    }
    options.set(key, value)
  }
  if (options.size !== 4) {
    throw new Error(
      'Usage: verify-ash-appimage-embedded-identity-qa.mjs --artifact PATH --sha256 HEX --architecture x64|arm64 --reader PATH'
    )
  }
  return {
    artifactPath: options.get('--artifact'),
    expectedSha256: options.get('--sha256'),
    architecture: options.get('--architecture'),
    readerPath: options.get('--reader')
  }
}

async function main() {
  try {
    const result = await verifyAshAppImageEmbeddedIdentity(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        checkpoint: {
          id: 'PK-05',
          kind: 'embedded-appimage-identity-diagnostic',
          outcome: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown verification failure'
        },
        candidateIdentity: { state: 'unverified' },
        ashPackageIdentityVerified: false,
        activationAvailable: false
      })}\n`
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
