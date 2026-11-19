#!/usr/bin/env node
// Explicit, offline-only operator entry point. This stages authenticated bytes;
// it NEVER installs an AppImage, chooses a trust root or interrupts Ash Runtime.
import { createPublicKey } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { stageAshAppImage } from './stage-ash-appimage.mjs'

const USAGE = [
  'Offline Ash AppImage staging (no installation, no download):',
  '  pnpm run release:stage:appimage:offline \\',
  '    --manifest /path/to/manifest.json --signature /path/to/manifest.sig \\',
  '    --public-key /path/to/trusted-ash-ed25519-public.pem \\',
  '    --artifact /path/to/ash-ide-linux.AppImage \\',
  '    --stage-root /private/existing/staging/directory \\',
  '    --architecture x64|arm64 --installed-version X.Y.Z',
  'Manifest bytes must be compact JSON.stringify serialization (no duplicate keys).',
  'Signature is exactly 64 raw Ed25519 bytes over the original manifest file bytes.',
  'The trusted public key MUST be independently authenticated by the operator.'
].join('\n')

const REQUIRED = [
  'manifest',
  'signature',
  'public-key',
  'artifact',
  'stage-root',
  'architecture',
  'installed-version'
]

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
  const manifestFile = await lstat(values.manifest)
  if (!manifestFile.isFile() || manifestFile.size > 16 * 1024) {
    throw new Error('Signed manifest must be a regular file of at most 16 KiB')
  }
  const signatureFile = await lstat(values.signature)
  if (!signatureFile.isFile() || signatureFile.size !== 64) {
    throw new Error('Manifest signature must be exactly 64 raw bytes')
  }
  const publicKeyFile = await lstat(values['public-key'])
  if (!publicKeyFile.isFile() || publicKeyFile.size > 8192) {
    throw new Error('Trusted public key must be a regular PEM file of at most 8 KiB')
  }
  const result = await stageAshAppImage({
    manifestBytes: await readFile(values.manifest),
    signature: await readFile(values.signature),
    policy: {
      publicKey: createPublicKey(await readFile(values['public-key'])),
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
