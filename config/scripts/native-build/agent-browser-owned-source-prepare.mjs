import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import {
  fail,
  isWithin,
  patchPath,
  resolveInputDirectory,
  manifest,
  verifyPatchArtifact,
  verifyReference,
  verifyTreePins,
  createSourceInputSnapshot,
  assertSourceInputSnapshotUnchanged
} from './agent-browser-owned-source-integrity.mjs'
import { assertPinnedTreeIdentity } from './agent-browser-owned-source-tree-snapshot.mjs'
import {
  assertDirectoryChainUnchanged,
  assertSafeDirectoryPath,
  assertExecutableIdentityUnchanged,
  captureExecutableIdentity,
  resolveSystemExecutable,
  writeToolWrappers
} from './agent-browser-owned-process.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

function sourceCommandEnvironment(workspace, git, tar, shell) {
  const home = join(workspace, 'prepare-home')
  const temp = join(workspace, 'prepare-tmp')
  const config = join(home, '.gitconfig')
  const bin = join(workspace, 'prepare-bin')
  for (const directory of [home, temp, join(home, '.config'), bin]) {
    mkdirSync(directory, { mode: 0o700 })
  }
  writeFileSync(config, '', { mode: 0o600 })
  writeToolWrappers(bin, { git, tar }, shell)
  return {
    env: {
      HOME: home,
      USERPROFILE: home,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_CONFIG_HOME: join(home, '.config'),
      PATH: bin,
      LANG: 'C',
      LC_ALL: 'C',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: config,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0'
    }
  }
}

function createWorkspace(parentPath, reference, cachePaths) {
  const parent = resolveInputDirectory(
    parentPath || (process.platform === 'linux' ? '/tmp' : tmpdir()),
    'Workspace parent'
  )
  const parentBoundary = assertSafeWorkspaceParent(parent)
  let home
  try {
    home = realpathSync(userInfo().homedir)
  } catch {
    home = undefined
  }
  const sharedCaches = home
    ? [
        join(home, '.cargo'),
        join(home, '.rustup'),
        join(home, '.cache'),
        join(home, '.local/share/pnpm')
      ]
    : []
  if (
    isWithin(reference, parent) ||
    isWithin(repositoryRoot, parent) ||
    cachePaths.some((cache) => isWithin(cache, parent)) ||
    sharedCaches.some((cache) => isWithin(cache, parent))
  ) {
    fail('Workspace parent must be outside source checkouts and shared caches.')
  }
  assertDirectoryChainUnchanged(parentBoundary, 'Workspace parent')
  const workspace = mkdtempSync(join(parent, 'ash-agent-browser-owned-'))
  chmodSync(workspace, 0o700)
  return { path: workspace, boundary: captureWorkspaceBoundary(workspace) }
}

export function assertSafeWorkspaceParent(parentPath) {
  return assertSafeDirectoryPath(resolve(parentPath), 'Workspace parent')
}

export function captureWorkspaceBoundary(workspacePath) {
  const workspace = resolveInputDirectory(workspacePath, 'Private workspace')
  const boundary = assertSafeDirectoryPath(workspace, 'Private workspace')
  const identity = boundary.directories.at(-1)
  if (identity.uid !== userInfo().uid || (identity.mode & 0o077) !== 0) {
    fail('Private workspace must be owned by the current user and exclude group and other users.')
  }
  return boundary
}

export function assertWorkspaceBoundary(boundary) {
  const current = assertDirectoryChainUnchanged(boundary, 'Private workspace')
  const identity = current.directories.at(-1)
  if (identity.uid !== userInfo().uid || (identity.mode & 0o077) !== 0) {
    fail(`Private workspace boundary changed after validation: ${boundary.path}`)
  }
  return current
}

function gitArguments(args) {
  return [
    '--no-replace-objects',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.hooksPath=/dev/null',
    ...args
  ]
}

function waitForChild(child, label, readError) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`${label} failed: ${readError().trim()}`))
      }
    })
  })
}

