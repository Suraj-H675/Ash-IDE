import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSignedAshAppImageEmbeddedPayloadAttestation } from './ash-appimage-embedded-payload-attestation.mjs'

const cli = fileURLToPath(new URL('./stage-ash-appimage-cli.mjs', import.meta.url))
const repo = resolve(import.meta.dirname, '../../../..')
const artifactPath = process.env.ASH_M8_REAL_APPIMAGE_FIXTURE
const expectedSha256 = process.env.ASH_M8_REAL_APPIMAGE_SHA256
const architecture = process.env.ASH_M8_REAL_APPIMAGE_ARCHITECTURE
const readerPath = process.env.ASH_M8_UNSQUASHFS_READER
const identityPath = process.env.ASH_M8_REAL_PACKAGE_IDENTITY_PATH
const hasRealFixture =
  process.platform === 'linux' &&
  [artifactPath, expectedSha256, architecture, readerPath, identityPath].every(Boolean)

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fileSha256(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk)
  }
  return digest.digest('hex')
}

describe.skipIf(!hasRealFixture)('real AppImage offline operator CLI', () => {
  it('stages exact signed bytes under caller keys and rejects a tampered attestation', async () => {
    const identity = JSON.parse(await readFile(identityPath, 'utf8'))
    const sourceCommit =
      process.env.ASH_M8_REAL_EXPECTED_SOURCE_COMMIT === 'none'
        ? null
        : (process.env.ASH_M8_REAL_EXPECTED_SOURCE_COMMIT ?? identity.sourceCommit)
    expect(identity.sourceCommit).toBe(sourceCommit)

    const artifactInfo = await stat(artifactPath)
    const manifest = {
      schema: 1,
      product: 'com.ashide.desktop',
      repository: 'Suraj-H675/Ash-IDE',
      platform: 'linux',
      architecture,
      format: 'AppImage',
      version: identity.version,
      tag: `v${identity.version}`,
      asset: architecture === 'arm64' ? 'ash-ide-linux-arm64.AppImage' : 'ash-ide-linux.AppImage',
      size: artifactInfo.size,
      sha256: expectedSha256,
      packageInputIdentityClaim: identity,
      issuedAtMs: Date.now() - 1_000,
      expiresAtMs: Date.now() + 60_000
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    const releaseKeys = generateKeyPairSync('ed25519')
    const attestationKeys = generateKeyPairSync('ed25519')
    const manifestSignature = sign(null, manifestBytes, releaseKeys.privateKey)
    const attestation = await createSignedAshAppImageEmbeddedPayloadAttestation({
      artifactPath,
      expectedSha256,
      architecture,
      readerPath,
      manifestBytes,
      manifestSignature,
      manifestPolicy: {
        publicKey: releaseKeys.publicKey,
        architecture,
        installedVersion: '0.0.0'
      },
      expectedSourceCommit: sourceCommit,
      signingKey: attestationKeys.privateKey
    })

    const root = await mkdtemp(join(tmpdir(), 'ash-real-offline-cli-'))
    try {
      const stageRoot = join(root, 'stage')
      const rejectedRoot = join(root, 'rejected')
      await mkdir(stageRoot, { mode: 0o700 })
      await mkdir(rejectedRoot, { mode: 0o700 })
      const files = {
        manifest: manifestBytes,
        signature: manifestSignature,
        releaseKey: Buffer.from(releaseKeys.publicKey.export({ format: 'pem', type: 'spki' })),
        attestation: attestation.bytes,
        attestationSignature: attestation.signature,
        attestationKey: Buffer.from(
          attestationKeys.publicKey.export({ format: 'pem', type: 'spki' })
        )
      }
      const paths = Object.fromEntries(Object.keys(files).map((name) => [name, join(root, name)]))
      for (const [name, content] of Object.entries(files)) {
        await writeFile(paths[name], content, { mode: 0o600 })
      }
      const args = [
        '--manifest',
        paths.manifest,
        '--signature',
        paths.signature,
        '--public-key',
        paths.releaseKey,
        '--trusted-key-sha256',
        sha256(files.releaseKey),
        '--artifact',
        artifactPath,
        '--stage-root',
        stageRoot,
        '--architecture',
        architecture,
        '--installed-version',
        '0.0.0',
        '--attestation',
        paths.attestation,
        '--attestation-signature',
        paths.attestationSignature,
        '--attestation-public-key',
        paths.attestationKey,
        '--attestation-key-sha256',
        sha256(files.attestationKey),
        '--attestation-source-commit',
        sourceCommit ?? 'none'
      ]
      const invoke = (values) =>
        spawnSync(process.execPath, [cli, ...values], {
          cwd: repo,
          encoding: 'utf8',
          timeout: 30_000,
          maxBuffer: 128 * 1024
        })

      const success = invoke(args)
      expect(success.status, success.stderr).toBe(0)
      const staged = JSON.parse(success.stdout)
      expect(staged.offlineAttestation).toMatchObject({
        state: 'verified-under-caller-key',
        sourceCommit,
        sourceCommitBinding:
          sourceCommit === null ? 'missing-from-embedded-claim' : 'caller-pinned-match'
      })
      expect(staged.candidateIdentity.state).toBe('unverified')
      expect(staged.ashPackageIdentityVerified).toBe(false)
      expect(staged.activationAvailable).toBe(false)
      expect((await stat(staged.path)).mode & 0o777).toBe(0o600)
      expect(await fileSha256(staged.path)).toBe(expectedSha256)
      expect(await fileSha256(artifactPath)).toBe(expectedSha256)

      const tamperedPath = join(root, 'tampered-attestation-signature')
      await writeFile(tamperedPath, Buffer.alloc(64), { mode: 0o600 })
      const tamperedArgs = [...args]
      tamperedArgs[tamperedArgs.indexOf('--stage-root') + 1] = rejectedRoot
      tamperedArgs[tamperedArgs.indexOf('--attestation-signature') + 1] = tamperedPath
      const rejected = invoke(tamperedArgs)
      expect(rejected.status).not.toBe(0)
      expect(await readdir(rejectedRoot)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
