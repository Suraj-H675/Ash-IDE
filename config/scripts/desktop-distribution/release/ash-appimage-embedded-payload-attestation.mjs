import { createHash, createPublicKey, sign, verify } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { z } from 'zod'
import {
  authenticateAshReleaseManifest,
  packageInputIdentityClaimSchema
} from './ash-appimage-release-manifest.mjs'
import { verifyAshAppImageEmbeddedIdentity } from './verify-ash-appimage-embedded-identity-qa.mjs'

const MAX_ATTESTATION_BYTES = 16 * 1024
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const sourceCommitSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .nullable()
const architectureSchema = z.enum(['x64', 'arm64'])
const manifestIdentitySchema = z.strictObject({
  product: z.literal('com.ashide.desktop'),
  repository: z.literal('Suraj-H675/Ash-IDE'),
  platform: z.literal('linux'),
  architecture: architectureSchema,
  format: z.literal('AppImage'),
  version: z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/),
  tag: z.string().max(33),
  asset: z.string().max(64),
  size: z
    .number()
    .int()
    .min(20)
    .max(2 * 1024 ** 3),
  sha256: sha256Schema,
  issuedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive()
})
const attestationSchema = z.strictObject({
  schema: z.literal(1),
  kind: z.literal('ash-appimage-embedded-payload-attestation'),
  manifestSha256: sha256Schema,
  manifest: z.strictObject({ sha256: sha256Schema, identity: manifestIdentitySchema }),
  embedded: z.strictObject({
    packageInputIdentityClaim: packageInputIdentityClaimSchema,
    files: z.strictObject({
      appAsarSha256: sha256Schema,
      compiledCliPackageJsonSha256: sha256Schema,
      desktopSha256: sha256Schema,
      sidecarSha256: sha256Schema
    }),
    desktop: z.strictObject({
      name: z.literal('Ash IDE'),
      startupWmClass: z.literal('com.ashide.desktop'),
      version: z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/)
    })
  }),
  claimProvenance: z.strictObject({
    kind: z.literal('embedded-packaging-input-snapshot'),
    sourceCommit: sourceCommitSchema,
    callerPinnedSourceCommit: sourceCommitSchema,
    sourceCommitBinding: z.enum(['caller-pinned-match', 'missing-from-embedded-claim'])
  }),
  qa: z.strictObject({
    checkpoint: z.literal('PK-05'),
    kind: z.literal('embedded-appimage-identity-diagnostic'),
    outcome: z.literal('matched'),
    artifactSha256Before: sha256Schema,
    artifactSha256After: sha256Schema,
    architecture: architectureSchema,
    reader: z.strictObject({
      version: z.string().max(32),
      sha256: sha256Schema
    }),
    squashfs: z.strictObject({
      offset: z.number().int().nonnegative(),
      version: z.string().max(16),
      compression: z.string().max(32),
      blockSize: z.number().int().positive(),
      bytesUsed: z.number().int().positive(),
      inodeCount: z.number().int().positive()
    })
  })
})

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function orderedAttestation(value) {
  return {
    schema: value.schema,
    kind: value.kind,
    manifestSha256: value.manifestSha256,
    manifest: {
      sha256: value.manifest.sha256,
      identity: {
        product: value.manifest.identity.product,
        repository: value.manifest.identity.repository,
        platform: value.manifest.identity.platform,
        architecture: value.manifest.identity.architecture,
        format: value.manifest.identity.format,
        version: value.manifest.identity.version,
        tag: value.manifest.identity.tag,
        asset: value.manifest.identity.asset,
        size: value.manifest.identity.size,
        sha256: value.manifest.identity.sha256,
        issuedAtMs: value.manifest.identity.issuedAtMs,
        expiresAtMs: value.manifest.identity.expiresAtMs
      }
    },
    embedded: {
      packageInputIdentityClaim: {
        schema: value.embedded.packageInputIdentityClaim.schema,
        evidenceKind: value.embedded.packageInputIdentityClaim.evidenceKind,
        appId: value.embedded.packageInputIdentityClaim.appId,
        productName: value.embedded.packageInputIdentityClaim.productName,
        packageName: value.embedded.packageInputIdentityClaim.packageName,
        version: value.embedded.packageInputIdentityClaim.version,
        architecture: value.embedded.packageInputIdentityClaim.architecture,
        sourceCommit: value.embedded.packageInputIdentityClaim.sourceCommit,
        capturedAppAsarSha256: value.embedded.packageInputIdentityClaim.capturedAppAsarSha256,
        capturedCompiledCliPackageJsonSha256:
          value.embedded.packageInputIdentityClaim.capturedCompiledCliPackageJsonSha256
      },
      files: {
        appAsarSha256: value.embedded.files.appAsarSha256,
        compiledCliPackageJsonSha256: value.embedded.files.compiledCliPackageJsonSha256,
        desktopSha256: value.embedded.files.desktopSha256,
        sidecarSha256: value.embedded.files.sidecarSha256
      },
      desktop: {
        name: value.embedded.desktop.name,
        startupWmClass: value.embedded.desktop.startupWmClass,
        version: value.embedded.desktop.version
      }
    },
    claimProvenance: {
      kind: value.claimProvenance.kind,
      sourceCommit: value.claimProvenance.sourceCommit,
      callerPinnedSourceCommit: value.claimProvenance.callerPinnedSourceCommit,
      sourceCommitBinding: value.claimProvenance.sourceCommitBinding
    },
    qa: {
      checkpoint: value.qa.checkpoint,
      kind: value.qa.kind,
      outcome: value.qa.outcome,
      artifactSha256Before: value.qa.artifactSha256Before,
      artifactSha256After: value.qa.artifactSha256After,
      architecture: value.qa.architecture,
      reader: { version: value.qa.reader.version, sha256: value.qa.reader.sha256 },
      squashfs: {
        offset: value.qa.squashfs.offset,
        version: value.qa.squashfs.version,
        compression: value.qa.squashfs.compression,
        blockSize: value.qa.squashfs.blockSize,
        bytesUsed: value.qa.squashfs.bytesUsed,
        inodeCount: value.qa.squashfs.inodeCount
      }
    }
  }
}

