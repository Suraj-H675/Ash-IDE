import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serializeAshAppImageEmbeddedPayloadAttestation } from './ash-appimage-embedded-payload-attestation.mjs'
import { runStageAshAppImageCli } from './stage-ash-appimage-cli.mjs'

const cli = fileURLToPath(new URL('./stage-ash-appimage-cli.mjs', import.meta.url))
const repo = resolve(import.meta.dirname, '../../../..')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const { privateKey: attestationPrivateKey, publicKey: attestationPublicKey } =
  generateKeyPairSync('ed25519')
const trustedKeyBytes = Buffer.from(publicKey.export({ format: 'pem', type: 'spki' }))
const trustedKeySha256 = createHash('sha256').update(trustedKeyBytes).digest('hex')
const attestationKeyBytes = Buffer.from(
  attestationPublicKey.export({ format: 'pem', type: 'spki' })
)
const asset = 'ash-ide-linux.AppImage'
let temp
let stageRoot
let manifestPath
let signaturePath
let keyPath
let attestationKeyPath
let artifactPath
let manifest
let bytes

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'ash-stage-cli-'))
  stageRoot = join(temp, 'private-stage')
  await mkdir(stageRoot, { mode: 0o700 })
  bytes = Buffer.alloc(64, 0)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(bytes)
  bytes.writeUInt16LE(62, 18)
  artifactPath = join(temp, asset)
  manifestPath = join(temp, 'manifest.json')
  signaturePath = join(temp, 'manifest.sig')
  keyPath = join(temp, 'trusted.pem')
  attestationKeyPath = join(temp, 'attestation-trusted.pem')
  manifest = {
    schema: 1,
    product: 'com.ashide.desktop',
    repository: 'Suraj-H675/Ash-IDE',
    platform: 'linux',
    architecture: 'x64',
    format: 'AppImage',
    version: '0.2.0',
    tag: 'v0.2.0',
    asset,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    issuedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 60_000
  }
  await writeFile(artifactPath, bytes)
  await writeFile(keyPath, trustedKeyBytes)
  await writeFile(attestationKeyPath, attestationKeyBytes)
  await signFixture()
})

afterEach(async () => {
  await rm(temp, { recursive: true, force: true })
})

async function signFixture(data = Buffer.from(JSON.stringify(manifest))) {
  await writeFile(manifestPath, data)
  await writeFile(signaturePath, sign(null, data, privateKey))
}

function invoke(overrides = [], { replaceArgs = false } = {}) {
  const args = replaceArgs
    ? overrides
    : [
        '--manifest',
        manifestPath,
        '--signature',
        signaturePath,
        '--public-key',
        keyPath,
        '--trusted-key-sha256',
        trustedKeySha256,
        '--artifact',
        artifactPath,
        '--stage-root',
        stageRoot,
        '--architecture',
        'x64',
        '--installed-version',
        '0.1.0',
        ...overrides
      ]
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10_000
  })
}

