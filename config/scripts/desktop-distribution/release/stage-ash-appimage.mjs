import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdtemp, open, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { authenticateAshReleaseManifest } from './ash-appimage-release-manifest.mjs'
import { verifyAshAppImageEmbeddedPayloadAttestation } from './ash-appimage-embedded-payload-attestation.mjs'

const BASE_ACTIVATION_BLOCKERS = Object.freeze([
  'No approved Ash release trust root or verified release feed is available.',
  'No production AppImage installation destination or versioned slot switch is configured.',
  'No stopped GUI, PTY, and Ash agent-session census or exclusive update maintenance gate is connected.',
  'No complete compatible snapshot covers every mutable Ash state domain.'
])

function activationBlockers(hasVerifiedOfflineAttestation) {
  return [
    ...BASE_ACTIVATION_BLOCKERS,
    hasVerifiedOfflineAttestation
      ? 'The embedded payload attestation was checked only under caller-selected offline keys.'
      : 'The signed manifest or packaging input claim is not matched to the embedded AppImage payload.'
  ]
}

async function assertPinnedPrivateStageRoot(root) {
  const pinned = await root.handle.stat()
  const current = await lstat(root.path)
  if (
    !pinned.isDirectory() ||
    !current.isDirectory() ||
    pinned.dev !== current.dev ||
    pinned.ino !== current.ino ||
    pinned.uid !== process.getuid() ||
    (pinned.mode & 0o077) !== 0 ||
    (current.mode & 0o077) !== 0 ||
    (await realpath(root.path)) !== root.path
  ) {
    throw new Error('Ash release staging directory changed during publishing')
  }
}

async function openPrivateStageRoot(path) {
  if (process.platform !== 'linux') {
    throw new Error('Ash release staging requires a private, owned local directory')
  }
  const absolutePath = resolve(path)
  let handle
  try {
    handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    const root = { path: absolutePath, handle, anchoredPath: `/proc/self/fd/${handle.fd}` }
    await assertPinnedPrivateStageRoot(root)
    return root
  } catch (error) {
    await handle?.close()
    throw new Error('Ash release staging requires a private, owned local directory', {
      cause: error
    })
  }
}

function isExpectedAppImage(header, machine) {
  return (
    header[0] === 0x7f &&
    header.toString('ascii', 1, 4) === 'ELF' &&
    header[4] === 2 &&
    header[5] === 1 &&
    header[6] === 1 &&
    header[8] === 0x41 &&
    header[9] === 0x49 &&
    header[10] === 2 &&
    header.readUInt16LE(18) === machine
  )
}

/**
 * Offline release tooling. The operator must supply an independently trusted
 * Ash key. Desktop builds supply no key and have no staging or install route.
 */
export async function stageAshAppImage({
  manifestBytes,
  signature,
  policy,
  artifactPath,
  stageRoot,
  embeddedPayloadAttestation
}) {
  const { manifest, expected } = authenticateAshReleaseManifest({
    manifestBytes,
    signature,
    policy
  })
  if (
    basename(artifactPath) !== expected.name ||
    (await realpath(artifactPath)) !== resolve(artifactPath)
  ) {
    throw new Error('Ash release asset path does not match the signed name')
  }
  const root = await openPrivateStageRoot(stageRoot)
  let source
  let directory
  let partial
  let publishedPath
  let durable = false
  let verifiedAttestation
  try {
    source = await open(
      artifactPath,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
    )
    const info = await source.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size !== manifest.size) {
      throw new Error('Ash release asset must be a regular file of the signed size')
    }
    // Keep all writes rooted to the validated directory inode, even if its
    // caller-visible pathname is replaced while the artifact is being copied.
    directory = await mkdtemp(join(root.anchoredPath, '.ash-release-'))
    partial = join(directory, '.partial')
    const destination = await open(partial, 'wx', 0o600)
    try {
      const hash = createHash('sha256')
      const header = Buffer.alloc(20)
      let bytes = 0
      const buffer = Buffer.alloc(128 * 1024)
      while (bytes <= manifest.size) {
        const { bytesRead } = await source.read(
          buffer,
          0,
          Math.min(buffer.length, manifest.size - bytes + 1),
          bytes
        )
        if (bytesRead === 0) {
          break
        }
        const chunk = buffer.subarray(0, bytesRead)
        if (bytes < header.length) {
          chunk.copy(header, bytes, 0, header.length - bytes)
        }
        hash.update(chunk)
        await destination.writeFile(chunk)
        bytes += bytesRead
      }
      const stagedArtifactSha256 = hash.digest('hex')
      if (
        bytes !== manifest.size ||
        stagedArtifactSha256 !== manifest.sha256 ||
        !isExpectedAppImage(header, expected.elfMachine)
      ) {
        throw new Error('Ash release asset failed digest or AppImage architecture verification')
      }
      if (embeddedPayloadAttestation) {
        verifiedAttestation = verifyAshAppImageEmbeddedPayloadAttestation({
          ...embeddedPayloadAttestation,
          manifestBytes,
          manifest,
          stagedArtifactSha256
        })
      }
      await destination.sync()
    } finally {
      await destination.close()
    }
    publishedPath = join(directory, expected.name)
    await rename(partial, publishedPath)
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
    await root.handle.sync()
    await assertPinnedPrivateStageRoot(root)
    durable = true
    const inputClaim = manifest.packageInputIdentityClaim
    return {
      path: join(root.path, basename(directory), expected.name),
      manifestVersion: manifest.version,
      sha256: manifest.sha256,
      candidateIdentity: {
        state: 'unverified',
        source: verifiedAttestation
          ? 'signed-embedded-payload-attestation'
          : inputClaim
            ? 'signed-packaging-input-claim'
            : 'signed-manifest-claim',
        appIdClaim: manifest.product,
        productNameClaim: inputClaim?.productName ?? null,
        versionClaim: manifest.version,
        architectureClaim: manifest.architecture,
        artifactSha256: manifest.sha256,
        artifactSha256Verified: true,
        reason: verifiedAttestation
          ? 'caller-key-attestation-does-not-establish-an-approved-ash-trust-root'
          : 'embedded-appimage-payload-not-inspected',
        ...(inputClaim
          ? {
              packagingInputClaim: {
                evidenceKind: inputClaim.evidenceKind,
                sourceCommit: inputClaim.sourceCommit,
                capturedAppAsarSha256: inputClaim.capturedAppAsarSha256,
                capturedCompiledCliPackageJsonSha256:
                  inputClaim.capturedCompiledCliPackageJsonSha256
              }
            }
          : {})
      },
      offlineAttestation: verifiedAttestation
        ? {
            state: 'verified-under-caller-key',
            sha256: verifiedAttestation.sha256,
            publicKeySha256: verifiedAttestation.publicKeySha256,
            manifestSha256: verifiedAttestation.payload.manifestSha256,
            artifactSha256: verifiedAttestation.payload.manifest.identity.sha256,
            sourceCommit: verifiedAttestation.payload.claimProvenance.sourceCommit,
            sourceCommitBinding: verifiedAttestation.payload.claimProvenance.sourceCommitBinding
          }
        : null,
      ashPackageIdentityVerified: false,
      activationAvailable: false,
      activationBlockers: activationBlockers(verifiedAttestation !== undefined)
    }
  } finally {
    try {
      await source?.close()
    } finally {
      try {
        if (!durable && directory) {
          for (const path of [partial, publishedPath]) {
            if (path) {
              await rm(path, { force: true })
            }
          }
          await rmdir(directory)
        }
      } finally {
        await root.handle.close()
      }
    }
  }
}
