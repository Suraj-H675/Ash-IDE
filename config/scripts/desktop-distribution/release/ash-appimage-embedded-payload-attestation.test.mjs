import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  serializeAshAppImageEmbeddedPayloadAttestation,
  createSignedAshAppImageEmbeddedPayloadAttestation
} from './ash-appimage-embedded-payload-attestation.mjs'
import { stageAshAppImage } from './stage-ash-appimage.mjs'
import { verifyAshAppImageEmbeddedIdentity } from './verify-ash-appimage-embedded-identity-qa.mjs'

const manifestKeys = generateKeyPairSync('ed25519')
const attestationKeys = generateKeyPairSync('ed25519')
const foreignKeys = generateKeyPairSync('ed25519')
const attestationPublicKeyBytes = Buffer.from(
  attestationKeys.publicKey.export({ format: 'pem', type: 'spki' })
)
const attestationPublicKeySha256 = createHash('sha256')
  .update(attestationPublicKeyBytes)
  .digest('hex')
const realArtifactPath = process.env.ASH_M8_REAL_APPIMAGE_FIXTURE
const realArtifactSha256 = process.env.ASH_M8_REAL_APPIMAGE_SHA256
const realArchitecture = process.env.ASH_M8_REAL_APPIMAGE_ARCHITECTURE
const missingSidecarArtifactPath = process.env.ASH_M8_MISSING_SIDECAR_FIXTURE
const missingSidecarArtifactSha256 = process.env.ASH_M8_MISSING_SIDECAR_SHA256
const readerPath = process.env.ASH_M8_UNSQUASHFS_READER
const hasRealFixtures =
  process.platform === 'linux' &&
  realArtifactPath &&
  realArtifactSha256 &&
  realArchitecture &&
  missingSidecarArtifactPath &&
  missingSidecarArtifactSha256 &&
  readerPath

let root
let stageRoot
let artifactPath
let artifact
let manifest

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function manifestIdentity(value) {
  return {
    product: value.product,
    repository: value.repository,
    platform: value.platform,
    architecture: value.architecture,
    format: value.format,
    version: value.version,
    tag: value.tag,
    asset: value.asset,
    size: value.size,
    sha256: value.sha256,
    issuedAtMs: value.issuedAtMs,
    expiresAtMs: value.expiresAtMs
  }
}

function attestationFixture(value, mutate = (payload) => payload) {
  const manifestBytes = Buffer.from(JSON.stringify(value))
  const claim = value.packageInputIdentityClaim
  const payload = mutate({
    schema: 1,
    kind: 'ash-appimage-embedded-payload-attestation',
    manifestSha256: sha256(manifestBytes),
    manifest: { sha256: value.sha256, identity: manifestIdentity(value) },
    embedded: {
      packageInputIdentityClaim: { ...claim },
      files: {
        appAsarSha256: claim.capturedAppAsarSha256,
        compiledCliPackageJsonSha256: claim.capturedCompiledCliPackageJsonSha256,
        desktopSha256: 'd'.repeat(64),
        sidecarSha256: 'e'.repeat(64)
      },
      desktop: {
        name: 'Ash IDE',
        startupWmClass: 'com.ashide.desktop',
        version: value.version
      }
    },
    claimProvenance: {
      kind: 'embedded-packaging-input-snapshot',
      sourceCommit: claim.sourceCommit,
      callerPinnedSourceCommit: claim.sourceCommit,
      sourceCommitBinding:
        claim.sourceCommit === null ? 'missing-from-embedded-claim' : 'caller-pinned-match'
    },
    qa: {
      checkpoint: 'PK-05',
      kind: 'embedded-appimage-identity-diagnostic',
      outcome: 'matched',
      artifactSha256Before: value.sha256,
      artifactSha256After: value.sha256,
      architecture: value.architecture,
      reader: { version: 'unsquashfs 4.7.5', sha256: '1'.repeat(64) },
      squashfs: {
        offset: 944632,
        version: '4.0',
        compression: 'zstd',
        blockSize: 131072,
        bytesUsed: 1000,
        inodeCount: 20
      }
    }
  })
  const bytes = serializeAshAppImageEmbeddedPayloadAttestation(payload)
  return {
    payload,
    attestationBytes: bytes,
    signature: sign(null, bytes, attestationKeys.privateKey),
    policy: {
      publicKey: attestationKeys.publicKey,
      publicKeySha256: attestationPublicKeySha256,
      expectedSourceCommit: claim.sourceCommit
    }
  }
}

