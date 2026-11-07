import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

const root = process.cwd()
const sourceRoot = resolve(process.argv[3] ?? '')
const mode = process.argv[2]
const manifestPath = join(root, 'docs/provenance/orca-1.4.214.jsonl')
const sourceCommit = '55697aec91390357540103f49991458f756b41cc'
const includedPaths = [
  'src',
  'config',
  'resources',
  'native',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'electron.vite.config.ts',
  'vite.web.config.ts',
  'components.json',
  'LICENSE',
  '.oxfmtrc.json',
  '.oxlintrc.json'
]
const additionalFileMappings = [
  {
    sourcePath: 'cloud/packages/push-contract/src/push-host-proof-vector.json',
    ashPath: 'src/main/runtime/push/push-host-proof-vector.json'
  }
]
const excludedNames = new Set(['AGENTS.md', '.claude', '.agents', '.codex', '.aws', '.mcp.json'])

if (!['copy', 'record', 'check'].includes(mode) || !process.argv[3]) {
  throw new Error('Usage: node scripts/import-orca-source.mjs <copy|record|check> <read-only-source-root>')
}
if (sourceRoot === root || !sourceRoot.startsWith(`${resolve(root, '..')}${sep}`)) {
  throw new Error('The source archive must be outside the Ash checkout.')
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function visit(relativePath) {
  const sourcePath = join(sourceRoot, relativePath)
  const entry = await lstat(sourcePath)
  if (entry.isSymbolicLink()) {
    throw new Error(`Refusing source symlink: ${relativePath}`)
  }
  if (entry.isDirectory()) {
    const children = await readdir(sourcePath)
    const files = []
    for (const child of children.sort()) {
      if (excludedNames.has(child)) continue
      files.push(...(await visit(join(relativePath, child))))
    }
    return files
  }
  return [relativePath]
}

async function copyImportedFile({ sourcePath, ashPath }) {
  const from = join(sourceRoot, sourcePath)
  const to = join(root, ashPath)
  const bytes = await readFile(from)
  await mkdir(dirname(to), { recursive: true, mode: 0o755 })
  await copyFile(from, to)
  const sourceMode = (await lstat(from)).mode
  await chmod(to, 0o644 | (sourceMode & 0o111))
  return { sourcePath, ashPath, sourceSha256: sha256(bytes), ashSha256: sha256(bytes) }
}

async function includedFileMappings() {
  const mappings = []
  for (const path of includedPaths) {
    for (const relativePath of await visit(path)) {
      mappings.push({ sourcePath: relativePath, ashPath: relativePath })
    }
  }
  return [...mappings, ...additionalFileMappings]
}

if (mode === 'copy') {
  const mappings = await includedFileMappings()
  for (const { ashPath } of mappings) {
    try {
      await lstat(join(root, ashPath))
      throw new Error(`Refusing to overwrite existing Ash file: ${ashPath}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const records = []
  for (const mapping of mappings) records.push(await copyImportedFile(mapping))
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o755 })
  const meta = {
    kind: 'source',
    repository: 'https://github.com/stablyai/orca',
    commit: sourceCommit,
    version: '1.4.214',
    license: 'MIT',
    copyright: 'Copyright 2026 Lovecast Inc.',
    records: records.length
  }
  await writeFile(manifestPath, `${JSON.stringify(meta)}\n${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  process.stdout.write(`Imported ${records.length} files from ${meta.repository}@${meta.commit}\n`)
  process.exit(0)
}

const lines = (await readFile(manifestPath, 'utf8')).trimEnd().split('\n')
const meta = JSON.parse(lines[0])
if (meta.commit !== sourceCommit || meta.records !== lines.length - 1) {
  throw new Error('Source manifest metadata does not match this importer.')
}
const records = lines.slice(1).map((line) => JSON.parse(line))
const recordBySourcePath = new Map(records.map((record) => [record.sourcePath, record]))
const expectedMappings = await includedFileMappings()
for (const mapping of expectedMappings) {
  const existingRecord = recordBySourcePath.get(mapping.sourcePath)
  if (existingRecord && existingRecord.ashPath !== mapping.ashPath) {
    throw new Error(`Source manifest destination changed for ${mapping.sourcePath}`)
  }
  if (!recordBySourcePath.has(mapping.sourcePath)) {
    if (mode === 'check') {
      throw new Error(`Source manifest is missing ${mapping.sourcePath}`)
    }
    recordBySourcePath.set(mapping.sourcePath, {
      sourcePath: mapping.sourcePath,
      ashPath: mapping.ashPath,
      sourceSha256: '',
      ashSha256: ''
    })
  }
}
if (recordBySourcePath.size !== expectedMappings.length) {
  throw new Error('Source manifest contains paths outside the curated import set.')
}
const currentRecords = expectedMappings.map((mapping) => recordBySourcePath.get(mapping.sourcePath))
let failures = 0
for (const record of currentRecords) {
  if (!record) throw new Error('Source manifest mapping unexpectedly missing.')
  const sourceHash = sha256(await readFile(join(sourceRoot, record.sourcePath)))
  const ashHash = sha256(await readFile(join(root, record.ashPath)))
  if (sourceHash !== record.sourceSha256) {
    if (mode === 'record' && !record.sourceSha256) {
      record.sourceSha256 = sourceHash
    } else {
      throw new Error(`The source archive changed at ${record.sourcePath}`)
    }
  }
  if (mode === 'check' && ashHash !== record.ashSha256) {
    process.stderr.write(`Ash file differs from its recorded hash: ${record.ashPath}\n`)
    failures++
  }
  if (mode === 'record') record.ashSha256 = ashHash
}
if (mode === 'record') {
  meta.records = currentRecords.length
  await writeFile(manifestPath, `${JSON.stringify(meta)}\n${currentRecords.map((record) => JSON.stringify(record)).join('\n')}\n`)
  process.stdout.write(`Recorded Ash hashes for ${currentRecords.length} source files\n`)
} else {
  process.stdout.write(`${failures === 0 ? 'Verified' : 'Mismatched'} ${currentRecords.length} source files\n`)
  if (failures > 0) process.exitCode = 1
}
