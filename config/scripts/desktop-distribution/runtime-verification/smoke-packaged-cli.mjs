import { cp, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'

const execFileAsync = promisify(execFile)

function readAppDirArg(argv) {
  const explicit = argv.find((arg) => arg.startsWith('--app-dir='))
  if (explicit) {
    return explicit.slice('--app-dir='.length)
  }
  if (process.platform === 'darwin') {
    return 'dist/mac-arm64/Ash IDE.app'
  }
  if (process.platform === 'win32') {
    return 'dist/win-unpacked'
  }
  return 'dist/linux-unpacked'
}

function getPackagedCliPath(appDir) {
  if (process.platform === 'darwin' || appDir.endsWith('.app')) {
    return join(appDir, 'Contents', 'Resources', 'bin', 'ash-ide')
  }
  if (process.platform === 'win32') {
    return join(appDir, 'resources', 'bin', 'ash-ide.exe')
  }
  return join(appDir, 'resources', 'bin', 'ash-ide')
}

const appDir = resolve(readAppDirArg(process.argv.slice(2)))
const tempRoot = await mkdtemp(join(tmpdir(), 'ash-packaged-cli-smoke-'))
const copiedAppDir = join(tempRoot, basename(appDir))

let smokeFailure = null
try {
  await cp(appDir, copiedAppDir, { recursive: true, verbatimSymlinks: true })
  const cliPath = getPackagedCliPath(copiedAppDir)
  const env = { ...process.env, NODE_PATH: '' }
  delete env.ORCA_CLI_CWD
  const run = (args) =>
    execFileAsync(cliPath, args, {
      env,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000
    })

  await run(['--help'])
  assert.match((await run(['--version'])).stdout, /^\d+\.\d+\.\d+/)
  assert.match((await run(['runtime', 'stop', '--help'])).stdout, /ash-ide runtime stop/)
  assert.match(
    (await run(['terminal-daemon', 'stop', '--help'])).stdout,
    /terminal-daemon stop.*--yes/s
  )
  console.log(`[packaged-cli-smoke] Ash version and guarded runtime commands passed via ${cliPath}`)
} catch (error) {
  smokeFailure = error
}

// Retry Windows cleanup locks from just-exited Ash IDE/crashpad descendants; persistent lock still throws unless it would mask smoke’s original failure.
const cleanupFailure = await rm(tempRoot, {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 250
}).then(
  () => null,
  (error) => error
)

if (smokeFailure) {
  if (cleanupFailure) {
    console.warn(`[packaged-cli-smoke] temp cleanup failed: ${cleanupFailure.message}`)
  }
  throw smokeFailure
}
if (cleanupFailure) {
  throw cleanupFailure
}
