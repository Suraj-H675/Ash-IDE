import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { recoverPendingSkillTransactions } from './skill-transaction-startup-recovery'

const retiredUploadModules = [
  'skill-upload-archive-hash.ts',
  'skill-upload-operation-lifecycle.ts',
  'skill-upload-retained-paths.ts',
  'skill-upload-session-record.ts',
  'skill-upload-session-service-options.ts',
  'skill-upload-session-service.ts',
  'skill-upload-staging-ownership.ts'
] as const

let root = ''

function fixture() {
  root = mkdtempSync(join(tmpdir(), 'ash-retired-skill-upload-'))
  const stateDirectory = join(root, 'ash-profile', 'skill-installs')
  const stagingRoot = join(stateDirectory, 'remote-uploads-v2')
  const owner = join(stagingRoot, `owner-999991-${randomUUID()}`)
  const otherOwner = join(stagingRoot, `owner-999992-${randomUUID()}`)
  mkdirSync(owner, { recursive: true })
  mkdirSync(otherOwner, { recursive: true })
  const partialArchive = join(owner, `${randomUUID()}.tar.gz`)
  const completedArchive = join(otherOwner, `${randomUUID()}.tar.gz`)
  const sentinel = join(stagingRoot, 'legacy-readme.txt')
  const bytes = Buffer.from([0, 255, 1, 48, 123, 42, 0, 33])
  writeFileSync(partialArchive, bytes)
  writeFileSync(completedArchive, Buffer.from('a separate previously staged archive'))
  writeFileSync(sentinel, 'Historical staged files must not be automatically removed.\n')
  return { stateDirectory, stagingRoot, partialArchive, completedArchive, sentinel, bytes }
}

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = ''
})

it('excludes the seven unmounted Cloud upload implementations without deleting historical state', () => {
  for (const filename of retiredUploadModules) {
    expect(
      existsSync(resolve(process.cwd(), 'src/main/skills', filename)),
      `orphan Cloud upload source reappeared: ${filename}`
    ).toBe(false)
  }
  const startup = readFileSync(
    resolve(process.cwd(), 'src/main/startup/main-process-observers.ts'),
    'utf8'
  )
  expect(startup).toContain('recoverPendingSkillTransactions(')
  expect(startup).not.toContain('remote-uploads-v2')
})

it('preserves legacy uploaded archives and unrelated files during real startup recovery', async () => {
  const input = fixture()
  const before = readdirSync(input.stagingRoot).sort()
  const archiveBefore = readFileSync(input.completedArchive)

  const report = await recoverPendingSkillTransactions(input.stateDirectory)

  expect(report).toMatchObject({ scanned: 0, recovered: 0, failures: [], truncated: false })
  expect(readdirSync(input.stagingRoot).sort()).toEqual(before)
  expect(readFileSync(input.partialArchive)).toEqual(input.bytes)
  expect(readFileSync(input.completedArchive)).toEqual(archiveBefore)
  expect(readFileSync(input.sentinel, 'utf8')).toContain('must not be automatically removed')
})

it('rejects an invalid recovery journal without visiting the historical upload directory', async () => {
  const input = fixture()
  const journals = join(input.stateDirectory, 'journals')
  mkdirSync(journals, { recursive: true })
  writeFileSync(join(journals, 'untrusted.json'), '{"canonicalPath":"/outside"}\n')

  const report = await recoverPendingSkillTransactions(input.stateDirectory)

  expect(report.scanned).toBe(0)
  expect(report.failures).toEqual([
    { journalKey: 'untrusted', code: 'skill-transaction-journal-invalid' }
  ])
  expect(readFileSync(input.partialArchive)).toEqual(input.bytes)
  expect(existsSync(input.completedArchive)).toBe(true)
  expect(existsSync(input.sentinel)).toBe(true)
})
