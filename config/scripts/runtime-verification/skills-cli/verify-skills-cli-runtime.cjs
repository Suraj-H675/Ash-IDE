const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} = require('node:fs')
const { builtinModules, createRequire, isBuiltin } = require('node:module')
const { tmpdir } = require('node:os')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { spawnSync } = require('node:child_process')
const ts = require('typescript-api')

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const CLI_COMMAND_TIMEOUT_MS = 30_000

function artifactPath(outDir, file) {
  return relative(outDir, file).split(sep).join('/')
}

function runtimeImportSpecifiers(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS
  )
  const specifiers = []

  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [argument] = node.arguments
      const expression = node.expression
      const isRequire = ts.isIdentifier(expression) && expression.text === 'require'
      const isRequireResolve =
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'require' &&
        expression.name.text === 'resolve'
      const isDynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword

      if ((isRequire || isRequireResolve || isDynamicImport) && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function isOutsideRoot(root, target) {
  const pathFromRoot = relative(root, target)
  return isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)
}

function isOptionalPackageImport(artifactRoot, importer, specifier) {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    return false
  }
  const packageName = bareSpecifierPackage(specifier)
  let directory = dirname(importer)

  while (!isOutsideRoot(artifactRoot, directory)) {
    const packageJson = join(directory, 'package.json')
    if (existsSync(packageJson)) {
      try {
        const manifest = JSON.parse(readFileSync(packageJson, 'utf8'))
        return (
          Object.hasOwn(manifest.optionalDependencies ?? {}, packageName) ||
          manifest.peerDependenciesMeta?.[packageName]?.optional === true
        )
      } catch {
        return false
      }
    }
    if (directory === artifactRoot) {
      break
    }
    directory = dirname(directory)
  }
  return false
}

