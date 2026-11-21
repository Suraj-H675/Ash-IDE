#!/usr/bin/env node
// Explicit, offline-only operator entry point. This stages authenticated bytes;
// it NEVER installs an AppImage, chooses a trust root or interrupts Ash Runtime.
import { createHash, createPublicKey } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { stageAshAppImage } from './stage-ash-appimage.mjs'

const USAGE = [
  'Offline Ash AppImage staging (no installation, no download):',
  '  pnpm run release:stage:appimage:offline \\',
  '    --manifest /path/to/manifest.json --signature /path/to/manifest.sig \\',
  '    --public-key /path/to/trusted-ash-ed25519-public.pem \\',
  '    --trusted-key-sha256 64-character-independently-verified-hex \\',
  '    --artifact /path/to/ash-ide-linux.AppImage \\',
  '    --stage-root /private/existing/staging/directory \\',
  '    --architecture x64|arm64 --installed-version X.Y.Z',
  'Manifest bytes must be compact JSON.stringify serialization (no duplicate keys).',
  'Signature is exactly 64 raw Ed25519 bytes over the original manifest file bytes.',
  'Fingerprint is SHA-256 of the exact PEM file bytes; authenticate it independently.',
  'Key and manifest input files must be regular, single-link files; symlinks are refused.',
  'A signed packaging-input snapshot is only an input claim until the embedded AppImage payload is inspected.',
  'The manifest version is not an inspected payload version; activation is unavailable.'
].join('\n')

const REQUIRED = [
  'manifest',
  'signature',
  'public-key',
  'trusted-key-sha256',
  'artifact',
  'stage-root',
  'architecture',
  'installed-version'
]

/** Bind metadata and trusted key bytes to one opened inode, never a second path lookup. */
async function readPinnedInput(filename, label, maxBytes, exactBytes = null) {
  const file = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const before = await file.stat({ bigint: true })
    const limit = BigInt(maxBytes)
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size === 0n ||
      before.size > limit ||
      (exactBytes !== null && before.size !== BigInt(exactBytes))
    ) {
      throw new Error(`${label} must be a regular single-link file of the expected size`)
    }
    if (
      label === 'Trusted public key' &&
      ((before.uid !== BigInt(process.getuid()) && before.uid !== 0n) ||
        (before.mode & 0o022n) !== 0n)
    ) {
      throw new Error(
        'Trusted public key must be owned by this user or root and not writable by others'
      )
    }
    const buffer = Buffer.alloc(maxBytes + 1)
    let count = 0
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, count)
      if (bytesRead === 0) {
        break
      }
      count += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (
      count !== Number(before.size) ||
      count > maxBytes ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error(`${label} changed during verification`)
    }
    return buffer.subarray(0, count)
  } finally {
    await file.close()
  }
}

export async function runStageAshAppImageCli(args = process.argv.slice(2), write = console.log) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: 'boolean' },
      ...Object.fromEntries(REQUIRED.map((name) => [name, { type: 'string' }]))
    },
    strict: true,
    allowPositionals: false
  })
  if (values.help) {
    if (Object.keys(values).length !== 1) {
      throw new Error('--help cannot be combined with staging arguments')
    }
    write(USAGE)
    return
  }
  for (const name of REQUIRED) {
    if (!values[name]?.trim()) {
      throw new Error(`Missing --${name}. Use --help for required offline inputs.`)
    }
  }
  if (!['x64', 'arm64'].includes(values.architecture)) {
    throw new Error('Staging architecture must be x64 or arm64')
  }
  if (process.platform !== 'linux') {
    throw new Error('Offline AppImage staging is only supported on Linux')
  }
  if (!/^[a-f0-9]{64}$/.test(values['trusted-key-sha256'])) {
    throw new Error('Trusted public key SHA-256 must be 64 lowercase hex characters')
  }
  const publicKeyBytes = await readPinnedInput(values['public-key'], 'Trusted public key', 8192)
  if (createHash('sha256').update(publicKeyBytes).digest('hex') !== values['trusted-key-sha256']) {
    throw new Error('Trusted public key does not match the independently approved SHA-256')
  }
  const manifestBytes = await readPinnedInput(values.manifest, 'Signed manifest', 16 * 1024)
  const signature = await readPinnedInput(values.signature, 'Manifest signature', 64, 64)
  const result = await stageAshAppImage({
    manifestBytes,
    signature,
    policy: {
      publicKey: createPublicKey(publicKeyBytes),
      architecture: values.architecture,
      installedVersion: values['installed-version']
    },
    artifactPath: values.artifact,
    stageRoot: values['stage-root']
  })
  write(JSON.stringify(result))
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  runStageAshAppImageCli().catch((error) => {
    console.error(`[ash-release-stage] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