async function extractArchive(reference, sourceDirectory, tools, env) {
  mkdirSync(sourceDirectory, { mode: 0o700 })
  const archive = spawn(
    tools.git,
    gitArguments(['-C', reference, 'archive', '--format=tar', manifest.source.commit]),
    { cwd: reference, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false }
  )
  const extract = spawn(
    tools.tar,
    [
      '--extract',
      '--file=-',
      `--directory=${sourceDirectory}`,
      '--no-same-owner',
      '--no-same-permissions',
      '--no-overwrite-dir',
      '--delay-directory-restore'
    ],
    { cwd: sourceDirectory, env, stdio: ['pipe', 'ignore', 'pipe'], shell: false }
  )
  let archiveError = ''
  let extractError = ''
  const capture = (target, chunk) => {
    if (target.length < 65536) {
      return target + chunk.toString('utf8').slice(0, 65536 - target.length)
    }
    return target
  }
  archive.stderr.on('data', (chunk) => {
    archiveError = capture(archiveError, chunk)
  })
  extract.stderr.on('data', (chunk) => {
    extractError = capture(extractError, chunk)
  })
  archive.stdout.pipe(extract.stdin)
  await Promise.all([
    waitForChild(archive, 'git archive', () => archiveError),
    waitForChild(extract, 'tar extraction', () => extractError)
  ])
}

export async function prepareSource({ referencePath, workspaceParent, cachePaths = [] }) {
  const git = resolveSystemExecutable('git')
  const tar = resolveSystemExecutable('tar')
  const shell = resolveSystemExecutable('sh')
  const preparationTools = [git, tar, shell].map((path) => captureExecutableIdentity(path))
  const assertPreparationToolsUnchanged = () => {
    for (const identity of preparationTools) {
      assertExecutableIdentityUnchanged(identity)
    }
  }
  const reference = resolveInputDirectory(referencePath, 'Upstream reference')
  const workspaceRecord = createWorkspace(workspaceParent, reference, cachePaths)
  const { path: workspace, boundary: workspaceBoundary } = workspaceRecord
  const { env } = sourceCommandEnvironment(workspace, git, tar, shell)
  assertWorkspaceBoundary(workspaceBoundary)
  assertPreparationToolsUnchanged()
  const runGit = (cwd, args) => {
    assertWorkspaceBoundary(workspaceBoundary)
    assertPreparationToolsUnchanged()
    let result
    try {
      result = spawnSync(git, gitArguments(args), {
        cwd,
        env,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        shell: false,
        stdio: 'pipe'
      })
    } finally {
      assertPreparationToolsUnchanged()
    }
    assertWorkspaceBoundary(workspaceBoundary)
    if (result.error) {
      fail(`git could not start: ${result.error.message}`)
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      fail(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
    }
    return result.stdout.trim()
  }

  try {
    verifyReference(reference, runGit)
    const sourceDirectory = join(workspace, 'source')
    assertWorkspaceBoundary(workspaceBoundary)
    assertPreparationToolsUnchanged()
    try {
      await extractArchive(reference, sourceDirectory, { git, tar }, env)
    } finally {
      assertPreparationToolsUnchanged()
      assertWorkspaceBoundary(workspaceBoundary)
    }
    assertPinnedTreeIdentity(
      sourceDirectory,
      manifest.source.pristineTree,
      'Pristine source archive'
    )
    verifyPatchArtifact()
    runGit(sourceDirectory, ['apply', '--check', '--whitespace=error', patchPath])
    runGit(sourceDirectory, ['apply', '--whitespace=error', patchPath])
    assertPinnedTreeIdentity(sourceDirectory, manifest.source.patchedTree, 'Patched source tree')
    verifyTreePins(sourceDirectory)
    const sourceInputSnapshot = createSourceInputSnapshot(sourceDirectory)
    assertSourceInputSnapshotUnchanged(sourceDirectory, sourceInputSnapshot)
    assertWorkspaceBoundary(workspaceBoundary)
    assertPreparationToolsUnchanged()
    return {
      reference,
      workspace,
      sourceDirectory,
      workspaceBoundary,
      sourceInputSnapshot
    }
  } catch (error) {
    error.message += `\nPrivate source workspace retained at ${workspace}`
    throw error
  }
}

export { createWorkspace }