function bareSpecifierPackage(specifier) {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

// Accept external realpath only via actual in-root node_modules link: global pnpm store lives outside artifact while dependency remains shipped.
function linkedPathInsideRoot(artifactRoot, importer, specifier, resolved) {
  const isBare = !specifier.startsWith('.') && !isAbsolute(specifier)
  let directory = dirname(importer)
  while (!isOutsideRoot(artifactRoot, directory)) {
    // Bare import crosses node_modules link; relative import crosses linked package directory.
    const candidates = isBare
      ? [join(directory, 'node_modules', bareSpecifierPackage(specifier)), directory]
      : [directory]
    for (const candidate of candidates) {
      if (!existsSync(candidate)) {
        continue
      }
      const physical = realpathSync(candidate)
      if (physical !== candidate && !isOutsideRoot(physical, resolved)) {
        return join(candidate, relative(physical, resolved))
      }
    }
    if (directory === artifactRoot) {
      break
    }
    directory = dirname(directory)
  }
  return null
}

function resolveRuntimeImport(outDir, artifactRoot, importer, specifier) {
  if (BUILTINS.has(specifier) || isBuiltin(specifier)) {
    return null
  }
  let resolved
  try {
    // Why physical: Node resolves from the realpath, so a store-linked importer must not see the artifact's own node_modules.
    resolved = createRequire(realpathSync(importer)).resolve(specifier)
  } catch (error) {
    if (isOptionalPackageImport(artifactRoot, importer, specifier)) {
      return null
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[verify-skills-cli-runtime] missing runtime import "${specifier}" from ` +
        `${artifactPath(outDir, importer)}: ${detail}`
    )
  }
  if (isOutsideRoot(artifactRoot, resolved)) {
    const linked = linkedPathInsideRoot(artifactRoot, importer, specifier, resolved)
    if (linked !== null) {
      return linked
    }
    throw new Error(
      `[verify-skills-cli-runtime] import "${specifier}" from ` +
        `${artifactPath(outDir, importer)} resolved outside ${artifactRoot}: ${resolved}`
    )
  }
  return resolved
}

function collectRuntimeClosure(outDir, artifactRoot = dirname(outDir)) {
  outDir = realpathSync(outDir)
  artifactRoot = realpathSync(artifactRoot)
  if (isOutsideRoot(artifactRoot, outDir)) {
    throw new Error(`[verify-skills-cli-runtime] ${outDir} is outside ${artifactRoot}`)
  }
  const entry = resolve(outDir, 'cli', 'index.js')
  if (!existsSync(entry)) {
    throw new Error(`[verify-skills-cli-runtime] missing entry ${entry}`)
  }
  const pending = [entry]
  const visited = new Set()

  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) {
      continue
    }
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const specifier of runtimeImportSpecifiers(source, file)) {
      const resolved = resolveRuntimeImport(outDir, artifactRoot, file, specifier)
      if (resolved && !isOutsideRoot(artifactRoot, resolved) && /\.(?:c|m)?js$/.test(resolved)) {
        pending.push(resolved)
      }
    }
  }

  return [...visited].sort()
}

function runCli(outDir, args, timeoutMs = CLI_COMMAND_TIMEOUT_MS) {
  const entry = resolve(outDir, 'cli', 'index.js')
  // A package preflight must never attach to a running user profile or provider session.
  const probeRoot = mkdtempSync(join(tmpdir(), 'ash-packaged-cli-smoke-'))
  const profile = join(probeRoot, 'ash-profile')
  const runtimeDirectory = join(probeRoot, 'runtime')
  mkdirSync(runtimeDirectory, { mode: 0o700 })
  const env = {
    ...process.env,
    NODE_PATH: '',
    HOME: probeRoot,
    USERPROFILE: probeRoot,
    XDG_CONFIG_HOME: join(probeRoot, '.config'),
    XDG_CACHE_HOME: join(probeRoot, '.cache'),
    XDG_DATA_HOME: join(probeRoot, '.local', 'share'),
    XDG_RUNTIME_DIR: runtimeDirectory,
    ASH_USER_DATA_PATH: profile,
    ASH_DEV_USER_DATA_PATH: profile,
    ORCA_USER_DATA_PATH: profile
  }
  for (const key of ['ORCA_CLI_CWD', 'ASH_APP_EXECUTABLE', 'ORCA_APP_EXECUTABLE']) {
    delete env[key]
  }
  let result
  try {
    result = spawnSync(process.execPath, [entry, ...args], {
      cwd: dirname(outDir),
      encoding: 'utf8',
      env,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs
    })
  } finally {
    rmSync(probeRoot, { recursive: true, force: true })
  }
  if (result.error || result.signal || result.status !== 0) {
    const detail = [
      result.error?.message,
      result.signal ? `terminated by ${result.signal}` : null,
      result.stdout,
      result.stderr
    ]
      .filter(Boolean)
      .join('\n')
    throw new Error(
      `[verify-skills-cli-runtime] ${args.join(' ')} exited ${String(result.status)}\n${detail}`
    )
  }
  return result.stdout
}

function parseJson(label, output) {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`[verify-skills-cli-runtime] ${label} emitted invalid JSON:\n${output}`)
  }
}

// Keep the legacy hook export name until all builder callsites move; the contract
// exercises Ash's standalone local terminal/runtime CLI, never Orca Cloud skills.
function verifySkillsCliRuntime(outDir, artifactRoot = dirname(outDir), options = {}) {
  const absoluteOutDir = resolve(outDir)
  const closure = collectRuntimeClosure(absoluteOutDir, resolve(artifactRoot))
  if (options.executeCommands === false) {
    return { closureFiles: closure.length, commands: 0 }
  }
  const help = runCli(absoluteOutDir, ['--help'])
  if (
    !help.includes('Ash IDE') ||
    !help.includes('terminal create') ||
    !help.includes('terminal-daemon status') ||
    !help.includes('runtime stop')
  ) {
    throw new Error(
      '[verify-skills-cli-runtime] packaged Ash local terminal/runtime help is incomplete'
    )
  }

  const context = parseJson(
    'agent-context --json',
    runCli(absoluteOutDir, ['agent-context', '--json'])
  )
  const commands = new Set(context.commands?.map((entry) => entry.command))
  if (
    context.schemaVersion !== 1 ||
    context.commandCount !== context.commands?.length ||
    !commands.has('terminal create') ||
    !commands.has('terminal-daemon status') ||
    !commands.has('runtime stop')
  ) {
    throw new Error(
      '[verify-skills-cli-runtime] packaged Ash local agent command schema is invalid'
    )
  }

  const status = parseJson('status --json', runCli(absoluteOutDir, ['status', '--json']))
  if (status.ok !== true || status.result?.target?.kind !== 'local') {
    throw new Error(
      '[verify-skills-cli-runtime] packaged Ash CLI did not report local runtime status'
    )
  }

  return { closureFiles: closure.length, commands: 3 }
}

if (require.main === module) {
  try {
    const result = verifySkillsCliRuntime(process.argv[2] ?? 'out')
    console.log(
      `[verify-skills-cli-runtime] ${result.closureFiles} closure files and ` +
        `${result.commands} commands passed`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

module.exports = { collectRuntimeClosure, runCli, verifySkillsCliRuntime }
