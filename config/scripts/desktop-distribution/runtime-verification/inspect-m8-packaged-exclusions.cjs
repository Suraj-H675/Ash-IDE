const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const posix = path.posix

const {
  withAshPackageInputSnapshot,
  isSupportedPackageVersion
} = require('../release/ash-package-input-identity.cjs')
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

const MAX_ENTRY_READ_BYTES = 16 * 1024 * 1024
const MAX_IMPORT_READ_BYTES = 128 * 1024 * 1024
const MAX_RESOURCE_FILE_BYTES = 512 * 1024 * 1024
const MAX_RESOURCE_TREE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_RESOURCE_FILES = 100_000
const MAX_RESOURCE_DEPTH = 128
const EXPECTED_PACKAGE_IDENTITY = {
  appId: 'com.ashide.desktop',
  evidenceKind: 'packaging-input-snapshot',
  packageName: 'ash-ide',
  productName: 'Ash IDE',
  schema: 1
}
const FORBIDDEN_VENDOR_MODULES = ['@linear/sdk', '@posthog/core', '@posthog/types', 'posthog-node']
const GATE_REQUIREMENTS = {
  'EX-01':
    'Mobile pairing, app, push, and relay are excluded without removing local mobile emulation.',
  'EX-02': 'Remote SSH host management and deployment are excluded; ordinary SSH and Git remain.',
  'EX-03':
    'General IDE plugin installation and management are excluded; Chromium extensions remain.',
  'EX-04': 'Scheduled Runs are excluded; manual Runs remain.',
  'EX-05':
    'Ash-managed skills and MCP marketplace installation are excluded; provider-native flows remain.',
  'EX-06': 'Ash vendor cloud accounts and relay services are excluded.',
  'EX-07': 'Jira and Linear app connectors are excluded without credential capture.',
  'EX-08': 'Voice and dictation services and bundled models are excluded.',
  'EX-09': 'Product telemetry must not transmit analytics network requests.',
  'EX-10':
    'Obsolete Orca-branded execution paths and removed-feature controls are absent from the normal Ash app.',
  'PK-08':
    'The package excludes retired components and unrelated runtime listeners while retaining supported controls.'
}
const IMPORTS =
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]\s*\)|\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/gs
const FEATURE_CANDIDATES = [
  [
    'EX-01',
    'mobile pairing, app, push, and relay',
    (p) =>
      /^out\/(?:shared\/mobile-|shared\/remote-runtime\/(?:pairing|relay)\/|shared\/remote-runtime\/e2ee\/.*mobile|cli\/runtime\/runtime-remote-pairing|renderer\/assets\/.*mobile)/i.test(
        p
      )
  ],
  [
    'EX-02',
    'remote SSH host management and deployment',
    (p) =>
      /^out\/shared\/remote-runtime\/(?:host-catalog|host-store|host-status)\//i.test(p) ||
      /^out\/(?:main\/chunks\/.*(?:remote-exec-command|remote-install-model)|renderer\/assets\/RemoteServer)/i.test(
        p
      )
  ],
  [
    'EX-03',
    'general IDE plugins',
    (p) =>
      p === EXCLUDED_APP_PLUGIN_SOURCE_ROOT ||
      p.startsWith(`${EXCLUDED_APP_PLUGIN_SOURCE_ROOT}/`) ||
      /^out\/shared\/(?:legacy-app-plugin-settings|plugin-appearance-settings-types|plugin-theme-settings)\.js$/i.test(
        p
      ) ||
      /^out\/shared\/plugins\//i.test(p)
  ],
  [
    'EX-04',
    'scheduled Runs',
    (p) =>
      /^out\/shared\/automation-schedules?\.js$/i.test(p) ||
      /^out\/shared\/automation-schedule-/i.test(p) ||
      p === 'out/cli/automation-runs-paging.js'
  ],
  [
    'EX-05',
    'Ash-managed skills and MCP marketplace',
    (p) =>
      /^out\/(?:main|shared|cli)\/.*(?:skill|mcp).*(?:marketplace|catalog|installer|transfer)|^out\/(?:main|shared|cli)\/.*(?:marketplace|catalog).*(?:skill|mcp)/i.test(
        p
      )
  ],
  [
    'EX-06',
    'vendor cloud accounts and relay services',
    (p) =>
      /^out\/shared\/(?:cloud-service-url|connector-cloud-contract|legacy-relay-bridge|mobile-desktop-relay-contract|relay-frame|relay-install)/i.test(
        p
      )
  ],
  [
    'EX-07',
    'Jira and Linear app connectors',
    (p) =>
      /^out\/shared\/(?:jira|linear)\//i.test(p) ||
      /^out\/(?:cli\/.*(?:jira|linear)|renderer\/assets\/.*(?:jira|linear))/i.test(p)
  ],
  [
    'EX-08',
    'voice and dictation',
    (p) =>
      /^out\/(?:shared\/(?:speech|dictation|host-dictation)|renderer\/assets\/.*(?:speech|dictation|voice)|main\/.*(?:speech|stt))/i.test(
        p
      )
  ]
]
const TELEMETRY_CANDIDATE = (p) => /(?:telemetry|posthog|analytics)/i.test(p)
const ORCA_NAME_CANDIDATE = (p) => /(?:^|\/)(?:orca|onorca)(?:[-._]|$)/i.test(p)
const CANDIDATES = [
  ...FEATURE_CANDIDATES.map(([id, label, matches]) => ({ id, label, matches })),
  {
    id: 'EX-09',
    label: 'product telemetry path names',
    matches: TELEMETRY_CANDIDATE
  },
  {
    id: 'EX-10',
    label: 'obsolete Orca names and removed-feature paths',
    matches: (p) => ORCA_NAME_CANDIDATE(p) || FEATURE_CANDIDATES.some(([, , match]) => match(p))
  }
]

function sameStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function assertRealPath(fullPath, info, kind) {
  if (
    info.isSymbolicLink() ||
    (kind === 'directory' && !info.isDirectory()) ||
    (kind === 'file' && !info.isFile()) ||
    fs.realpathSync(fullPath) !== path.resolve(fullPath)
  ) {
    throw new Error(`Resources tree contains a non-real ${kind} path`)
  }
}

function collectResourcesTree(resourcesDir) {
  const snapshots = new Map()
  const allPaths = new Set()
  const filePaths = new Set()
  const unpackedFiles = new Map()
  const resourceRoots = new Set()
  const counts = { files: 0, bytes: 0, entries: 0 }

  function remember(fullPath, info) {
    snapshots.set(fullPath, info)
  }

  function countFile(fullPath, info) {
    if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(MAX_RESOURCE_FILE_BYTES)) {
      throw new Error('Resources tree contains a non-regular or oversized file')
    }
    counts.files += 1
    counts.bytes += Number(info.size)
    if (counts.files > MAX_RESOURCE_FILES || counts.bytes > MAX_RESOURCE_TREE_BYTES) {
      throw new Error('Resources tree exceeds its inspection limit')
    }
    remember(fullPath, info)
  }

  function walkDirectory(directory, relative, depth, onFile) {
    if (depth > MAX_RESOURCE_DEPTH) {
      throw new Error('Resources tree exceeds its directory depth limit')
    }
    const directoryInfo = fs.lstatSync(directory, { bigint: true })
    assertRealPath(directory, directoryInfo, 'directory')
    remember(directory, directoryInfo)
    if (relative) {
      allPaths.add(relative)
    }
    const handle = fs.opendirSync(directory)
    try {
      while (true) {
        const item = handle.readSync()
        if (!item) {
          break
        }
        counts.entries += 1
        if (counts.entries > MAX_RESOURCE_FILES) {
          throw new Error('Resources tree exceeds its entry-count limit')
        }
        if (!item.name || item.name.includes('/') || item.name.includes('\\')) {
          throw new Error('Resources tree contains an unsafe path')
        }
        const fullPath = path.join(directory, item.name)
        const childPath = relative ? `${relative}/${item.name}` : item.name
        const info = fs.lstatSync(fullPath, { bigint: true })
        if (info.isSymbolicLink()) {
          throw new Error('Resources tree contains a symbolic link')
        }
        if (info.isDirectory()) {
          walkDirectory(fullPath, childPath, depth + 1, onFile)
        } else if (info.isFile()) {
          countFile(fullPath, info)
          allPaths.add(childPath)
          filePaths.add(childPath)
          onFile?.(childPath, fullPath, info)
        } else {
          throw new Error('Resources tree contains an unsupported filesystem entry')
        }
      }
    } finally {
      handle.closeSync()
    }
  }

  const resourcesInfo = fs.lstatSync(resourcesDir, { bigint: true })
  assertRealPath(resourcesDir, resourcesInfo, 'directory')
  remember(resourcesDir, resourcesInfo)
  const handle = fs.opendirSync(resourcesDir)
  try {
    while (true) {
      const item = handle.readSync()
      if (!item) {
        break
      }
      counts.entries += 1
      if (counts.entries > MAX_RESOURCE_FILES) {
        throw new Error('Resources tree exceeds its entry-count limit')
      }
      if (!item.name || item.name.includes('/') || item.name.includes('\\')) {
        throw new Error('Resources tree contains an unsafe path')
      }
      const fullPath = path.join(resourcesDir, item.name)
      const info = fs.lstatSync(fullPath, { bigint: true })
      if (item.name === 'app.asar' || item.name === 'ash-package-input-identity.json') {
        assertRealPath(fullPath, info, 'file')
        countFile(fullPath, info)
        continue
      }
      if (item.name === 'app.asar.unpacked') {
        resourceRoots.add(item.name)
        walkDirectory(fullPath, '', 1, (relative, filePath, fileInfo) => {
          unpackedFiles.set(relative, { fullPath: filePath, size: Number(fileInfo.size) })
        })
      } else if (info.isSymbolicLink()) {
        throw new Error('Resources tree contains a symbolic link')
      } else if (info.isDirectory()) {
        const relative = `resources/${item.name}`
        resourceRoots.add(item.name)
        walkDirectory(fullPath, relative, 1)
      } else if (info.isFile()) {
        countFile(fullPath, info)
        const relative = `resources/${item.name}`
        allPaths.add(relative)
        filePaths.add(relative)
        resourceRoots.add(item.name)
      } else {
        throw new Error('Resources tree contains an unsupported filesystem entry')
      }
    }
  } finally {
    handle.closeSync()
  }

  return {
    allPaths,
    filePaths,
    unpackedFiles,
    resourceRoots,
    assertUnchanged() {
      for (const [fullPath, before] of snapshots) {
        const after = fs.lstatSync(fullPath, { bigint: true })
        assertRealPath(fullPath, after, before.isDirectory() ? 'directory' : 'file')
        if (!sameStat(before, after)) {
          throw new Error('Resources tree changed while being inspected')
        }
      }
    }
  }
}

