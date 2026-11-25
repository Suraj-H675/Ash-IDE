import { lstatSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveExecutableFile, resolveSystemExecutable } from './agent-browser-owned-process.mjs'
import { requiredOption } from './agent-browser-owned-source-options.mjs'
import { fail } from './agent-browser-owned-source-files.mjs'
import {
  assertExecutableIdentityUnchanged,
  captureExecutableIdentity,
  runChecked
} from './agent-browser-owned-process.mjs'
import { manifest } from './agent-browser-owned-source-manifest.mjs'

const target = manifest.inputs.cargoBuild.target

export function assertSupportedTarget(target) {
  if (target !== manifest.inputs.cargoBuild.target) {
    fail(`Unsupported target ${target}. Only ${manifest.inputs.cargoBuild.target} is prepared.`)
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    fail('Private builds require an x86_64 Linux host.')
  }
  return target
}

export function resolveBuildTools(options) {
  const rustc = resolveExecutableFile(requiredOption(options, '--rustc-executable'), 'rustc')
  const cargo = resolveExecutableFile(requiredOption(options, '--cargo-executable'), 'cargo')
  const rustdoc = resolveExecutableFile(requiredOption(options, '--rustdoc-executable'), 'rustdoc')
  return {
    node: resolveExecutableFile(process.execPath, 'Node', { requireCanonical: false }),
    pnpm: resolveExecutableFile(requiredOption(options, '--pnpm-executable'), 'pnpm'),
    cargo,
    rustc,
    rustdoc,
    git: resolveSystemExecutable('git'),
    tar: resolveSystemExecutable('tar'),
    cc: resolveSystemExecutable('cc'),
    cxx: resolveSystemExecutable('c++'),
    linker: resolveSystemExecutable('ld'),
    ar: resolveSystemExecutable('ar'),
    pkgConfig: resolveSystemExecutable('pkg-config'),
    sh: resolveSystemExecutable('sh'),
    env: resolveSystemExecutable('env'),
    optional: Object.fromEntries(
      [
        'bash',
        'make',
        'cmake',
        'ninja',
        'python3',
        'gcc',
        'g++',
        'clang',
        'clang++',
        'perl',
        'sed',
        'dirname',
        'uname',
        'as'
      ].map((name) => [name, resolveSystemExecutable(name, { required: false })])
    )
  }
}

export function captureToolchainIdentities(tools) {
  const identities = {}
  for (const [name, executable] of Object.entries(tools)) {
    if (name === 'optional') {
      continue
    }
    // Normalize caller-facing option names to the actual wrapper names.
    const toolName = name === 'linker' ? 'ld' : name === 'pkgConfig' ? 'pkg-config' : name
    identities[toolName] = captureExecutableIdentity(executable, `${toolName} tool`)
  }
  for (const [name, executable] of Object.entries(tools.optional ?? {})) {
    if (executable) {
      identities[name] = captureExecutableIdentity(executable, `${name} tool`)
    }
  }
  return identities
}

export function assertToolchainIdentitiesUnchanged(identities) {
  for (const identity of Object.values(identities)) {
    assertExecutableIdentityUnchanged(identity)
  }
  return identities
}

function parseVerboseIdentity(name, output) {
  const version = output.match(new RegExp(`^${name}\\s+(\\S+)`, 'm'))?.[1]
  const fields = Object.fromEntries(
    [...output.matchAll(/^([a-zA-Z][a-zA-Z-]*):\s*(.*)$/gm)].map((match) => [match[1], match[2]])
  )
  if (!version || !fields.release || !fields.host) {
    fail(`${name} did not report a complete toolchain identity.`)
  }
  return {
    version,
    release: fields.release,
    commitHash: fields['commit-hash'] ?? 'unknown',
    host: fields.host
  }
}

export function assertToolchainIdentity(actual, expected) {
  const nodeMajor = Number(actual.nodeVersion.replace(/^v/, '').split('.')[0])
  if (nodeMajor !== expected.nodeMajor) {
    fail(`Node ${expected.nodeMajor} is required for the dashboard build.`)
  }
  if (actual.rustc.version !== expected.rustcVersion) {
    fail(
      `rustc version mismatch. Expected ${expected.rustcVersion}, found ${actual.rustc.version}.`
    )
  }
  if (actual.cargo.version !== expected.cargoVersion) {
    fail(
      `cargo version mismatch. Expected ${expected.cargoVersion}, found ${actual.cargo.version}.`
    )
  }
  if (actual.pnpmVersion !== expected.pnpmVersion) {
    fail(`pnpm version mismatch. Expected ${expected.pnpmVersion}, found ${actual.pnpmVersion}.`)
  }
  if (
    actual.rustc.host !== expected.target ||
    actual.cargo.host !== expected.target ||
    actual.rustdoc.host !== expected.target ||
    actual.rustdoc.version !== expected.rustcVersion ||
    actual.rustc.release !== expected.rustcVersion ||
    actual.cargo.release !== expected.cargoVersion ||
    actual.rustdoc.release !== expected.rustcVersion
  ) {
    fail('Rust tools do not match the pinned Linux target and compiler version.')
  }
}

