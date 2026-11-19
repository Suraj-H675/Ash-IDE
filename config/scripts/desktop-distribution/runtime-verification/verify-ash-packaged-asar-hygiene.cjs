const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join, posix } = require('node:path')
const { extractFile, listPackage } = require('@electron/asar')
const {
  EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS
} = require('../../../excluded-task-tracker-cli-artifacts.cjs')
const {
  EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS,
  EXCLUDED_ASH_CLI_ARTIFACT_ROOTS
} = require('../../../excluded-ash-cli-entry-artifacts.cjs')
const {
  EXCLUDED_APP_PLUGIN_EXECUTABLES,
  EXCLUDED_APP_PLUGIN_CJS_ROOTS,
  EXCLUDED_APP_PLUGIN_SOURCE_ROOT,
  EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT
} = require('../../../excluded-ash-app-plugin-artifacts.cjs')
const {
  EXCLUDED_ASH_MOBILE_RELAY_MODULES,
  EXCLUDED_ASH_MOBILE_SERVICE_ROOTS,
  EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS
} = require('../../../excluded-ash-mobile-relay-artifacts.cjs')

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
  // Application-plugin IPC must not be accessible through Electron's
  // contextBridge even when retired renderer code is still source-compatible.
  // Inspect the final compiled preload, including a possible unpacked copy:
  // source-only import checks would miss a new barrel export or build transform.
  // Browser extensions and provider-native skills use different channel roots.
  const preloadPath = 'out/preload/index.js'
  const normalizedEntries = new Set(
    entries.map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
  )
  const preloads = []
  if (normalizedEntries.has(preloadPath)) {
    preloads.push(extractFile(archivePath, preloadPath).toString('utf8'))
  }
  const unpackedPreload = join(resourcesDir, 'app.asar.unpacked', ...preloadPath.split('/'))
  if (existsSync(unpackedPreload)) {
    preloads.push(readFileSync(unpackedPreload, 'utf8'))
  }
  for (const source of preloads) {
    const channel = /\bplugins:[A-Za-z][A-Za-z0-9_]*/.exec(source)?.[0]
    if (channel) {
      throw new Error(
        `[ash-package-hygiene] excluded application-plugin IPC in packaged preload: ${channel}`
      )
    }
  }
  // A dormant installer/marketplace registrar must not be reintroduced via a
  // Main import even when the sandbox preload is correctly unexposed.
  // Match the reviewed channel names rather than every "plugins:" substring:
  // minified non-IPC code may contain similarly named keys.
  const mainEntry = 'out/main/index.js'
  const mainSources = []
  if (normalizedEntries.has(mainEntry)) {
    mainSources.push(extractFile(archivePath, mainEntry).toString('utf8'))
  }
  const unpackedMain = join(resourcesDir, 'app.asar.unpacked', ...mainEntry.split('/'))
  if (existsSync(unpackedMain)) {
    mainSources.push(readFileSync(unpackedMain, 'utf8'))
  }
  const excludedAppPluginIpc =
    /\bplugins:(?:addMarketplace|closePanelPush|consent|getAutoUpdateState|getInstallCounts|getInstalledManifest|getLogs|getRollbackVersion|getSettings|install|installMarketplacePlugin|invokeCommand|list|listIconThemes|listLanguagePacks|listMarketplacePlugins|listMarketplaces|listSyntaxes|listTerminalThemes|listThemes|loadIconTheme|loadSyntax|openPanelPush|panelAction|panelImage|panelPush|panelState|previewMarketplacePlugin|previewMarketplaceUpdate|readCustomEditorEntry|readNewFileTemplate|readPanelEntry|refresh|refreshMarketplaces|remove|removeMarketplace|resolveGitSource|rollbackMarketplacePlugin|setEnabled|setSetting|statusBarState|suggestForFileType|takeUpdateReviewNotices)\b/
  for (const source of mainSources) {
    const channel = excludedAppPluginIpc.exec(source)?.[0]
    if (channel) {
      throw new Error(
        `[ash-package-hygiene] excluded application-plugin IPC in packaged Main: ${channel}`
      )
    }
  }
  if (
    existsSync(join(resourcesDir, 'app-update.yml')) ||
    existsSync(join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'electron-updater')) ||
    [...normalizedEntries].some((entry) => entry.startsWith('node_modules/electron-updater/'))
  ) {
    throw new Error('[ash-package-hygiene] unexpected packaged desktop updater configuration')
  }
  const excludedUpdaterCode =
    /onorca\.dev\/(?:whats-new\/|changelog\b)|["']updater:(?:check|download|quitAndInstall|dismissNudge|dismissAvailableUpdate|getLinuxPackageInstallInstructions|showLinuxPackage|listBuilds)["']/
  const updaterSources = [...preloads, ...mainSources]
  for (const chunk of normalizedEntries) {
    if (/^out\/main\/chunks\/[^/]+\.js$/.test(chunk)) {
      updaterSources.push(extractFile(archivePath, chunk).toString('utf8'))
    }
  }
  if (updaterSources.some((source) => excludedUpdaterCode.test(source))) {
    throw new Error('[ash-package-hygiene] excluded update transport in packaged Main or preload')
  }
  for (const artifact of [
    ...EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS,
    ...EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS
  ]) {
    if (
      entries.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === artifact) ||
      existsSync(join(resourcesDir, 'app.asar.unpacked', ...artifact.split('/')))
    ) {
      throw new Error(`[ash-package-hygiene] excluded CLI artifact packaged: ${artifact}`)
    }
  }
  for (const root of EXCLUDED_ASH_CLI_ARTIFACT_ROOTS) {
    const artifact = entries
      .map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
      .find((entry) => entry === root || entry.startsWith(`${root}/`))
    if (artifact || existsSync(join(resourcesDir, 'app.asar.unpacked', ...root.split('/')))) {
      throw new Error(
        `[ash-package-hygiene] excluded app-plugin CLI tree packaged: ${artifact ?? root}`
      )
    }
  }
  for (const artifact of EXCLUDED_APP_PLUGIN_EXECUTABLES) {
    if (
      entries.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === artifact) ||
      existsSync(join(resourcesDir, 'app.asar.unpacked', ...artifact.split('/')))
    ) {
      throw new Error(`[ash-package-hygiene] excluded app-plugin executable packaged: ${artifact}`)
    }
  }
  for (const root of EXCLUDED_APP_PLUGIN_CJS_ROOTS) {
    const artifact = entries
      .map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
      .find((entry) => entry === root || entry.startsWith(`${root}/`))
    if (artifact || existsSync(join(resourcesDir, 'app.asar.unpacked', ...root.split('/')))) {
      throw new Error(
        `[ash-package-hygiene] excluded app-plugin CommonJS tree packaged: ${artifact ?? root}`
      )
    }
  }
  for (const artifact of EXCLUDED_ASH_MOBILE_RELAY_MODULES) {
    if (
      entries.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === artifact) ||
      existsSync(join(resourcesDir, 'app.asar.unpacked', ...artifact.split('/')))
    ) {
      throw new Error(`[ash-package-hygiene] excluded mobile/relay module packaged: ${artifact}`)
    }
  }
  // A new direct require/import of one of the excluded compatibility modules
  // must fail the package, rather than producing a dangling local-runtime
  // dependency. This checks statically named JS imports, not arbitrary
  // computed dynamic paths; native process/browser integration remains vital.
  const removedMobileModules = new Set(EXCLUDED_ASH_MOBILE_RELAY_MODULES)
  const literalModuleReference =
    /\b(?:require|import)\s*\(\s*['"](\.[^'"]+)['"]\s*\)|\b(?:import|export)\s+(?:[^\n;]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g
  for (const item of entries) {
    const importer = item.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!importer.startsWith('out/') || !importer.endsWith('.js')) {
      continue
    }
    const source = extractFile(archivePath, importer).toString('utf8')
    literalModuleReference.lastIndex = 0
    for (const match of source.matchAll(literalModuleReference)) {
      const specifier = match[1] ?? match[2]
      const resolved = posix.normalize(posix.join(posix.dirname(importer), specifier))
      for (const root of EXCLUDED_ASH_CLI_ARTIFACT_ROOTS) {
        if (resolved === root || resolved.startsWith(`${root}/`)) {
          throw new Error(
            `[ash-package-hygiene] retained runtime imports excluded app-plugin CLI tree: ${importer} -> ${resolved}`
          )
        }
      }
      for (const root of EXCLUDED_APP_PLUGIN_CJS_ROOTS) {
        if (resolved === root || resolved.startsWith(`${root}/`)) {
          throw new Error(
            `[ash-package-hygiene] retained runtime imports excluded app-plugin CommonJS tree: ${importer} -> ${resolved}`
          )
        }
      }
      for (const candidate of [resolved, `${resolved}.js`, `${resolved}/index.js`]) {
        if (removedMobileModules.has(candidate)) {
          throw new Error(
            `[ash-package-hygiene] retained runtime imports excluded mobile/relay module: ${importer} -> ${candidate}`
          )
        }
      }
    }
  }
  for (const root of EXCLUDED_ASH_MOBILE_SERVICE_ROOTS) {
    if (
      entries.some((entry) => {
        const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '')
        return normalized === root || normalized.startsWith(`${root}/`)
      }) ||
      existsSync(join(resourcesDir, 'app.asar.unpacked', ...root.split('/')))
    ) {
      throw new Error(`[ash-package-hygiene] excluded mobile/remote service tree packaged: ${root}`)
    }
  }
  for (const root of EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS) {
    if (existsSync(join(resourcesDir, root))) {
      throw new Error(`[ash-package-hygiene] excluded mobile/relay native resource: ${root}`)
    }
  }
  if (
    entries.some((entry) => {
      const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '')
      return (
        normalized === EXCLUDED_APP_PLUGIN_SOURCE_ROOT ||
        normalized.startsWith(`${EXCLUDED_APP_PLUGIN_SOURCE_ROOT}/`)
      )
    }) ||
    existsSync(join(resourcesDir, 'app.asar.unpacked', EXCLUDED_APP_PLUGIN_SOURCE_ROOT)) ||
    existsSync(join(resourcesDir, EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT))
  ) {
    throw new Error('[ash-package-hygiene] excluded app-plugin marketplace/authoring tree packaged')
  }
  const speechWorker = 'out/main/stt-worker.js'
  if (
    entries.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === speechWorker) ||
    existsSync(join(resourcesDir, 'app.asar.unpacked', ...speechWorker.split('/')))
  ) {
    throw new Error('[ash-package-hygiene] excluded speech worker packaged: stt-worker.js')
  }
  // No installed speech recognizer is needed by an Ash release; protect both
  // ASAR and separate extraResources/native dependency copy paths on all OSes.
  if (
    entries.some((entry) => /^\/?node_modules\/sherpa-onnx(?:\/|-)/.test(entry.replace(/\\/g, '/')))
  ) {
    throw new Error('[ash-package-hygiene] excluded speech native dependency in app.asar')
  }
  for (const root of [
    join(resourcesDir, 'node_modules'),
    join(resourcesDir, 'app.asar.unpacked', 'node_modules')
  ]) {
    if (existsSync(root) && readdirSync(root).some((name) => /^sherpa-onnx(?:$|-)/.test(name))) {
      throw new Error('[ash-package-hygiene] excluded speech native dependency in resources')
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