export function serializeAshAppImageEmbeddedPayloadAttestation(value) {
  const parsed = attestationSchema.parse(value)
  return Buffer.from(JSON.stringify(orderedAttestation(parsed)), 'utf8')
}

function parseCanonicalAttestation(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_ATTESTATION_BYTES) {
    throw new Error('Embedded AppImage attestation must be a bounded non-empty byte string')
  }
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Embedded AppImage attestation is not valid UTF-8')
  }
  const parsed = attestationSchema.parse(JSON.parse(source))
  if (!serializeAshAppImageEmbeddedPayloadAttestation(parsed).equals(bytes)) {
    throw new Error('Embedded AppImage attestation must use canonical JSON bytes')
  }
  return parsed
}

function releaseIdentity(manifest) {
  return {
    product: manifest.product,
    repository: manifest.repository,
    platform: manifest.platform,
    architecture: manifest.architecture,
    format: manifest.format,
    version: manifest.version,
    tag: manifest.tag,
    asset: manifest.asset,
    size: manifest.size,
    sha256: manifest.sha256,
    issuedAtMs: manifest.issuedAtMs,
    expiresAtMs: manifest.expiresAtMs
  }
}

function assertAttestationMatches({
  attestation,
  manifest,
  manifestBytes,
  stagedArtifactSha256,
  expectedSourceCommit
}) {
  const claim = manifest.packageInputIdentityClaim
  if (!claim) {
    throw new Error('A signed package-input identity claim is required for an embedded attestation')
  }
  if (
    attestation.manifestSha256 !== hash(manifestBytes) ||
    attestation.manifest.sha256 !== manifest.sha256 ||
    JSON.stringify(attestation.manifest.identity) !== JSON.stringify(releaseIdentity(manifest)) ||
    attestation.manifest.identity.sha256 !== stagedArtifactSha256 ||
    attestation.qa.artifactSha256Before !== stagedArtifactSha256 ||
    attestation.qa.artifactSha256After !== stagedArtifactSha256 ||
    attestation.qa.architecture !== manifest.architecture ||
    attestation.embedded.packageInputIdentityClaim.appId !== claim.appId ||
    attestation.embedded.packageInputIdentityClaim.productName !== claim.productName ||
    attestation.embedded.packageInputIdentityClaim.packageName !== claim.packageName ||
    attestation.embedded.packageInputIdentityClaim.version !== claim.version ||
    attestation.embedded.packageInputIdentityClaim.architecture !== claim.architecture ||
    attestation.embedded.packageInputIdentityClaim.sourceCommit !== claim.sourceCommit ||
    attestation.embedded.packageInputIdentityClaim.capturedAppAsarSha256 !==
      claim.capturedAppAsarSha256 ||
    attestation.embedded.packageInputIdentityClaim.capturedCompiledCliPackageJsonSha256 !==
      claim.capturedCompiledCliPackageJsonSha256 ||
    attestation.embedded.packageInputIdentityClaim.version !== manifest.version ||
    attestation.embedded.packageInputIdentityClaim.architecture !== manifest.architecture ||
    attestation.embedded.files.appAsarSha256 !== claim.capturedAppAsarSha256 ||
    attestation.embedded.files.compiledCliPackageJsonSha256 !==
      claim.capturedCompiledCliPackageJsonSha256 ||
    attestation.embedded.desktop.version !== manifest.version ||
    attestation.claimProvenance.sourceCommit !== claim.sourceCommit ||
    attestation.claimProvenance.callerPinnedSourceCommit !== expectedSourceCommit ||
    claim.sourceCommit !== expectedSourceCommit ||
    attestation.claimProvenance.sourceCommitBinding !==
      (claim.sourceCommit === null ? 'missing-from-embedded-claim' : 'caller-pinned-match')
  ) {
    throw new Error(
      'Embedded AppImage attestation does not match the signed manifest or staged artifact'
    )
  }
}

