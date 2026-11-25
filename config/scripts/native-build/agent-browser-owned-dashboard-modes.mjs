import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync
} from 'node:fs'
import { join } from 'node:path'
import { fail, resolveTreeDirectory } from './agent-browser-owned-source-files.mjs'
import { manifest } from './agent-browser-owned-source-manifest.mjs'

// Turbopack may emit mode 0664 even inside a mode-0700 build workspace.
// Tighten only private generated dashboard files before they become inputs.
// Never follow symlinks or change permissions of shared hardlinks.
function normalizeFile(path, before) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK)
  try {
    const opened = fstatSync(fd)
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== process.getuid() ||
      (opened.mode & 0o6000) !== 0
    ) {
      fail(`Unsafe generated dashboard file: ${path}`)
    }
    const mode = opened.mode & 0o777
    if ((mode & 0o022) !== 0) {
      fchmodSync(fd, mode & ~0o022)
    }
  } finally {
    closeSync(fd)
  }
}

function normalizeDirectory(path) {
  const directory = lstatSync(path)
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid() ||
    (directory.mode & 0o6022) !== 0
  ) {
    fail(`Unsafe generated dashboard directory: ${path}`)
  }
  for (const entry of readdirSync(path)) {
    const child = join(path, entry)
    const stat = lstatSync(child)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      normalizeDirectory(child)
    } else if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1) {
      normalizeFile(child, stat)
    } else {
      fail(`Unsafe generated dashboard entry: ${child}`)
    }
  }
  const after = lstatSync(path)
  if (!after.isDirectory() || after.dev !== directory.dev || after.ino !== directory.ino) {
    fail(`Generated dashboard directory changed during mode normalization: ${path}`)
  }
}

export function normalizeGeneratedDashboardModes(sourceDirectory) {
  for (const generated of manifest.inputs.generatedDirectoryPolicy.dashboardRelative) {
    const path = `${manifest.inputs.dashboard.packagePath}/${generated}`
    let directory
    try {
      directory = resolveTreeDirectory(sourceDirectory, path, 'Generated dashboard directory')
    } catch (error) {
      if (generated === '.next' && String(error.message).includes('is missing:')) {
        continue
      }
      throw error
    }
    normalizeDirectory(directory)
  }
}
