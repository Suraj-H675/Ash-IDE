const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { listPackage } = require('@electron/asar')
const {
  EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS
} = require('../../../excluded-task-tracker-cli-artifacts.cjs')

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

// Retired app-level Jira/Linear connectors and product analytics must not be
// distributed even if their old sources remain for an independent removal.
const EXCLUDED_VENDOR_NODE_MODULES = [
  '@linear/sdk',
  '@posthog/core',
  '@posthog/types',
  'posthog-node'
]

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
  for (const artifact of EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS) {
    if (
      entries.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === artifact) ||
      existsSync(join(resourcesDir, 'app.asar.unpacked', ...artifact.split('/')))
    ) {
      throw new Error(
        `[ash-package-hygiene] unregistered tracker CLI artifact packaged: ${artifact}`
      )
    }
  }
  for (const packageName of EXCLUDED_VENDOR_NODE_MODULES) {
    const relativePath = `node_modules/${packageName}`
    if (
      entries.some((entry) => {
        const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '')
        return normalized === relativePath || normalized.startsWith(`${relativePath}/`)
      }) ||
      existsSync(join(resourcesDir, 'node_modules', ...packageName.split('/'))) ||
      existsSync(join(resourcesDir, 'app.asar.unpacked', 'node_modules', ...packageName.split('/')))
    ) {
      throw new Error(`[ash-package-hygiene] excluded app vendor SDK was packaged: ${packageName}`)
    }
  }
  console.log(`[ash-package-hygiene] OK — ${entries.length} archive entries in reviewed roots`)
  return { entries: entries.length, roots: [...roots].sort() }
}

module.exports = { verifyAshPackagedAsarHygiene }
