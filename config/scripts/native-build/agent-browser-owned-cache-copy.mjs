import {
  closeSync,
  chmodSync,
  constants,
  fstatSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeSync
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fail, isWithin, resolveInputDirectory } from './agent-browser-owned-source-files.mjs'

const noFollow = constants.O_NOFOLLOW ?? 0

function copyRegularFile(source, destination, sourceStat) {
  let sourceDescriptor
  let destinationDescriptor
  try {
    sourceDescriptor = openSync(source, constants.O_RDONLY | noFollow)
    const openedStat = fstatSync(sourceDescriptor)
    if (
      !openedStat.isFile() ||
      openedStat.dev !== sourceStat.dev ||
      openedStat.ino !== sourceStat.ino
    ) {
      fail(`Cache entry changed type while being copied: ${source}`)
    }
    destinationDescriptor = openSync(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    )
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    while (true) {
      const bytesRead = readSync(sourceDescriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }
      let offset = 0
      while (offset < bytesRead) {
        offset += writeSync(destinationDescriptor, buffer, offset, bytesRead - offset, null)
      }
    }
    const afterCopy = fstatSync(sourceDescriptor)
    const sourcePathAfter = lstatSync(source)
    if (
      afterCopy.size !== openedStat.size ||
      afterCopy.mtimeMs !== openedStat.mtimeMs ||
      afterCopy.ctimeMs !== openedStat.ctimeMs ||
      !sourcePathAfter.isFile() ||
      sourcePathAfter.dev !== openedStat.dev ||
      sourcePathAfter.ino !== openedStat.ino
    ) {
      fail(`Cache entry changed while being copied: ${source}`)
    }
    fchmodSync(destinationDescriptor, sourceStat.mode & 0o755)
  } finally {
    if (sourceDescriptor !== undefined) {
      closeSync(sourceDescriptor)
    }
    if (destinationDescriptor !== undefined) {
      closeSync(destinationDescriptor)
    }
  }
}

function copySymlink(source, destination, root) {
  const before = lstatSync(source)
  const targetPath = readlinkSync(source)
  if (isAbsolute(targetPath)) {
    fail(`Cache symlink points outside its private copy: ${source}`)
  }
  const lexicalTarget = resolve(dirname(source), targetPath)
  if (!isWithin(root, lexicalTarget)) {
    fail(`Cache symlink points outside its private copy: ${source}`)
  }
  let realTarget
  let targetStat
  try {
    realTarget = realpathSync(source)
    targetStat = statSync(realTarget)
  } catch {
    fail(`Cache symlink is broken or cyclic: ${source}`)
  }
  const after = lstatSync(source)
  if (
    !targetStat.isFile() ||
    !isWithin(root, realTarget) ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    !after.isSymbolicLink()
  ) {
    fail(`Cache symlink is unexpected or changed while being inspected: ${source}`)
  }
  symlinkSync(targetPath, destination)
}

export function copyCacheTree(sourcePath, destinationPath, label) {
  const root = resolveInputDirectory(sourcePath, label)
  const destination = resolve(destinationPath)
  if (isWithin(root, destination) || isWithin(destination, root)) {
    fail(`${label} copy destination must be separate from its source cache.`)
  }
  const copyDirectory = (source, destinationDirectory) => {
    const stat = lstatSync(source)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`${label} contains an unexpected directory path: ${source}`)
    }
    mkdirSync(destinationDirectory, { mode: 0o700 })
    chmodSync(destinationDirectory, 0o700)
    const entries = readdirSync(source, { withFileTypes: true })
    for (const entry of entries) {
      const sourceEntry = join(source, entry.name)
      const destinationEntry = join(destinationDirectory, entry.name)
      if (entry.isSymbolicLink()) {
        copySymlink(sourceEntry, destinationEntry, root)
      } else if (entry.isDirectory()) {
        copyDirectory(sourceEntry, destinationEntry)
      } else if (entry.isFile()) {
        const sourceStat = lstatSync(sourceEntry)
        if (!sourceStat.isFile()) {
          fail(`${label} contains an unexpected file path: ${sourceEntry}`)
        }
        copyRegularFile(sourceEntry, destinationEntry, sourceStat)
      } else {
        fail(`${label} contains an unsupported file: ${sourceEntry}`)
      }
    }
    const after = lstatSync(source)
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      after.dev !== stat.dev ||
      after.ino !== stat.ino
    ) {
      fail(`${label} directory changed while being copied: ${source}`)
    }
  }
  copyDirectory(root, destinationPath)
}