export function verifyAshAppImageEmbeddedPayloadAttestation({
  attestationBytes,
  signature,
  manifestBytes,
  manifest,
  stagedArtifactSha256,
  policy
}) {
  if (policy?.publicKey?.asymmetricKeyType !== 'ed25519' || policy.publicKey.type !== 'public') {
    throw new Error('Embedded AppImage attestation trust is unavailable')
  }
  if (
    typeof policy.publicKeySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(policy.publicKeySha256) ||
    !Object.hasOwn(policy, 'expectedSourceCommit') ||
    !sourceCommitSchema.safeParse(policy.expectedSourceCommit).success
  ) {
    throw new Error('Embedded AppImage attestation policy is incomplete')
  }
  const canonicalPublicKeyBytes = Buffer.from(
    policy.publicKey.export({ format: 'pem', type: 'spki' })
  )
  let fingerprintBytes = canonicalPublicKeyBytes
  if (policy.publicKeyPemBytes !== undefined) {
    if (
      !Buffer.isBuffer(policy.publicKeyPemBytes) ||
      policy.publicKeyPemBytes.length === 0 ||
      policy.publicKeyPemBytes.length > 8192
    ) {
      throw new Error('Embedded AppImage attestation public key bytes are invalid')
    }
    const pinnedKey = createPublicKey(policy.publicKeyPemBytes)
    if (
      pinnedKey.asymmetricKeyType !== 'ed25519' ||
      !Buffer.from(pinnedKey.export({ format: 'der', type: 'spki' })).equals(
        Buffer.from(policy.publicKey.export({ format: 'der', type: 'spki' }))
      )
    ) {
      throw new Error('Embedded AppImage attestation pinned public key bytes disagree with key')
    }
    // CLI fingerprints the exact pinned PEM file, including line endings.
    fingerprintBytes = policy.publicKeyPemBytes
  }
  if (hash(fingerprintBytes) !== policy.publicKeySha256) {
    throw new Error('Embedded AppImage attestation key fingerprint does not match its public key')
  }
  if (
    !Buffer.isBuffer(signature) ||
    signature.length !== 64 ||
    !Buffer.isBuffer(attestationBytes) ||
    attestationBytes.length === 0 ||
    attestationBytes.length > MAX_ATTESTATION_BYTES ||
    !verify(null, attestationBytes, policy.publicKey, signature)
  ) {
    throw new Error('Invalid embedded AppImage attestation signature')
  }
  const attestation = parseCanonicalAttestation(attestationBytes)
  assertAttestationMatches({
    attestation,
    manifest,
    manifestBytes,
    stagedArtifactSha256,
    expectedSourceCommit: policy.expectedSourceCommit
  })
  return {
    payload: attestation,
    sha256: hash(attestationBytes),
    publicKeySha256: policy.publicKeySha256
  }
}

function packageClaimMatches(left, right) {
  return (
    left.schema === right.schema &&
    left.evidenceKind === right.evidenceKind &&
    left.appId === right.appId &&
    left.productName === right.productName &&
    left.packageName === right.packageName &&
    left.version === right.version &&
    left.architecture === right.architecture &&
    left.sourceCommit === right.sourceCommit &&
    left.capturedAppAsarSha256 === right.capturedAppAsarSha256 &&
    left.capturedCompiledCliPackageJsonSha256 === right.capturedCompiledCliPackageJsonSha256
  )
}