describe.skipIf(process.platform !== 'linux')('offline release staging CLI', () => {
  it('accepts explicitly pinned signed embedded-payload evidence in process', async () => {
    manifest.packageInputIdentityClaim = {
      schema: 1,
      evidenceKind: 'packaging-input-snapshot',
      appId: 'com.ashide.desktop',
      productName: 'Ash IDE',
      packageName: 'ash-ide',
      version: manifest.version,
      architecture: manifest.architecture,
      sourceCommit: 'a'.repeat(40),
      capturedAppAsarSha256: 'b'.repeat(64),
      capturedCompiledCliPackageJsonSha256: 'c'.repeat(64)
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    await writeFile(manifestPath, manifestBytes)
    await writeFile(signaturePath, sign(null, manifestBytes, privateKey))
    const payload = {
      schema: 1,
      kind: 'ash-appimage-embedded-payload-attestation',
      manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      manifest: {
        sha256: manifest.sha256,
        identity: {
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
      },
      embedded: {
        packageInputIdentityClaim: manifest.packageInputIdentityClaim,
        files: {
          appAsarSha256: 'b'.repeat(64),
          compiledCliPackageJsonSha256: 'c'.repeat(64),
          desktopSha256: 'd'.repeat(64),
          sidecarSha256: 'e'.repeat(64)
        },
        desktop: {
          name: 'Ash IDE',
          startupWmClass: 'com.ashide.desktop',
          version: manifest.version
        }
      },
      claimProvenance: {
        kind: 'embedded-packaging-input-snapshot',
        sourceCommit: 'a'.repeat(40),
        callerPinnedSourceCommit: 'a'.repeat(40),
        sourceCommitBinding: 'caller-pinned-match'
      },
      qa: {
        checkpoint: 'PK-05',
        kind: 'embedded-appimage-identity-diagnostic',
        outcome: 'matched',
        artifactSha256Before: manifest.sha256,
        artifactSha256After: manifest.sha256,
        architecture: 'x64',
        reader: { version: 'unsquashfs 4.7.5', sha256: '1'.repeat(64) },
        squashfs: {
          offset: 194183,
          version: '4.0',
          compression: 'zstd',
          blockSize: 131072,
          bytesUsed: 1000,
          inodeCount: 20
        }
      }
    }
    const attestationBytes = serializeAshAppImageEmbeddedPayloadAttestation(payload)
    const attestationPath = join(temp, 'attestation.json')
    const attestationSignaturePath = join(temp, 'attestation.sig')
    await writeFile(attestationPath, attestationBytes)
    await writeFile(attestationSignaturePath, sign(null, attestationBytes, attestationPrivateKey))
    // The independently approved fingerprint applies to the exact pinned PEM
    // bytes, including valid alternative line endings, not a normalized export.
    const pinnedPemBytes = Buffer.from(attestationKeyBytes.toString().replaceAll('\n', '\r\n'))
    await writeFile(attestationKeyPath, pinnedPemBytes)
    const pinnedPemSha256 = createHash('sha256').update(pinnedPemBytes).digest('hex')
    let output

    await runStageAshAppImageCli(
      [
        '--manifest',
        manifestPath,
        '--signature',
        signaturePath,
        '--public-key',
        keyPath,
        '--trusted-key-sha256',
        trustedKeySha256,
        '--artifact',
        artifactPath,
        '--stage-root',
        stageRoot,
        '--architecture',
        'x64',
        '--installed-version',
        '0.1.0',
        '--attestation',
        attestationPath,
        '--attestation-signature',
        attestationSignaturePath,
        '--attestation-public-key',
        attestationKeyPath,
        '--attestation-key-sha256',
        pinnedPemSha256,
        '--attestation-source-commit',
        'a'.repeat(40)
      ],
      (value) => {
        output = value
      }
    )

    const staged = JSON.parse(output)
    expect(staged.candidateIdentity.state).toBe('unverified')
    expect(staged.offlineAttestation.state).toBe('verified-under-caller-key')
    expect(staged.activationAvailable).toBe(false)
  })

  it('exposes an explicit package script and help without staging', async () => {
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts
    expect(scripts['release:stage:appimage:offline']).toBe(
      'node config/scripts/desktop-distribution/release/stage-ash-appimage-cli.mjs'
    )
    const help = invoke(['--help'], { replaceArgs: true })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('no installation, no download')
    expect(help.stdout).toContain(
      'Without a matching attestation, the manifest version is only a claim'
    )
    expect(help.stdout).toContain('packaging-input snapshot alone does not verify')
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('stages verified bytes with explicit trust inputs but does not modify the source', async () => {
    const child = invoke()
    expect(child.status, child.stderr).toBe(0)
    const staged = JSON.parse(child.stdout.trim())
    expect(staged.manifestVersion).toBe('0.2.0')
    expect(staged.ashPackageIdentityVerified).toBe(false)
    expect(staged.candidateIdentity.state).toBe('unverified')
    expect(staged.activationAvailable).toBe(false)
    expect(staged.activationBlockers).toContain(
      'The signed manifest or packaging input claim is not matched to the embedded AppImage payload.'
    )
    expect(staged.sha256).toBe(manifest.sha256)
    expect(await readFile(staged.path)).toEqual(bytes)
    expect(await readFile(artifactPath)).toEqual(bytes)
    expect((await stat(staged.path)).mode & 0o777).toBe(0o600)
    expect((await stat(resolve(staged.path, '..'))).mode & 0o777).toBe(0o700)
  })

  it('fails closed without an independently supplied key or complete flags', async () => {
    const missingKey = invoke(['--manifest', manifestPath], { replaceArgs: true })
    expect(missingKey.status).not.toBe(0)
    expect(missingKey.stderr).toMatch(/Missing --signature/)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects a substituted key even when it is a valid Ed25519 public key', async () => {
    const foreign = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' })
    await writeFile(keyPath, foreign)
    const child = invoke()
    expect(child.status).not.toBe(0)
    expect(child.stderr).toMatch(/independently approved SHA-256/)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects untrusted key pin syntax before accessing any file', async () => {
    const child = invoke(['--trusted-key-sha256', 'not-a-digest'])
    expect(child.status).not.toBe(0)
    expect(child.stderr).toMatch(/64 lowercase hex/)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('refuses symlink and hardlink key aliases instead of following a pathname', async () => {
    const keyOriginal = join(temp, 'original-key.pem')
    await rename(keyPath, keyOriginal)
    await symlink(keyOriginal, keyPath)
    const linked = invoke()
    expect(linked.status).not.toBe(0)
    expect(await readdir(stageRoot)).toEqual([])

    await rm(keyPath)
    await rename(keyOriginal, keyPath)
    await link(keyPath, join(temp, 'hardlinked-key.pem'))
    const hardlinked = invoke()
    expect(hardlinked.status).not.toBe(0)
    expect(hardlinked.stderr).toMatch(/single-link/)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('refuses publicly writable trust roots and linked signed metadata', async () => {
    await chmod(keyPath, 0o666)
    const publicKeyFile = invoke()
    expect(publicKeyFile.status).not.toBe(0)
    expect(publicKeyFile.stderr).toMatch(/not writable by others/)
    await chmod(keyPath, 0o644)

    const original = join(temp, 'original-manifest.json')
    await rename(manifestPath, original)
    await symlink(original, manifestPath)
    const manifestAlias = invoke()
    expect(manifestAlias.status).not.toBe(0)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects malformed signatures and public staging roots without publishing files', async () => {
    await writeFile(signaturePath, Buffer.alloc(64))
    const invalidSig = invoke()
    expect(invalidSig.status).not.toBe(0)
    expect(invalidSig.stderr).toMatch(/signature/)
    expect(await readdir(stageRoot)).toEqual([])
    await signFixture()
    await chmod(stageRoot, 0o755)
    const unsafe = invoke()
    expect(unsafe.status).not.toBe(0)
    expect(unsafe.stderr).toMatch(/private/)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects signed noncanonical manifest bytes before modifying staging', async () => {
    await signFixture(Buffer.from(JSON.stringify(manifest, null, 2)))
    const child = invoke()
    expect(child.status).not.toBe(0)
    expect(child.stderr).toMatch(/canonical JSON/)
    expect(await readdir(stageRoot)).toEqual([])
  })
})
