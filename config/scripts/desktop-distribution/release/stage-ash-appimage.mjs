import { createHash, verify } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdtemp, open, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'

const APPIMAGE_ASSETS = {
  x64: { name: 'ash-ide-linux.AppImage', elfMachine: 62 },
  arm64: { name: 'ash-ide-linux-arm64.AppImage', elfMachine: 183 }
}
const MAX_MANIFEST_BYTES = 16 * 1024
const MAX_ARTIFACT_BYTES = 2 * 1024 ** 3
const MAX_MANIFEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVATION_BLOCKERS = Object.freeze([
  'No approved Ash release trust root or verified release feed is available.',
  'The signed manifest or packaging input claim is not matched to the embedded AppImage payload.',
  'No production AppImage installation destination or versioned slot switch is configured.',
  'No stopped GUI, PTY, and Ash agent-session census or exclusive update maintenance gate is connected.',
  'No complete compatible snapshot covers every mutable Ash state domain.'
])
const stableVersion = z
  .string()
  .max(32)
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/)
const packageInputIdentityClaimSchema = z.strictObject({
  schema: z.literal(1),
  evidenceKind: z.literal('packaging-input-snapshot'),
  appId: z.literal('com.ashide.desktop'),
  productName: z.literal('Ash IDE'),
  packageName: z.literal('ash-ide'),
  version: stableVersion,
  architecture: z.enum(['x64', 'arm64']),
  sourceCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  capturedAppAsarSha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedCompiledCliPackageJsonSha256: z.string().regex(/^[a-f0-9]{64}$/)
})
const manifestSchema = z.strictObject({
  schema: z.literal(1),
  product: z.literal('com.ashide.desktop'),
  repository: z.literal('Suraj-H675/Ash-IDE'),
  platform: z.literal('linux'),
  architecture: z.enum(['x64', 'arm64']),
  format: z.literal('AppImage'),
  version: stableVersion,
  tag: z.string().max(33),
  asset: z.string().max(64),
  size: z.number().int().min(20).max(MAX_ARTIFACT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  packageInputIdentityClaim: packageInputIdentityClaimSchema.optional(),
  issuedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive()
})

function isUpgrade(candidate, installed) {
  const current = stableVersion.parse(installed).split('.').map(Number)
  const difference = candidate
    .split('.')
    .map((part, index) => Number(part) - current[index])
    .find((delta) => delta !== 0)
  return difference > 0
}

function authenticateManifest({ manifestBytes, signature, policy }) {
  if (policy?.publicKey?.asymmetricKeyType !== 'ed25519' || policy.publicKey.type !== 'public') {
    throw new Error('Ash release trust is unavailable')
  }
  if (
    !Buffer.isBuffer(manifestBytes) ||
    manifestBytes.length > MAX_MANIFEST_BYTES ||
    !Buffer.isBuffer(signature) ||
    signature.length !== 64 ||
    !verify(null, manifestBytes, policy.publicKey, signature)
  ) {
    throw new Error('Invalid Ash release manifest signature')
  }

  // Release signer and verifier must agree on ONE representation. Accept only
  // compact JSON.stringify bytes: duplicate member names, alternate number
  // formatting, reordered escaping and whitespace cannot be signed ambiguously.
  const source = manifestBytes.toString('utf8')
  const parsed = JSON.parse(source)
  if (JSON.stringify(parsed) !== source) {
    throw new Error('Ash release manifest must use compact canonical JSON without duplicate keys')
  }
  const manifest = manifestSchema.parse(parsed)
  const expected = APPIMAGE_ASSETS[manifest.architecture]
  const now = Date.now()
  if (
    policy.architecture !== manifest.architecture ||
    !isUpgrade(manifest.version, policy.installedVersion) ||
    manifest.tag !== `v${manifest.version}` ||
    manifest.asset !== expected.name ||
    manifest.issuedAtMs > now ||
    manifest.expiresAtMs <= now ||
    manifest.expiresAtMs - manifest.issuedAtMs > MAX_MANIFEST_LIFETIME_MS
  ) {
    throw new Error(
      'Ash release does not match the installed build or is outside its validity period'
    )
  }
  if (
    manifest.packageInputIdentityClaim &&
    (manifest.packageInputIdentityClaim.appId !== manifest.product ||
      manifest.packageInputIdentityClaim.version !== manifest.version ||
      manifest.packageInputIdentityClaim.architecture !== manifest.architecture)
  ) {
    throw new Error('Ash signed packaging identity does not match the signed release manifest')
  }
  return { manifest, expected }
}

async function requirePrivateStageRoot(path) {
  const root = resolve(path)
  const stat = await lstat(root)
  if (
    process.platform !== 'linux' ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0 ||
    (await realpath(root)) !== root
  ) {
    throw new Error('Ash release staging requires a private, owned local directory')
  }
  return root
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
  stageRoot
}) {
  const { manifest, expected } = authenticateManifest({ manifestBytes, signature, policy })
  if (
    basename(artifactPath) !== expected.name ||
    (await realpath(artifactPath)) !== resolve(artifactPath)
  ) {
    throw new Error('Ash release asset path does not match the signed name')
  }
  const root = await requirePrivateStageRoot(stageRoot)
  const source = await open(
    artifactPath,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
  )
  let directory
  let partial
  let publishedPath
  let durable = false
  try {
    const info = await source.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size !== manifest.size) {
      throw new Error('Ash release asset must be a regular file of the signed size')
    }
    directory = await mkdtemp(join(root, '.ash-release-'))
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
      if (
        bytes !== manifest.size ||
        hash.digest('hex') !== manifest.sha256 ||
        !isExpectedAppImage(header, expected.elfMachine)
      ) {
        throw new Error('Ash release asset failed digest or AppImage architecture verification')
      }
      await destination.sync()
    } finally {
      await destination.close()
    }
    publishedPath = join(directory, expected.name)
    await rename(partial, publishedPath)
    for (const path of [directory, root]) {
      const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY)
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    durable = true
    const inputClaim = manifest.packageInputIdentityClaim
    return {
      path: publishedPath,
      manifestVersion: manifest.version,
      sha256: manifest.sha256,
      candidateIdentity: {
        state: 'unverified',
        source: inputClaim ? 'signed-packaging-input-claim' : 'signed-manifest-claim',
        appIdClaim: manifest.product,
        productNameClaim: inputClaim?.productName ?? null,
        versionClaim: manifest.version,
        architectureClaim: manifest.architecture,
        artifactSha256: manifest.sha256,
        artifactSha256Verified: true,
        reason: 'embedded-appimage-payload-not-inspected',
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
      ashPackageIdentityVerified: false,
      activationAvailable: false,
      activationBlockers: ACTIVATION_BLOCKERS
    }
  } finally {
    await source.close()
    if (!durable && directory) {
      for (const path of [partial, publishedPath]) {
        if (path) {
          await rm(path, { force: true })
        }
      }
      await rmdir(directory)
    }
  }
}