function createAttestation({ report, manifest, manifestBytes, expectedSourceCommit }) {
  const identity = report.embeddedIdentity
  const claim = manifest.packageInputIdentityClaim
  if (
    !claim ||
    report.checkpoint?.id !== 'PK-05' ||
    report.checkpoint?.kind !== 'embedded-appimage-identity-diagnostic' ||
    report.checkpoint?.outcome !== 'matched' ||
    report.candidateIdentity?.state !== 'unverified' ||
    report.ashPackageIdentityVerified !== false ||
    report.activationAvailable !== false ||
    report.outerArtifact?.sha256VerifiedBefore !== true ||
    report.outerArtifact?.sha256VerifiedAfter !== true ||
    report.outerArtifact?.sha256 !== manifest.sha256 ||
    report.outerArtifact?.size !== manifest.size ||
    report.outerArtifact?.architecture !== manifest.architecture ||
    !packageClaimMatches(identity, claim) ||
    identity.sourceCommit !== expectedSourceCommit ||
    identity.version !== manifest.version ||
    identity.architecture !== manifest.architecture ||
    identity.desktopVersion !== manifest.version ||
    identity.appAsarSha256 !== claim.capturedAppAsarSha256 ||
    identity.compiledCliPackageJsonSha256 !== claim.capturedCompiledCliPackageJsonSha256
  ) {
    throw new Error('Embedded AppImage QA result does not match the caller-pinned release claims')
  }

  return attestationSchema.parse({
    schema: 1,
    kind: 'ash-appimage-embedded-payload-attestation',
    manifestSha256: hash(manifestBytes),
    manifest: { sha256: manifest.sha256, identity: releaseIdentity(manifest) },
    embedded: {
      packageInputIdentityClaim: claim,
      files: {
        appAsarSha256: identity.appAsarSha256,
        compiledCliPackageJsonSha256: identity.compiledCliPackageJsonSha256,
        desktopSha256: identity.desktopSha256,
        sidecarSha256: identity.sidecarSha256
      },
      desktop: {
        name: identity.desktopName,
        startupWmClass: identity.desktopStartupWMClass,
        version: identity.desktopVersion
      }
    },
    claimProvenance: {
      kind: 'embedded-packaging-input-snapshot',
      sourceCommit: identity.sourceCommit,
      callerPinnedSourceCommit: expectedSourceCommit,
      sourceCommitBinding:
        expectedSourceCommit === null ? 'missing-from-embedded-claim' : 'caller-pinned-match'
    },
    qa: {
      checkpoint: 'PK-05',
      kind: 'embedded-appimage-identity-diagnostic',
      outcome: 'matched',
      artifactSha256Before: report.outerArtifact.sha256,
      artifactSha256After: report.outerArtifact.sha256,
      architecture: report.outerArtifact.architecture,
      reader: report.reader,
      squashfs: report.squashfs
    }
  })
}

export async function createSignedAshAppImageEmbeddedPayloadAttestation({
  artifactPath,
  expectedSha256,
  architecture,
  readerPath,
  manifestBytes,
  manifestSignature,
  manifestPolicy,
  expectedSourceCommit,
  signingKey
}) {
  if (signingKey?.asymmetricKeyType !== 'ed25519' || signingKey.type !== 'private') {
    throw new Error('Embedded AppImage attestation signing requires an Ed25519 private key')
  }
  if (!sourceCommitSchema.safeParse(expectedSourceCommit).success) {
    throw new Error('A caller-pinned source commit or explicit null is required')
  }
  const { manifest, expected } = authenticateAshReleaseManifest({
    manifestBytes,
    signature: manifestSignature,
    policy: { ...manifestPolicy, architecture },
    requireUpgrade: false
  })
  if (
    manifest.sha256 !== expectedSha256 ||
    manifest.architecture !== architecture ||
    manifest.asset !== expected.name ||
    basename(resolve(artifactPath)) !== expected.name ||
    (await realpath(artifactPath)) !== resolve(artifactPath) ||
    !manifest.packageInputIdentityClaim
  ) {
    throw new Error('Signed manifest does not match the caller-pinned AppImage identity')
  }
  if (manifest.packageInputIdentityClaim.sourceCommit !== expectedSourceCommit) {
    throw new Error('Signed package-input source commit does not match the caller-pinned value')
  }

  let result
  await verifyAshAppImageEmbeddedIdentity({
    artifactPath,
    expectedSha256,
    architecture,
    readerPath,
    onVerified: (report) => {
      const payload = createAttestation({ report, manifest, manifestBytes, expectedSourceCommit })
      const bytes = serializeAshAppImageEmbeddedPayloadAttestation(payload)
      if (bytes.length > MAX_ATTESTATION_BYTES) {
        throw new Error('Embedded AppImage attestation exceeds its size limit')
      }
      result = { payload, bytes, signature: sign(null, bytes, signingKey) }
    }
  })
  if (!result) {
    throw new Error('Embedded AppImage QA did not complete its signed attestation callback')
  }
  return result
}
