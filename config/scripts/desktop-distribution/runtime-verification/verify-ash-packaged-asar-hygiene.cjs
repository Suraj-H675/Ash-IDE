const { join } = require('node:path')
const { listPackage } = require('@electron/asar')

// The application runtime is assembled from these reviewed roots only.
// Hidden editor/test state, generated release folders and raw source folders
// must not leak into a distributable app, regardless of .gitignore.
const ALLOWED_ASAR_ROOTS = new Set([
  'LICENSE',
  'package.json',
  'out',
  'resources',
  'node_modules',
  'scripts'
])

function verifyAshPackagedAsarHygiene(resourcesDir) {
  const archivePath = join(resourcesDir, 'app.asar')
  const entries = listPackage(archivePath)
  if (entries.length === 0) {
    throw new Error('[ash-package-hygiene] packaged app.asar has no files')
  }
  const roots = new Set()
  const forbiddenRoots = new Set()
  for (const entry of entries) {
    const root = entry.split('/').find(Boolean)
    if (!root) {
      continue
    }
    roots.add(root)
    if (!ALLOWED_ASAR_ROOTS.has(root)) {
      // Only root names are shown, not private nested filenames or contents.
      forbiddenRoots.add(root)
    }
  }
  if (forbiddenRoots.size > 0) {
    throw new Error(
      `[ash-package-hygiene] unexpected private/build roots in app.asar: ${[...forbiddenRoots].sort().join(', ')}`
    )
  }
  if (!roots.has('out') || !roots.has('package.json')) {
    throw new Error('[ash-package-hygiene] packaged runtime entry roots are incomplete')
  }
  console.log(`[ash-package-hygiene] OK — ${entries.length} archive entries in reviewed roots`)
  return { entries: entries.length, roots: [...roots].sort() }
}

module.exports = { verifyAshPackagedAsarHygiene }
