import { isBuiltin } from 'node:module'
import type { Plugin, Rollup } from 'vite'
import { DEFAULT_SMOKE_TIMINGS, smokeLoadDaemonEntry } from './plain-node-entry-guard-smoke'
import type { SmokeTimings } from './plain-node-entry-guard-smoke'

type NormalizedInputOptions = Rollup.NormalizedInputOptions
type NormalizedOutputOptions = Rollup.NormalizedOutputOptions
type OutputBundle = Rollup.OutputBundle
type OutputChunk = Rollup.OutputChunk

// A shared-chunk Electron import killed plain-Node daemons in v1.4.129-rc.1 (#7642).
// Scan every reachable fork/worker chunk for Electron requires; smoke-load daemon-entry to verify module resolution.

// The CLI loads these paths after electron-vite replaces out/main.
export const CLI_MAIN_ENTRY_NAMES = [
  'agent-hooks/managed-agent-hook-controls',
  'gitlab/project-ref-parser',
  'orca-profiles/profile-index-store',
  'claude-accounts/keychain',
  'skills/bundled-skill-install/cli-entry',
  'filesystem/macos-tree-clone',
  'orcad/orcad-stale-lock-reclaim',
  ...[
    'access',
    'active-location',
    'storage-classification',
    'offline-settings',
    'backup-path',
    // Direct profile recovery imports must remain explicit Rollup inputs.
    'database',
    'database-recovery',
    'documents',
    'domain-reader',
    'manual-checkpoint',
    'recovery-command'
  ].map((module) => `persistence/profile-state/profile-state-${module}`),
  'persistence/profile-state/legacy-json/profile-state-export-path',
  'persistence/profile-state/legacy-json/profile-state-recovery',
  'startup/http1-compatibility-marker'
] as const

const PLAIN_NODE_ENTRY_NAMES = [
  'browser-extension-native-host-supervisor-entry',
  'daemon-entry',
  'parcel-watcher-process-entry',
  'session-scanner-service-entry',
  'computer-sidecar',
  'wsl-transcript-fs-process-entry',
  'orcad/orcad-local-serve-selection-entry',
  ...CLI_MAIN_ENTRY_NAMES
] as const

// Electron is unavailable in main-process worker threads too (verified Electron 43); scan their graphs rather than trusting entry comments.
const WORKER_THREAD_ENTRY_NAMES = [
  'stt-worker',
  'warp-theme-parser-worker',
  'foreign-sqlite-reader-entry',
  'main-thread-hang-watchdog-entry',
  'port-scan-command-worker-entry',
  'command-path-directory-worker-entry',
  'worker-thread-child-process-entry',
  ...(['usage-scan', 'workspace-space-scan'] as const).map((n) => `${n}-worker-entry` as const),
  'claude-profile-setup-worker-entry',
  ...(['backup', 'writer'] as const).map((kind) => `profile-state-${kind}-worker-entry` as const)
] as const

export const GUARDED_ENTRY_NAMES = [
  ...PLAIN_NODE_ENTRY_NAMES,
  ...WORKER_THREAD_ENTRY_NAMES
] as const

type EntryRuntime = 'plain-Node process' | 'worker thread'