function validateUnpackedEntries(archiveEntries, unpackedFiles) {
  const unlisted = []
  const sizeMismatches = []
  const missing = []
  for (const [relative, item] of unpackedFiles) {
    const entry = archiveEntries.get(relative)
    if (!entry || entry.kind !== 'file' || entry.metadata.unpacked !== true) {
      unlisted.push(relative)
    } else if (entry.size !== item.size) {
      sizeMismatches.push({ path: relative, headerSize: entry.size, unpackedSize: item.size })
    }
  }
  for (const [relative, entry] of archiveEntries) {
    if (entry.kind === 'file' && entry.metadata.unpacked === true && !unpackedFiles.has(relative)) {
      missing.push(relative)
    }
  }
  return { unlisted, sizeMismatches, missing }
}

function readEntry(snapshot, relative, budget) {
  const entry = snapshot.archiveEntries.get(relative)
  if (!entry || entry.kind !== 'file') {
    return null
  }
  if (entry.size > MAX_ENTRY_READ_BYTES) {
    budget.skippedLargeEntries.add(relative)
    return null
  }
  if (entry.size > budget.limit - budget.bytesRead) {
    budget.exhausted = true
    return null
  }
  budget.bytesRead += entry.size
  return snapshot.readEntry(relative, MAX_ENTRY_READ_BYTES)
}

async function staticClosure(snapshot, starts, budget) {
  const seen = new Set()
  const pending = [...starts]
  const queued = new Set(pending)
  while (pending.length) {
    if (budget.exhausted) {
      break
    }
    const current = pending.pop()
    const entry = snapshot.archiveEntries.get(current)
    if (!entry || entry.kind !== 'file' || seen.has(current)) {
      continue
    }
    seen.add(current)
    if (!/\.[cm]?js$/.test(current)) {
      continue
    }
    const bytes = readEntry(snapshot, current, budget)
    if (!bytes) {
      continue
    }
    const source = bytes.toString('utf8')
    IMPORTS.lastIndex = 0
    for (const match of source.matchAll(IMPORTS)) {
      const specifier = match.slice(1).find(Boolean)
      if (!specifier || !specifier.startsWith('.')) {
        continue
      }
      const base = posix.normalize(posix.join(posix.dirname(current), specifier))
      if (base === '..' || base.startsWith('../') || base.startsWith('/')) {
        continue
      }
      for (const next of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) {
        const nextEntry = snapshot.archiveEntries.get(next)
        if (nextEntry?.kind === 'file' && !queued.has(next)) {
          queued.add(next)
          pending.push(next)
        }
      }
    }
  }
  return seen
}