export function verifyToolchain(options, environment) {
  const executableIdentities = captureToolchainIdentities(environment.tools)
  const rustcOutput = runChecked(environment.tools.rustc, ['--version', '--verbose'], {
    cwd: options.cwd,
    env: environment.env,
    timeout: 30000
  })
  const cargoOutput = runChecked(environment.tools.cargo, ['--version', '--verbose'], {
    cwd: options.cwd,
    env: environment.env,
    timeout: 30000
  })
  const rustdocOutput = runChecked(environment.tools.rustdoc, ['--version', '--verbose'], {
    cwd: options.cwd,
    env: environment.env,
    timeout: 30000
  })
  const pnpmVersion = runChecked(environment.tools.pnpm, ['--version'], {
    cwd: options.cwd,
    env: environment.env,
    timeout: 30000
  })
  const nativeTools = {}
  for (const [name, executable] of [
    ['cc', environment.tools.cc],
    ['cxx', environment.tools.cxx],
    ['linker', environment.tools.ld],
    ['ar', environment.tools.ar],
    ['pkg-config', environment.tools['pkg-config']]
  ]) {
    const output = runChecked(executable, ['--version'], {
      cwd: options.cwd,
      env: environment.env,
      timeout: 30000
    })
    nativeTools[name] = {
      version: output.split(/\r?\n/, 1)[0],
      executable,
      executableSha256: executableIdentities[name === 'linker' ? 'ld' : name].sha256
    }
  }
  for (const [name, executable] of Object.entries(environment.tools.optional ?? {})) {
    nativeTools[name] = {
      executable,
      executableSha256: executableIdentities[name].sha256
    }
  }
  for (const name of ['git', 'tar', 'sh', 'env']) {
    const executable = environment.tools[name]
    nativeTools[name] = {
      executable,
      executableSha256: executableIdentities[name].sha256
    }
  }
  const rustc = parseVerboseIdentity('rustc', rustcOutput)
  const cargo = parseVerboseIdentity('cargo', cargoOutput)
  const rustdoc = parseVerboseIdentity('rustdoc', rustdocOutput)
  if (
    dirname(environment.tools.rustc) !== dirname(environment.tools.cargo) ||
    dirname(environment.tools.rustc) !== dirname(environment.tools.rustdoc)
  ) {
    fail('rustc, cargo, and rustdoc must come from the same toolchain directory.')
  }
  assertToolchainIdentity(
    {
      nodeVersion: process.version,
      pnpmVersion,
      rustc,
      cargo,
      rustdoc
    },
    {
      nodeMajor: manifest.inputs.nodeMajor,
      rustcVersion: options.rustcVersion,
      cargoVersion: options.cargoVersion,
      pnpmVersion: manifest.inputs.pnpmVersion,
      target
    }
  )
  const targetLibdir = runChecked(
    environment.tools.rustc,
    ['--print', 'target-libdir', '--target', target],
    { cwd: options.cwd, env: environment.env, timeout: 30000 }
  )
  let targetDirectoryStat
  try {
    targetDirectoryStat = lstatSync(targetLibdir)
  } catch {
    fail(`Rust target libraries are missing for ${target}.`)
  }
  if (targetDirectoryStat.isSymbolicLink() || !targetDirectoryStat.isDirectory()) {
    fail(`Rust target libraries are missing for ${target}.`)
  }
  assertToolchainIdentitiesUnchanged(executableIdentities)
  const withExecutable = (identity, name) => ({
    ...identity,
    executable: environment.tools[name],
    executableSha256: executableIdentities[name].sha256
  })
  return {
    executableIdentities,
    node: {
      version: process.version,
      executable: environment.tools.node,
      executableSha256: executableIdentities.node.sha256
    },
    pnpm: {
      version: pnpmVersion,
      executable: environment.tools.pnpm,
      executableSha256: executableIdentities.pnpm.sha256
    },
    rustc: withExecutable(rustc, 'rustc'),
    cargo: withExecutable(cargo, 'cargo'),
    rustdoc: withExecutable(rustdoc, 'rustdoc'),
    nativeTools
  }
}