// Subpaths (electron/main) are as unloadable as the bare module under plain Node.
const ELECTRON_REQUIRE_RE = /require\(\s*["'`]electron(?:\/[^"'`]+)?["'`]\s*\)/

// Pin guarded names to Rollup inputs or renames silently remove entries from the guard.
function assertEntryNamesAreRollupInputs(input: NormalizedInputOptions['input']): void {
  if (typeof input === 'string' || Array.isArray(input)) {
    return
  }
  const inputNames = new Set(Object.keys(input))
  const missing = GUARDED_ENTRY_NAMES.filter((name) => !inputNames.has(name))
  if (missing.length > 0) {
    throw new Error(
      `[plain-node-entry-guard] guarded ${missing.map((name) => `"${name}"`).join(', ')} ` +
        `${missing.length === 1 ? 'is not a rollup input' : 'are not rollup inputs'} anymore. ` +
        `Update PLAIN_NODE_ENTRY_NAMES/WORKER_THREAD_ENTRY_NAMES in plain-node-entry-guard.ts to ` +
        `the current entry names — a stale name silently stops guarding that entry.`
    )
  }
}

function collectReachableChunks(
  entry: OutputChunk,
  byFileName: Map<string, OutputChunk>
): OutputChunk[] {
  const seen = new Set<string>()
  const reachable: OutputChunk[] = []
  const stack = [entry.fileName]
  while (stack.length > 0) {
    const fileName = stack.pop() as string
    if (seen.has(fileName)) {
      continue
    }
    seen.add(fileName)
    const chunk = byFileName.get(fileName)
    if (!chunk) {
      continue
    }
    reachable.push(chunk)
    for (const imported of [...chunk.imports, ...chunk.dynamicImports]) {
      stack.push(imported)
    }
  }
  return reachable
}

function assertNoElectronRequire(
  entryName: string,
  entry: OutputChunk,
  byFileName: Map<string, OutputChunk>,
  electronFreeChunkCode: Map<OutputChunk, string>,
  runtime: EntryRuntime = 'plain-Node process'
): void {
  for (const chunk of collectReachableChunks(entry, byFileName)) {
    const code = chunk.code
    if (electronFreeChunkCode.get(chunk) === code) {
      continue
    }
    if (ELECTRON_REQUIRE_RE.test(code)) {
      throw new Error(
        `[plain-node-entry-guard] "${entryName}" reaches chunk "${chunk.fileName}" that ` +
          `requires electron. "${entryName}" runs as a ${runtime}, where ` +
          `require("electron") throws MODULE_NOT_FOUND and kills it at startup (the ` +
          `v1.4.129-rc.1 daemon outage). Keep electron imports out of its module graph.`
      )
    }
    electronFreeChunkCode.set(chunk, code)
  }
}

// Relocated Windows daemon copies only these packages; other bare requires cause silent fallback to an unrelocated daemon that updates kill.
const DAEMON_HOST_MIRRORED_PACKAGES = [
  '@orca/process-host',
  'node-pty',
  '@vscode/windows-process-tree'
]
const BARE_REQUIRE_RE = /require\(\s*["'`]([^"'`./][^"'`]*)["'`]\s*\)/g

function packageOfSpecifier(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

function assertDaemonExternalsAreMirrored(
  entry: OutputChunk,
  byFileName: Map<string, OutputChunk>
): void {
  for (const chunk of collectReachableChunks(entry, byFileName)) {
    for (const match of chunk.code.matchAll(BARE_REQUIRE_RE)) {
      const specifier = match[1]!
      if (specifier.startsWith('node:') || isBuiltin(specifier)) {
        continue
      }
      if (!DAEMON_HOST_MIRRORED_PACKAGES.includes(packageOfSpecifier(specifier))) {
        throw new Error(
          `[plain-node-entry-guard] "daemon-entry" reaches chunk "${chunk.fileName}" that ` +
            `requires "${specifier}", which the relocated Windows daemon-host does not mirror ` +
            `(daemon-host-manifest.ts). Keep it out of the daemon graph, or mirror it there.`
        )
      }
    }
  }
}

export type { SmokeTimings } from './plain-node-entry-guard-smoke'

export function createPlainNodeEntryGuardPlugin(
  smokeTimings: SmokeTimings = DEFAULT_SMOKE_TIMINGS
): Plugin {
  let daemonOutputDir: string | undefined

  return {
    name: 'orca-plain-node-entry-guard',
    buildStart(options: NormalizedInputOptions) {
      assertEntryNamesAreRollupInputs(options.input)
    },
    writeBundle(options: NormalizedOutputOptions, bundle: OutputBundle) {
      // Skip dev-watch smoke or every rebuild respawns daemon-entry; gate produced builds only.
      if (this.meta.watchMode) {
        return
      }
      const chunks = Object.values(bundle).filter(
        (item): item is OutputChunk => item.type === 'chunk'
      )
      const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const entryByName = new Map(
        chunks.filter((chunk) => chunk.isEntry && chunk.name).map((chunk) => [chunk.name, chunk])
      )

      const electronFreeChunkCode = new Map<OutputChunk, string>()
      for (const entryName of PLAIN_NODE_ENTRY_NAMES) {
        const entry = entryByName.get(entryName)
        if (entry) {
          assertNoElectronRequire(
            entryName,
            entry,
            byFileName,
            electronFreeChunkCode,
            'plain-Node process'
          )
        }
      }

      for (const entryName of WORKER_THREAD_ENTRY_NAMES) {
        const entry = entryByName.get(entryName)
        if (entry) {
          assertNoElectronRequire(
            entryName,
            entry,
            byFileName,
            electronFreeChunkCode,
            'worker thread'
          )
        }
      }

      const daemonEntry = entryByName.get('daemon-entry')
      if (daemonEntry) {
        assertDaemonExternalsAreMirrored(daemonEntry, byFileName)
        daemonOutputDir = options.dir ?? daemonOutputDir
      }
    },
    async closeBundle() {
      if (daemonOutputDir) {
        const outputDir = daemonOutputDir
        daemonOutputDir = undefined
        await smokeLoadDaemonEntry(outputDir, smokeTimings)
      }
    }
  }
}