function signedManifest(value) {
  const manifestBytes = Buffer.from(JSON.stringify(value))
  return { manifestBytes, signature: sign(null, manifestBytes, manifestKeys.privateKey) }
}

function stage(value = manifest, options = {}) {
  const signed = signedManifest(value)
  return stageAshAppImage({
    ...signed,
    policy: {
      publicKey: manifestKeys.publicKey,
      architecture: value.architecture,
      installedVersion: '0.1.0',
      ...options.policy
    },
    artifactPath: options.artifactPath ?? artifactPath,
    stageRoot,
    embeddedPayloadAttestation: options.embeddedPayloadAttestation
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ash-embedded-attestation-'))
  stageRoot = join(root, 'stage')
  artifactPath = join(root, 'ash-ide-linux.AppImage')
  await mkdir(stageRoot, { mode: 0o700 })
  artifact = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(artifact)
  artifact.writeUInt16LE(62, 18)
  await writeFile(artifactPath, artifact)
  manifest = {
    schema: 1,
    product: 'com.ashide.desktop',
    repository: 'Suraj-H675/Ash-IDE',
    platform: 'linux',
    architecture: 'x64',
    format: 'AppImage',
    version: '0.2.0',
    tag: 'v0.2.0',
    asset: 'ash-ide-linux.AppImage',
    size: artifact.length,
    sha256: sha256(artifact),
    packageInputIdentityClaim: {
      schema: 1,
      evidenceKind: 'packaging-input-snapshot',
      appId: 'com.ashide.desktop',
      productName: 'Ash IDE',
      packageName: 'ash-ide',
      version: '0.2.0',
      architecture: 'x64',
      sourceCommit: 'a'.repeat(40),
      capturedAppAsarSha256: 'b'.repeat(64),
      capturedCompiledCliPackageJsonSha256: 'c'.repeat(64)
    },
    issuedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 60_000
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'linux')(
  'offline embedded-payload attestation staging',
  () => {
    it('verifies a caller-signed attestation while keeping candidate identity unverified', async () => {
      const evidence = attestationFixture(manifest)
      const staged = await stage(manifest, { embeddedPayloadAttestation: evidence })

      expect(staged).toMatchObject({
        candidateIdentity: {
          state: 'unverified',
          source: 'signed-embedded-payload-attestation',
          reason: 'caller-key-attestation-does-not-establish-an-approved-ash-trust-root'
        },
        offlineAttestation: {
          state: 'verified-under-caller-key',
          sha256: sha256(evidence.attestationBytes),
          publicKeySha256: attestationPublicKeySha256,
          manifestSha256: evidence.payload.manifestSha256,
          artifactSha256: manifest.sha256,
          sourceCommit: 'a'.repeat(40),
          sourceCommitBinding: 'caller-pinned-match'
        },
        ashPackageIdentityVerified: false,
        activationAvailable: false
      })
      expect(staged.activationBlockers).toContain(
        'The embedded payload attestation was checked only under caller-selected offline keys.'
      )
      expect(await readFile(staged.path)).toEqual(artifact)
      expect((await stat(staged.path)).mode & 0o777).toBe(0o600)
    })

    it('records an absent embedded source commit without treating it as provenance proof', async () => {
      const withoutSourceCommit = {
        ...manifest,
        packageInputIdentityClaim: {
          ...manifest.packageInputIdentityClaim,
          sourceCommit: null
        }
      }
      const staged = await stage(withoutSourceCommit, {
        embeddedPayloadAttestation: attestationFixture(withoutSourceCommit)
      })
      expect(staged.offlineAttestation).toMatchObject({
        state: 'verified-under-caller-key',
        sourceCommit: null,
        sourceCommitBinding: 'missing-from-embedded-claim'
      })
      expect(staged.candidateIdentity.state).toBe('unverified')
      expect(staged.activationAvailable).toBe(false)
    })

    it('rejects a foreign attestation signer and payload tampering', async () => {
      const foreign = attestationFixture(manifest)
      foreign.signature = sign(null, foreign.attestationBytes, foreignKeys.privateKey)
      await expect(stage(manifest, { embeddedPayloadAttestation: foreign })).rejects.toThrow(
        /signature/
      )

      const valid = attestationFixture(manifest)
      valid.attestationBytes[valid.attestationBytes.length - 1] ^= 1
      await expect(stage(manifest, { embeddedPayloadAttestation: valid })).rejects.toThrow(
        /signature/
      )
      expect(await readdir(stageRoot)).toEqual([])
    })

    it('rejects an attestation key fingerprint that does not identify its public key', async () => {
      const evidence = attestationFixture(manifest)
      evidence.policy.publicKeySha256 = 'f'.repeat(64)
      await expect(stage(manifest, { embeddedPayloadAttestation: evidence })).rejects.toThrow(
        /fingerprint/
      )
      const mismatchedBytes = attestationFixture(manifest)
      mismatchedBytes.policy.publicKeyPemBytes = Buffer.from(
        foreignKeys.publicKey.export({ format: 'pem', type: 'spki' })
      )
      mismatchedBytes.policy.publicKeySha256 = sha256(mismatchedBytes.policy.publicKeyPemBytes)
      await expect(
        stage(manifest, { embeddedPayloadAttestation: mismatchedBytes })
      ).rejects.toThrow(/pinned public key bytes disagree with key/)
      expect(await readdir(stageRoot)).toEqual([])
    })

    it('rejects an attestation larger than the contract limit', async () => {
      const attestationBytes = Buffer.alloc(16 * 1024 + 1, 0x20)
      await expect(
        stage(manifest, {
          embeddedPayloadAttestation: {
            attestationBytes,
            signature: sign(null, attestationBytes, attestationKeys.privateKey),
            policy: attestationFixture(manifest).policy
          }
        })
      ).rejects.toThrow(/signature/)
      expect(await readdir(stageRoot)).toEqual([])
    })

    it.each([
      [
        'outer artifact digest',
        (payload) => {
          payload.manifest.sha256 = 'f'.repeat(64)
          return payload
        }
      ],
      [
        'embedded version',
        (payload) => {
          payload.embedded.packageInputIdentityClaim.version = '0.3.0'
          return payload
        }
      ],
      [
        'embedded architecture',
        (payload) => {
          payload.embedded.packageInputIdentityClaim.architecture = 'arm64'
          return payload
        }
      ],
      [
        'source commit claim',
        (payload) => {
          payload.embedded.packageInputIdentityClaim.sourceCommit = 'd'.repeat(40)
          payload.claimProvenance.sourceCommit = 'd'.repeat(40)
          return payload
        }
      ]
    ])('rejects a same-key attestation with a changed %s', async (_label, mutate) => {
      const evidence = attestationFixture(manifest, mutate)
      await expect(stage(manifest, { embeddedPayloadAttestation: evidence })).rejects.toThrow(
        /does not match/
      )
      expect(await readdir(stageRoot)).toEqual([])
    })

    it('rejects a self-consistent forged source commit against the caller policy', async () => {
      const forgedManifest = {
        ...manifest,
        packageInputIdentityClaim: {
          ...manifest.packageInputIdentityClaim,
          sourceCommit: 'd'.repeat(40)
        }
      }
      const evidence = attestationFixture(forgedManifest)
      evidence.policy.expectedSourceCommit = 'a'.repeat(40)
      await expect(stage(forgedManifest, { embeddedPayloadAttestation: evidence })).rejects.toThrow(
        /does not match/
      )
      expect(await readdir(stageRoot)).toEqual([])
    })

    it('rejects duplicate and noncanonical attestation JSON even when signed', async () => {
      for (const transform of [
        (source) => source.replace('"schema":1', '"schema":1,"schema":1'),
        (source) => JSON.stringify(JSON.parse(source), null, 2)
      ]) {
        const evidence = attestationFixture(manifest)
        evidence.attestationBytes = Buffer.from(transform(evidence.attestationBytes.toString()))
        evidence.signature = sign(null, evidence.attestationBytes, attestationKeys.privateKey)
        await expect(stage(manifest, { embeddedPayloadAttestation: evidence })).rejects.toThrow(
          /canonical JSON/
        )
      }
      expect(await readdir(stageRoot)).toEqual([])
    })

    it('rejects expired, future, and replayed release statements', async () => {
      const expired = {
        ...manifest,
        issuedAtMs: Date.now() - 9 * 24 * 60 * 60 * 1000,
        expiresAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000
      }
      await expect(
        stage(expired, { embeddedPayloadAttestation: attestationFixture(expired) })
      ).rejects.toThrow(/validity period/)

      const future = {
        ...manifest,
        issuedAtMs: Date.now() + 60_000,
        expiresAtMs: Date.now() + 2 * 24 * 60 * 60 * 1000
      }
      await expect(
        stage(future, { embeddedPayloadAttestation: attestationFixture(future) })
      ).rejects.toThrow(/validity period/)

      await expect(
        stage(manifest, {
          embeddedPayloadAttestation: attestationFixture(manifest),
          policy: { installedVersion: manifest.version }
        })
      ).rejects.toThrow(/validity period/)

      const laterManifest = {
        ...manifest,
        version: '0.3.0',
        tag: 'v0.3.0',
        packageInputIdentityClaim: {
          ...manifest.packageInputIdentityClaim,
          version: '0.3.0'
        }
      }
      await expect(
        stage(laterManifest, { embeddedPayloadAttestation: attestationFixture(manifest) })
      ).rejects.toThrow(/does not match/)
      expect(await readdir(stageRoot)).toEqual([])
    })

    it('requires an explicit attestation key and source-commit policy', async () => {
      const evidence = attestationFixture(manifest)
      await expect(
        stage(manifest, {
          embeddedPayloadAttestation: { ...evidence, policy: undefined }
        })
      ).rejects.toThrow(/attestation trust is unavailable/)
      await expect(
        stage(manifest, {
          embeddedPayloadAttestation: {
            ...evidence,
            policy: {
              publicKey: attestationKeys.publicKey,
              publicKeySha256: attestationPublicKeySha256
            }
          }
        })
      ).rejects.toThrow(/policy is incomplete/)
    })
  }
)

describe.skipIf(!hasRealFixtures)('real AppImage signed attestation', () => {
  it('signs deterministic evidence only after real embedded identity QA passes', async () => {
    const report = await verifyAshAppImageEmbeddedIdentity({
      artifactPath: realArtifactPath,
      expectedSha256: realArtifactSha256,
      architecture: realArchitecture,
      readerPath
    })
    const identity = report.embeddedIdentity
    const manifestValue = {
      schema: 1,
      product: 'com.ashide.desktop',
      repository: 'Suraj-H675/Ash-IDE',
      platform: 'linux',
      architecture: realArchitecture,
      format: 'AppImage',
      version: identity.version,
      tag: `v${identity.version}`,
      asset:
        realArchitecture === 'arm64' ? 'ash-ide-linux-arm64.AppImage' : 'ash-ide-linux.AppImage',
      size: report.outerArtifact.size,
      sha256: report.outerArtifact.sha256,
      packageInputIdentityClaim: {
        schema: 1,
        evidenceKind: 'packaging-input-snapshot',
        appId: identity.appId,
        productName: identity.productName,
        packageName: identity.packageName,
        version: identity.version,
        architecture: identity.architecture,
        sourceCommit: identity.sourceCommit,
        capturedAppAsarSha256: identity.capturedAppAsarSha256,
        capturedCompiledCliPackageJsonSha256: identity.capturedCompiledCliPackageJsonSha256
      },
      issuedAtMs: Date.now() - 1000,
      expiresAtMs: Date.now() + 60_000
    }
    const signed = signedManifest(manifestValue)
    const result = await createSignedAshAppImageEmbeddedPayloadAttestation({
      artifactPath: realArtifactPath,
      expectedSha256: realArtifactSha256,
      architecture: realArchitecture,
      readerPath,
      manifestBytes: signed.manifestBytes,
      manifestSignature: signed.signature,
      manifestPolicy: { publicKey: manifestKeys.publicKey },
      expectedSourceCommit: identity.sourceCommit,
      signingKey: attestationKeys.privateKey
    })

    expect(result.payload).toMatchObject({
      manifest: { sha256: realArtifactSha256 },
      embedded: {
        files: {
          appAsarSha256: identity.appAsarSha256,
          compiledCliPackageJsonSha256: identity.compiledCliPackageJsonSha256,
          desktopSha256: identity.desktopSha256,
          sidecarSha256: identity.sidecarSha256
        }
      },
      claimProvenance: {
        sourceCommit: null,
        callerPinnedSourceCommit: null,
        sourceCommitBinding: 'missing-from-embedded-claim'
      }
    })
    expect(serializeAshAppImageEmbeddedPayloadAttestation(result.payload)).toEqual(result.bytes)
    expect(verify(null, result.bytes, attestationKeys.publicKey, result.signature)).toBe(true)
    expect(sign(null, result.bytes, attestationKeys.privateKey)).toEqual(result.signature)
    expect(await stat(realArtifactPath)).toMatchObject({ size: manifestValue.size })
  })

  it('refuses a real artifact without the sidecar and a manifest with a different version', async () => {
    const actual = await verifyAshAppImageEmbeddedIdentity({
      artifactPath: realArtifactPath,
      expectedSha256: realArtifactSha256,
      architecture: realArchitecture,
      readerPath
    })
    const identity = actual.embeddedIdentity
    const manifestValue = {
      schema: 1,
      product: 'com.ashide.desktop',
      repository: 'Suraj-H675/Ash-IDE',
      platform: 'linux',
      architecture: realArchitecture,
      format: 'AppImage',
      version: identity.version,
      tag: `v${identity.version}`,
      asset:
        realArchitecture === 'arm64' ? 'ash-ide-linux-arm64.AppImage' : 'ash-ide-linux.AppImage',
      size: actual.outerArtifact.size,
      sha256: realArtifactSha256,
      packageInputIdentityClaim: {
        schema: 1,
        evidenceKind: 'packaging-input-snapshot',
        appId: identity.appId,
        productName: identity.productName,
        packageName: identity.packageName,
        version: identity.version,
        architecture: identity.architecture,
        sourceCommit: identity.sourceCommit,
        capturedAppAsarSha256: identity.capturedAppAsarSha256,
        capturedCompiledCliPackageJsonSha256: identity.capturedCompiledCliPackageJsonSha256
      },
      issuedAtMs: Date.now() - 1000,
      expiresAtMs: Date.now() + 60_000
    }
    const mismatchedVersionManifest = {
      ...manifestValue,
      version: '0.2.0',
      tag: 'v0.2.0',
      packageInputIdentityClaim: {
        ...manifestValue.packageInputIdentityClaim,
        version: '0.2.0'
      }
    }
    const signed = signedManifest(mismatchedVersionManifest)
    await expect(
      createSignedAshAppImageEmbeddedPayloadAttestation({
        artifactPath: realArtifactPath,
        expectedSha256: realArtifactSha256,
        architecture: realArchitecture,
        readerPath,
        manifestBytes: signed.manifestBytes,
        manifestSignature: signed.signature,
        manifestPolicy: { publicKey: manifestKeys.publicKey },
        expectedSourceCommit: identity.sourceCommit,
        signingKey: attestationKeys.privateKey
      })
    ).rejects.toThrow(/caller-pinned release claims/)

    const negative = { ...manifestValue, sha256: missingSidecarArtifactSha256 }
    const negativeSigned = signedManifest(negative)
    await expect(
      createSignedAshAppImageEmbeddedPayloadAttestation({
        artifactPath: missingSidecarArtifactPath,
        expectedSha256: missingSidecarArtifactSha256,
        architecture: realArchitecture,
        readerPath,
        manifestBytes: negativeSigned.manifestBytes,
        manifestSignature: negativeSigned.signature,
        manifestPolicy: { publicKey: manifestKeys.publicKey },
        expectedSourceCommit: identity.sourceCommit,
        signingKey: attestationKeys.privateKey
      })
    ).rejects.toThrow(/identity\.json/)
  })
})