function rendererStarts(snapshot, budget) {
  if (budget.exhausted) {
    return []
  }
  const html = readEntry(snapshot, 'out/renderer/index.html', budget)
  if (!html) {
    return []
  }
  const starts = new Set()
  const refs = /(?:src|href)=["']([^"']+\.js)(?:\?[^"']*)?["']/gi
  for (const match of html.toString('utf8').matchAll(refs)) {
    if (/^[a-z]+:/i.test(match[1]) || match[1].startsWith('//')) {
      continue
    }
    const relative = match[1].replace(/^\//, '').replace(/^\.\//, '')
    const candidate = relative.startsWith('out/')
      ? posix.normalize(relative)
      : posix.normalize(posix.join('out/renderer', relative))
    if (snapshot.archiveEntries.get(candidate)?.kind === 'file') {
      starts.add(candidate)
    }
  }
  return [...starts]
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function isUnderRoot(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`)
}

function classifyMobileRelay(pathName) {
  if (/remote-runtime\/host-store|remote-host/i.test(pathName)) {
    return 'EX-02'
  }
  if (/^out\/shared\/relay-(?:host-close-reason|version-marker)\.js$/i.test(pathName)) {
    return 'EX-06'
  }
  return 'EX-01'
}

function exactPathPolicies() {
  return [
    ...EXCLUDED_TASK_TRACKER_CLI_ARTIFACTS.map((pathName) => ({
      path: pathName,
      policy: 'EX-07 task tracker CLI artifact',
      gate: 'EX-07'
    })),
    ...EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS.map((pathName) => ({
      path: pathName,
      policy: /speech/i.test(pathName)
        ? 'EX-08 speech CLI artifact'
        : 'EX-03 application-plugin CLI artifact',
      gate: /speech/i.test(pathName) ? 'EX-08' : 'EX-03'
    })),
    ...EXCLUDED_APP_PLUGIN_EXECUTABLES.map((pathName) => ({
      path: pathName,
      policy: 'EX-03 application-plugin executable',
      gate: 'EX-03'
    })),
    ...EXCLUDED_ASH_MOBILE_RELAY_MODULES.map((pathName) => ({
      path: pathName,
      policy: 'PK-08 exact mobile/relay module',
      gate: classifyMobileRelay(pathName)
    }))
  ]
}

function exactRootPolicies() {
  return [
    ...EXCLUDED_ASH_CLI_ARTIFACT_ROOTS.map((root) => ({
      root,
      policy: 'EX-03 application-plugin CLI root',
      gate: 'EX-03'
    })),
    ...EXCLUDED_APP_PLUGIN_CJS_ROOTS.map((root) => ({
      root,
      policy: 'EX-03 application-plugin CommonJS root',
      gate: 'EX-03'
    })),
    ...EXCLUDED_ASH_MOBILE_SERVICE_ROOTS.map((root) => ({
      root,
      policy: 'PK-08 exact mobile/relay service root',
      gate: /remote-host/.test(root) ? 'EX-02' : /relay/.test(root) ? 'EX-06' : 'EX-01'
    })),
    {
      root: EXCLUDED_APP_PLUGIN_SOURCE_ROOT,
      policy: 'EX-03 application-plugin source root',
      gate: 'EX-03'
    }
  ]
}

function buildExactHits(allPaths, resourceRoots) {
  const hits = new Map()
  function add(pathName, policy, gate, includeEx10 = true) {
    const key = `${pathName}\u0000${policy}`
    const current = hits.get(key) ?? { path: pathName, policy, gates: new Set() }
    current.gates.add(gate)
    if (includeEx10) {
      current.gates.add('EX-10')
    }
    current.gates.add('PK-08')
    hits.set(key, current)
  }

  for (const item of exactPathPolicies()) {
    if (allPaths.has(item.path)) {
      add(item.path, item.policy, item.gate)
    }
  }
  for (const item of exactRootPolicies()) {
    for (const pathName of allPaths) {
      if (isUnderRoot(pathName, item.root)) {
        add(pathName, item.policy, item.gate)
      }
    }
  }
  for (const root of EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS) {
    if (resourceRoots.has(root)) {
      add(
        `resources/${root}`,
        'PK-08 exact mobile/relay native resource root',
        root === 'relay' ? 'EX-06' : 'EX-01'
      )
    }
  }
  if (resourceRoots.has(EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT)) {
    add(
      `resources/${EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT}`,
      'EX-03 application-plugin native resource root',
      'EX-03'
    )
  }
  for (const name of FORBIDDEN_VENDOR_MODULES) {
    const roots = [
      `node_modules/${name}`,
      `resources/node_modules/${name}`,
      `resources/app.asar.unpacked/node_modules/${name}`
    ]
    for (const pathName of allPaths) {
      if (roots.some((root) => isUnderRoot(pathName, root))) {
        const gate = name.startsWith('@posthog/') || name === 'posthog-node' ? 'EX-09' : 'EX-07'
        add(pathName, `PK-08 excluded vendor module ${name}`, gate, gate !== 'EX-09')
      }
    }
  }

  return [...hits.values()]
    .map((item) => ({ ...item, gates: [...item.gates].sort() }))
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.policy.localeCompare(right.policy)
    )
}

function vendorModulePaths(paths) {
  return FORBIDDEN_VENDOR_MODULES.filter((name) => {
    const roots = [
      `node_modules/${name}`,
      `resources/node_modules/${name}`,
      `resources/app.asar.unpacked/node_modules/${name}`
    ]
    return [...paths].some((item) => roots.some((root) => isUnderRoot(item, root)))
  })
}

function candidateReasons(pathName) {
  const reasons = FEATURE_CANDIDATES.filter(([, , match]) => match(pathName)).map(([id]) => id)
  if (ORCA_NAME_CANDIDATE(pathName)) {
    reasons.push('EX-10')
  }
  return [...new Set(reasons)]
}

function makeCandidateAreas(filePaths, roots) {
  return CANDIDATES.map(({ id, label, matches }) => {
    const found = [...filePaths].filter(matches).sort()
    return {
      id,
      label,
      shippedFileCount: found.length,
      literalImportClosureCounts: Object.fromEntries(
        Object.entries(roots).map(([root, closure]) => [
          root,
          found.filter((pathName) => closure.has(pathName)).length
        ])
      ),
      examples: found.slice(0, 10).map((pathName) => ({
        path: pathName,
        candidateReasons: candidateReasons(pathName),
        literalImportRoots: Object.entries(roots)
          .filter(([, closure]) => closure.has(pathName))
          .map(([root]) => root)
      }))
    }
  })
}

function gateStatus(id, exactHits, candidates) {
  const exact = exactHits.filter((hit) => hit.gates.includes(id))
  if (exact.length) {
    return 'confirmed-forbidden-artifact'
  }
  if (id === 'EX-09') {
    return 'not-tested'
  }
  const candidate = candidates.find((item) => item.id === id)
  return candidate?.shippedFileCount ? 'review-needed' : 'not-observed'
}

function makeGates(exactHits, candidateAreas, failures) {
  const gates = {}
  for (const id of Object.keys(GATE_REQUIREMENTS).filter((item) => item !== 'PK-08')) {
    const candidate = candidateAreas.find((item) => item.id === id)
    const exact = exactHits.filter((hit) => hit.gates.includes(id))
    gates[id] = {
      requirement: GATE_REQUIREMENTS[id],
      status: gateStatus(id, exactHits, candidateAreas),
      confirmedForbiddenArtifacts: exact,
      filenameCandidates: candidate
        ? { count: candidate.shippedFileCount, examples: candidate.examples }
        : { count: 0, examples: [] },
      runtimeEvidence: 'not-tested'
    }
    if (id === 'EX-09') {
      gates[id].status = 'not-tested'
      gates[id].runtimeEvidence = 'native network capture not run'
    }
  }
  const reviewNeeded = candidateAreas.some((item) => item.shippedFileCount > 0)
  gates['PK-08'] = {
    requirement: GATE_REQUIREMENTS['PK-08'],
    status: failures.length ? 'fail' : reviewNeeded ? 'review-needed' : 'not-accepted',
    confirmedForbiddenArtifacts: exactHits,
    candidateAreaCounts: Object.fromEntries(
      candidateAreas.map((item) => [item.id, item.shippedFileCount])
    ),
    runtimeEvidence: 'listeners and started services not tested'
  }
  return gates
}

function reportForError(error) {
  const message = error instanceof Error ? error.message : 'unknown inspection error'
  const gates = Object.fromEntries(
    Object.entries(GATE_REQUIREMENTS).map(([id, requirement]) => [
      id,
      { requirement, status: id === 'PK-08' ? 'fail' : 'not-tested' }
    ])
  )
  return {
    schema: 2,
    inspection: {
      scope: 'read-only linux-unpacked resources directory',
      outerAppImageInspected: false,
      packageFilesExecuted: false,
      startedRuntimeObserved: false,
      nativeNetworkCaptureObserved: false
    },
    identity: { status: 'unverified' },
    gates,
    staticFindings: { status: 'inspection-failed' },
    result: 'non-accepting',
    failures: ['offline package inspection could not complete'],
    error: message
  }
}

async function inspect({ resourcesDir, expected, importReadLimit = MAX_IMPORT_READ_BYTES }) {
  if (
    !Number.isSafeInteger(importReadLimit) ||
    importReadLimit < 0 ||
    importReadLimit > MAX_IMPORT_READ_BYTES
  ) {
    throw new Error('Invalid literal import analysis byte budget')
  }
  return withAshPackageInputSnapshot(resourcesDir, async (snapshot) => {
    const tree = collectResourcesTree(snapshot.resourcesDir)
    const allPaths = new Set([...snapshot.archiveEntries.keys(), ...tree.allPaths])
    const filePaths = new Set(
      [...snapshot.archiveEntries]
        .filter(([, entry]) => entry.kind === 'file')
        .map(([pathName]) => pathName)
    )
    for (const pathName of tree.filePaths) {
      filePaths.add(pathName)
    }
    const unpacked = validateUnpackedEntries(snapshot.archiveEntries, tree.unpackedFiles)
    const budget = {
      limit: importReadLimit,
      bytesRead: 0,
      exhausted: false,
      skippedLargeEntries: new Set()
    }
    const roots = {
      main: await staticClosure(snapshot, ['out/main/index.js'], budget),
      preload: await staticClosure(snapshot, ['out/preload/index.js'], budget),
      cli: await staticClosure(snapshot, ['out/cli/index.js'], budget),
      renderer: await staticClosure(snapshot, rendererStarts(snapshot, budget), budget)
    }
    const importAnalysisIncomplete = budget.exhausted || budget.skippedLargeEntries.size > 0
    const candidateAreas = makeCandidateAreas(filePaths, roots)
    const exactHits = buildExactHits(allPaths, tree.resourceRoots)
    const exactHitsByPath = exactHits.map(({ path: pathName, policy }) => ({
      path: pathName,
      policy
    }))
    const rootHits = exactHits
      .filter((hit) => / root/.test(hit.policy) && !/native resource root/.test(hit.policy))
      .map((hit) => hit.path)
    const nativeRoots = exactHits
      .filter((hit) => /native resource root/.test(hit.policy))
      .map((hit) => hit.path)
    const packageJson = snapshot.packageMetadata
    const declaredVendorDependencies = FORBIDDEN_VENDOR_MODULES.filter(
      (name) => packageJson.dependencies?.[name] !== undefined
    )
    const installedVendorModules = vendorModulePaths(allPaths)
    const license = snapshot.readEntry('LICENSE', MAX_ENTRY_READ_BYTES)
    const ledger = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../../docs/provenance/ash-exclusions.json'),
        'utf8'
      )
    )
    const archiveHashMatches =
      /^[a-f0-9]{64}$/.test(snapshot.identity.capturedAppAsarSha256 ?? '') &&
      snapshot.identity.capturedAppAsarSha256 === snapshot.archiveSha256
    const cliPackageHashMatches =
      /^[a-f0-9]{64}$/.test(snapshot.identity.capturedCompiledCliPackageJsonSha256 ?? '') &&
      sha256(snapshot.cliPackageBytes) === snapshot.identity.capturedCompiledCliPackageJsonSha256
    const sourceCommitMatches =
      /^[a-f0-9]{40}$/.test(snapshot.identity.sourceCommit ?? '') &&
      snapshot.identity.sourceCommit !== '0'.repeat(40) &&
      snapshot.identity.sourceCommit === expected
    const cliSourceCommitMatches = sourceCommitMatches && snapshot.cliPackage.commit === expected
    const licenseMatches = Boolean(license) && sha256(license) === ledger.licenseSha256
    const sidecarIdentityMatches =
      Object.entries(EXPECTED_PACKAGE_IDENTITY).every(
        ([key, value]) => snapshot.identity[key] === value
      ) &&
      isSupportedPackageVersion(snapshot.identity.version) &&
      ['x64', 'arm64'].includes(snapshot.identity.architecture)
    const positiveControls = {
      browserExtensionPreload: snapshot.archiveEntries.has('out/main/browser-extension-preload.js'),
      browserExtensionHost: snapshot.archiveEntries.has(
        'out/main/browser-extension-native-host-supervisor-entry.js'
      ),
      localBrowserAutomation: snapshot.archiveEntries.has(
        'out/shared/browser/client-hosting/browser-client-automation-protocol.js'
      ),
      localCliRuntime: snapshot.archiveEntries.has('out/cli/index.js'),
      localDaemonRuntime: snapshot.archiveEntries.has('out/main/daemon-entry.js'),
      wslProviderHookRelay: [...filePaths].some((item) =>
        /(?:^|\/)relay-bundle-paths-[^/]+\.js$/.test(item)
      ),
      providerNativeSkills: allPaths.has('resources/skills/current-manifest.json'),
      ashUpdateConfigAbsent:
        !allPaths.has('resources/app-update.yml') &&
        ![...allPaths].some(
          (item) =>
            isUnderRoot(item, 'node_modules/electron-updater') ||
            isUnderRoot(item, 'resources/node_modules/electron-updater')
        )
    }
    const failures = []
    if (!sourceCommitMatches) {
      failures.push('package sourceCommit does not match expected commit')
    }
    if (sourceCommitMatches && !cliSourceCommitMatches) {
      failures.push('compiled CLI commit does not match package sourceCommit')
    }
    if (!archiveHashMatches) {
      failures.push('sidecar app.asar digest mismatch')
    }
    if (!cliPackageHashMatches) {
      failures.push('compiled CLI package.json digest mismatch')
    }
    if (!sidecarIdentityMatches) {
      failures.push('package sidecar metadata does not match the Ash package identity')
    }
    if (!licenseMatches) {
      failures.push('packaged upstream MIT license digest mismatch')
    }
    if (exactHits.length || installedVendorModules.length) {
      failures.push('confirmed forbidden package artifacts are present')
    }
    if (unpacked.unlisted.length) {
      failures.push('app.asar.unpacked contains files absent from its ASAR entries')
    }
    if (unpacked.sizeMismatches.length) {
      failures.push('app.asar.unpacked file sizes do not match the ASAR header')
    }
    if (unpacked.missing.length) {
      failures.push('ASAR entries marked unpacked are missing from app.asar.unpacked')
    }
    for (const [name, present] of Object.entries(positiveControls)) {
      if (!present) {
        failures.push(`missing retained path control: ${name}`)
      }
    }
    tree.assertUnchanged()
    const identityFailures = failures.filter((failure) =>
      /sourceCommit|digest mismatch|sidecar metadata|license digest/.test(failure)
    )
    const identity = {
      status: identityFailures.length ? 'mismatch' : 'verified',
      expectedSourceCommit: expected,
      packageInputSourceCommit: snapshot.identity.sourceCommit,
      sourceCommitValid: /^[a-f0-9]{40}$/.test(snapshot.identity.sourceCommit ?? ''),
      sourceCommitMatches,
      compiledCliSourceCommit: snapshot.cliPackage.commit ?? null,
      cliSourceCommitMatches,
      version: snapshot.identity.version,
      architecture: snapshot.identity.architecture,
      appAsarSha256: snapshot.archiveSha256,
      appAsarMatchesSidecar: archiveHashMatches,
      cliPackageJsonMatchesSidecar: cliPackageHashMatches,
      sourceLedger: {
        repository: ledger.source.repository,
        commit: ledger.source.commit,
        version: ledger.source.version,
        licenseSha256: ledger.licenseSha256
      },
      packagedLicenseMatchesLedger: licenseMatches
    }
    const candidateCount = candidateAreas.reduce((count, item) => count + item.shippedFileCount, 0)
    const staticStatus = failures.length
      ? 'hard-findings'
      : importAnalysisIncomplete
        ? 'inspection-incomplete'
        : candidateCount
          ? 'review-needed'
          : 'no-hard-findings'
    const gates = makeGates(exactHits, candidateAreas, failures)
    if (!failures.length && importAnalysisIncomplete) {
      gates['PK-08'].status = 'inspection-incomplete'
    }
    gates['PK-08'].confirmedForbiddenArtifacts = exactHits
    return {
      schema: 2,
      inspection: {
        scope: 'read-only linux-unpacked resources directory',
        outerAppImageInspected: false,
        packageFilesExecuted: false,
        startedRuntimeObserved: false,
        nativeNetworkCaptureObserved: false,
        appAsarSnapshot:
          'private copy digest checked before and after inspection; @electron/asar opens it by path',
        unpackedTreeSnapshot:
          'path entries were checked before and after; no openat directory pinning',
        literalRelativeImportsOnly: true,
        literalImportAnalysisStatus: importAnalysisIncomplete
          ? 'incomplete'
          : 'bounded-literal-scan-complete',
        literalImportAnalysisByteLimit: budget.limit,
        literalImportAnalysisBytesRead: budget.bytesRead,
        literalImportAnalysisBudgetExhausted: budget.exhausted,
        literalImportAnalysisSkippedLargeEntries: [...budget.skippedLargeEntries].sort()
      },
      identity,
      inventory: {
        asarFileCount: [...snapshot.archiveEntries.values()].filter((item) => item.kind === 'file')
          .length,
        unlistedUnpackedFileCount: unpacked.unlisted.length,
        unlistedUnpackedFiles: unpacked.unlisted.slice(0, 30),
        unpackedSizeMismatches: unpacked.sizeMismatches.slice(0, 30),
        missingUnpackedFiles: unpacked.missing.slice(0, 30),
        exactExclusionHits: exactHitsByPath,
        excludedRootHits: rootHits.slice(0, 30),
        excludedNativeResourceRoots: nativeRoots,
        candidateAreas,
        literalImportClosureFileCounts: Object.fromEntries(
          Object.entries(roots).map(([name, closure]) => [name, closure.size])
        ),
        declaredVendorDependencies,
        installedVendorModules,
        speechRuntimeArtifacts: [...filePaths]
          .filter((item) =>
            /(?:^|\/)(?:stt-worker(?:-[^/]+)?\.js|sherpa-onnx(?:-[^/]+)?(?:\/|\.|$))/i.test(item)
          )
          .sort(),
        retained: positiveControls
      },
      gates,
      staticFindings: { status: staticStatus },
      result: 'non-accepting',
      failures,
      acceptanceLimitations: [
        'Path names and literal relative imports do not prove that a UI, API, host, worker, or service can start.',
        'EX-09 requires native network capture; no capture was run.',
        'The AppImage container and runtime listeners were not inspected.',
        'A transient same-UID swap of the private ASAR copy path between integrity checks cannot be ruled out.',
        'Candidate-only findings need review and do not prove forbidden behavior.'
      ]
    }
  })
}

function options(args) {
  const pairs = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (
      !['--resources-dir', '--expected-source-commit'].includes(key) ||
      !value ||
      pairs.has(key)
    ) {
      throw new Error(
        'Usage: inspect-m8-packaged-exclusions.cjs --resources-dir PATH --expected-source-commit HEX'
      )
    }
    pairs.set(key, value)
  }
  const resourcesDir = pairs.get('--resources-dir')
  const expected = pairs.get('--expected-source-commit')
  if (pairs.size !== 2 || !path.isAbsolute(resourcesDir) || !/^[a-f0-9]{40}$/.test(expected)) {
    throw new Error(
      'Usage: inspect-m8-packaged-exclusions.cjs --resources-dir PATH --expected-source-commit HEX'
    )
  }
  return { resourcesDir: path.resolve(resourcesDir), expected }
}

function exitCodeForReport(report) {
  return report.result === 'accepting' ? 0 : 1
}

async function runCli(args) {
  let report
  try {
    report = await inspect(options(args))
  } catch (error) {
    report = reportForError(error)
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = exitCodeForReport(report)
}

if (require.main === module) {
  runCli(process.argv.slice(2))
}

module.exports = { exitCodeForReport, inspect, options, reportForError }
