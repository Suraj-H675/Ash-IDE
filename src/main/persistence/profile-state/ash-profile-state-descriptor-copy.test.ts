import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  copyProfileStateRecoveryFile,
  copyProfileStateRecoveryFiles
} from './profile-state-recovery-copy'
import {
  openPinnedLinuxProfileStateRecoveryDirectory,
  snapshotProfileStateRecoveryDirectories
} from './profile-state-recovery-directory'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-profile-state-descriptor-copy-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('descriptor-bound profile recovery file copy', () => {
  it('copies the original bytes, including large files, into private destination files', () => {
    const source = join(root, 'profile-state.db')
    const target = join(root, 'recovery.db')
    const bytes = Buffer.alloc(9 * 1024 * 1024 + 17, 0x65)
    bytes[0] = 0x11
    bytes[bytes.length - 1] = 0x33
    writeFileSync(source, bytes)

    copyProfileStateRecoveryFile(source, target)

    expect(readFileSync(target).equals(bytes)).toBe(true)
    expect(readFileSync(source).equals(bytes)).toBe(true)
  })

  it('rejects symlinks and hardlinks before creating a destination', () => {
    const source = join(root, 'profile-state.db')
    const alias = join(root, 'linked-state.db')
    const target = join(root, 'quarantined.db')
    writeFileSync(source, 'original')
    symlinkSync(source, alias)
    expect(() => copyProfileStateRecoveryFile(alias, target)).toThrow()

    rmSync(alias)
    linkSync(source, alias)
    expect(() => copyProfileStateRecoveryFile(source, target)).toThrow(/single-link/)
    expect(() => copyProfileStateRecoveryFile(alias, target)).toThrow(/single-link/)
    expect(() => readFileSync(target)).toThrow()
  })

  it('refuses a linked parent directory instead of following it to another data root', () => {
    const actual = join(root, 'owned-profile')
    const alias = join(root, 'linked-profile')
    const source = join(actual, 'profile-state.db')
    mkdirSync(actual)
    writeFileSync(source, 'private profile data')
    symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir')

    const target = join(root, 'quarantined.db')
    expect(() => copyProfileStateRecoveryFile(join(alias, 'profile-state.db'), target)).toThrow(
      /linked or non-directory ancestor/
    )
    expect(() => readFileSync(target)).toThrow()
    expect(readFileSync(source, 'utf8')).toBe('private profile data')
  })

  it.skipIf(process.platform !== 'linux')(
    'rejects a directory replaced after its ancestor identities were checked',
    () => {
      const original = join(root, 'profile')
      const displaced = join(root, 'profile-original')
      mkdirSync(original)
      const snapshots = snapshotProfileStateRecoveryDirectories(join(original, 'profile-state.db'))
      renameSync(original, displaced)
      mkdirSync(original)

      expect(() => openPinnedLinuxProfileStateRecoveryDirectory(snapshots)).toThrow(
        /ancestor changed before directory pinning/
      )
    }
  )

  it('refuses a linked destination parent instead of writing into an unrelated directory', () => {
    const actualDestination = join(root, 'provider-profile')
    const linkedDestination = join(root, 'linked-destination')
    const source = join(root, 'profile-state.db')
    mkdirSync(actualDestination)
    writeFileSync(source, 'recoverable local state')
    symlinkSync(
      actualDestination,
      linkedDestination,
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    expect(() =>
      copyProfileStateRecoveryFile(source, join(linkedDestination, 'unexpected.db'))
    ).toThrow(/linked or non-directory ancestor/)
    expect(() => readFileSync(join(actualDestination, 'unexpected.db'))).toThrow()
    expect(readFileSync(source, 'utf8')).toBe('recoverable local state')
  })

  it.skipIf(process.platform !== 'darwin')(
    'accepts the trusted macOS /var alias after resolving it to /private/var',
    () => {
      const canonicalRoot = realpathSync(root)
      const aliasRoot = join('/var', relative('/private/var', canonicalRoot))
      const source = join(aliasRoot, 'profile-state.db')
      const target = join(aliasRoot, 'recovery.db')
      writeFileSync(join(canonicalRoot, 'profile-state.db'), 'macOS temp profile state')

      copyProfileStateRecoveryFile(source, target)

      expect(readFileSync(join(canonicalRoot, 'recovery.db'), 'utf8')).toBe(
        'macOS temp profile state'
      )
    }
  )

  it('fails closed on a huge sparse file without allocating a large recovery artifact', () => {
    const source = join(root, 'huge-sparse.db')
    const target = join(root, 'quarantined.db')
    writeFileSync(source, '')
    truncateSync(source, 512 * 1024 * 1024 + 1)
    expect(() => copyProfileStateRecoveryFile(source, target)).toThrow(/bounded/)
    expect(() => readFileSync(target)).toThrow()
  })

  it('rejects a database family above the combined resource budget before copying', () => {
    const primary = join(root, 'primary.db')
    const wal = join(root, 'primary.db-wal')
    writeFileSync(primary, '')
    writeFileSync(wal, '')
    truncateSync(primary, 512 * 1024 * 1024)
    truncateSync(wal, 512 * 1024 * 1024 + 1)
    expect(() =>
      copyProfileStateRecoveryFiles([
        { source: primary, target: join(root, 'copied.db') },
        { source: wal, target: join(root, 'copied.db-wal') }
      ])
    ).toThrow(/family is too large/)
    expect(() => readFileSync(join(root, 'copied.db'))).toThrow()
  })

  it('never replaces an existing destination file or symlink', () => {
    const source = join(root, 'profile-state.db')
    const target = join(root, 'existing.db')
    writeFileSync(source, 'new')
    writeFileSync(target, 'existing')
    expect(() => copyProfileStateRecoveryFile(source, target)).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('existing')

    rmSync(target)
    symlinkSync(source, target)
    expect(() => copyProfileStateRecoveryFile(source, target)).toThrow()
    expect(readFileSync(source, 'utf8')).toBe('new')
  })

  it('copies a quiescent SQLite-style database family without linking source and target', () => {
    const data = join(root, 'data.db')
    const wal = join(root, 'data.db-wal')
    const copy = join(root, 'copy.db')
    const copyWal = join(root, 'copy.db-wal')
    writeFileSync(data, Buffer.from('sqlite primary'))
    writeFileSync(wal, Buffer.from('committed wal'))

    copyProfileStateRecoveryFiles([
      { source: data, target: copy },
      { source: wal, target: copyWal }
    ])

    expect(readFileSync(copy, 'utf8')).toBe('sqlite primary')
    expect(readFileSync(copyWal, 'utf8')).toBe('committed wal')
    chmodSync(data, 0o600)
    writeFileSync(data, 'changed')
    expect(readFileSync(copy, 'utf8')).toBe('sqlite primary')
  })
})
