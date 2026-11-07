#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const ledgerPath = path.join(repoRoot, 'docs/provenance/orca-1.4.214.jsonl')
const exclusionPath = path.join(repoRoot, 'docs/provenance/ash-exclusions.json')
const modificationPath = path.join(repoRoot, 'docs/provenance/ash-modifications.json')
const expectedSource = {
  repository: 'https://github.com/stablyai/orca',
  commit: '55697aec91390357540103f49991458f756b41cc',
  version: '1.4.214',
  license: 'MIT',
  copyright: 'Copyright 2026 Lovecast Inc.'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fail(message) {
  console.error(`[provenance] ${message}`)
  process.exitCode = 1
}

const lines = readFileSync(ledgerPath, 'utf8').trimEnd().split('\n')
const header = JSON.parse(lines[0])
const exclusions = JSON.parse(readFileSync(exclusionPath, 'utf8'))
const records = lines.slice(1).map((line) => JSON.parse(line))
const exclusionByPath = new Map(exclusions.removedUpstreamFiles.map((item) => [item.path, item]))
const recordsByPath = new Map(records.map((record) => [record.ashPath, record]))

if (
  Object.entries(expectedSource).some(([key, value]) => header[key] !== value) ||
  header.records !== records.length
) {
  fail('source ledger header does not match the pinned Orca snapshot')
}
if (new Set(records.map((record) => record.ashPath)).size !== records.length) {
  fail('source ledger contains duplicate Ash paths')
}
if (sha256(readFileSync(path.join(repoRoot, 'LICENSE'))) !== exclusions.licenseSha256) {
  fail('LICENSE does not match its recorded SHA-256')
}

const modified = []
const missing = []
const seenModifications = new Set()
for (const record of records) {
  const currentPath = path.join(repoRoot, record.ashPath)
  if (!existsSync(currentPath)) {
    missing.push(record.ashPath)
    const excluded = exclusionByPath.get(record.ashPath)
    if (!excluded || excluded.sourceSha256 !== record.sourceSha256) {
      fail(`unrecorded removal or source hash mismatch: ${record.ashPath}`)
    }
    continue
  }
  const currentHash = sha256(readFileSync(currentPath))
  if (currentHash !== record.ashSha256) {
    modified.push({ path: record.ashPath, sha256: currentHash })
  }
}

if (JSON.stringify([...exclusionByPath.keys()].sort()) !== JSON.stringify([...missing].sort())) {
  fail('exclusion manifest does not exactly match removed upstream files')
}

if (process.argv.includes('--write-modifications')) {
  const manifest = {
    sourceCommit: expectedSource.commit,
    modifications: modified.map((item) => ({
      ...item,
      reason:
        'Ash adaptation of the pinned upstream source; the original file hash remains in the source ledger.'
    }))
  }
  writeFileSync(modificationPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`[provenance] wrote ${modified.length} current Ash source hashes`)
} else {
  let saved = { sourceCommit: null, modifications: [] }
  if (existsSync(modificationPath)) {
    saved = JSON.parse(readFileSync(modificationPath, 'utf8'))
  }
  const savedByPath = new Map(saved.modifications.map((item) => [item.path, item]))
  for (const item of modified) {
    const recorded = savedByPath.get(item.path)
    if (!recorded || recorded.sha256 !== item.sha256) {
      fail(`modified source hash is missing or stale in ash-modifications.json: ${item.path}`)
    }
    seenModifications.add(item.path)
  }
  for (const item of saved.modifications) {
    if (!seenModifications.has(item.path) || !recordsByPath.has(item.path)) {
      fail(`stale or unknown source modification entry: ${item.path}`)
    }
  }
  if (saved.sourceCommit !== expectedSource.commit) {
    fail('modification manifest does not identify the pinned source commit')
  }
}

if (process.exitCode !== 1) {
  console.log(
    `[provenance] verified ${records.length} upstream file records, ${modified.length} Ash edits, ${missing.length} documented removals, MIT license SHA-256 ${exclusions.licenseSha256}`
  )
}
