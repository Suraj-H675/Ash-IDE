import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { buildEnvironment, copyBuildCaches } from './agent-browser-owned-build-environment.mjs'
import { copyCacheTree } from './agent-browser-owned-cache-copy.mjs'
import { resolveExecutableFile, runChecked } from './agent-browser-owned-process.mjs'
import {
  resolveInputDirectory,
  resolveTreeFile,
  sha256Tree
} from './agent-browser-owned-source-files.mjs'

function withTempDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-browser-environment-test-'))
  try {
    return callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function makeExecutable(directory, name) {
  const executable = join(directory, name)
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  chmodSync(executable, 0o700)
  return executable
}

function makeTools(root) {
  const directory = join(root, 'tools')
  mkdirSync(directory)
  return {
    node: makeExecutable(directory, 'node'),
    pnpm: makeExecutable(directory, 'pnpm'),
    cargo: makeExecutable(directory, 'cargo'),
    rustc: makeExecutable(directory, 'rustc'),
    rustdoc: makeExecutable(directory, 'rustdoc'),
    cc: makeExecutable(directory, 'cc'),
    cxx: makeExecutable(directory, 'cxx'),
    linker: makeExecutable(directory, 'ld'),
    ar: makeExecutable(directory, 'ar'),
    pkgConfig: makeExecutable(directory, 'pkg-config'),
    git: makeExecutable(directory, 'git'),
    tar: makeExecutable(directory, 'tar'),
    sh: makeExecutable(directory, 'sh'),
    env: makeExecutable(directory, 'env'),
    optional: {}
  }
}

function makeCache(directory, fileName, contents) {
  const file = join(directory, fileName)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
  return file
}

test('cache copy remaps only relative links whose targets remain inside the cache', () => {
  withTempDirectory((root) => {
    const source = join(root, 'store')
    const destination = join(root, 'private-store')
    const target = makeCache(source, 'files/pkg/index.js', 'package bytes')
    const linkDirectory = join(source, 'projects/hash/node_modules')
    mkdirSync(linkDirectory, { recursive: true })
    const link = join(linkDirectory, 'pkg.js')
    const linkTarget = relative(linkDirectory, target)
    symlinkSync(linkTarget, link)

    copyCacheTree(source, destination, 'fixture pnpm store')

    const privateLink = join(destination, 'projects/hash/node_modules/pkg.js')
    assert.equal(readlinkSync(privateLink), linkTarget)
    assert.equal(readFileSync(privateLink, 'utf8'), 'package bytes')
    assert.equal(realpathSync(privateLink), join(destination, 'files/pkg/index.js'))
  })
})

test('cache copy rejects links to shared paths and leaves the shared source unchanged', () => {
  withTempDirectory((root) => {
    const source = join(root, 'store')
    const destination = join(root, 'private-store')
    const outside = join(root, 'shared')
    mkdirSync(source)
    mkdirSync(outside)
    const sentinel = join(outside, 'sentinel')
    writeFileSync(sentinel, 'shared state')
    const link = join(source, 'link')
    symlinkSync(sentinel, link)
    const sentinelBefore = readFileSync(sentinel)
    const linkBefore = readlinkSync(link)

    assert.throws(() => copyCacheTree(source, destination, 'fixture pnpm store'), /symlink/)
    assert.deepEqual(readFileSync(sentinel), sentinelBefore)
    assert.equal(readlinkSync(link), linkBefore)
  })
})

test('cache copy rejects absolute links and links to directories', () => {
  withTempDirectory((root) => {
    const source = join(root, 'store')
    const destination = join(root, 'private-store')
    const outside = join(root, 'outside')
    mkdirSync(source)
    mkdirSync(outside)
    writeFileSync(join(outside, 'payload'), 'outside bytes')
    symlinkSync(join(outside, 'payload'), join(source, 'absolute-link'))
    assert.throws(() => copyCacheTree(source, destination, 'fixture pnpm store'), /outside/)
  })
  withTempDirectory((root) => {
    const source = join(root, 'store')
    const directory = join(source, 'directory')
    mkdirSync(directory, { recursive: true })
    symlinkSync(directory, join(source, 'directory-link'), 'dir')
    assert.throws(
      () => copyCacheTree(source, join(root, 'private-store'), 'fixture pnpm store'),
      /symlink/
    )
  })
})

test('cache roots, source paths and executable paths reject symlink and traversal boundaries', () => {
  withTempDirectory((root) => {
    const realDirectory = join(root, 'real-cache')
    const linkedDirectory = join(root, 'linked-cache')
    const sourceFile = makeCache(realDirectory, 'nested/payload', 'payload')
    symlinkSync(realDirectory, linkedDirectory, 'dir')
    assert.throws(() => resolveInputDirectory(linkedDirectory, 'cache'), /real directory/)
    assert.throws(
      () => resolveTreeFile(realDirectory, '../outside', 'source path'),
      /invalid relative path/
    )

    const fileLink = join(realDirectory, 'nested/link')
    symlinkSync(sourceFile, fileLink)
    assert.throws(() => resolveTreeFile(realDirectory, 'nested/link', 'source path'), /symlink/)

    const tools = join(root, 'tools')
    mkdirSync(tools)
    const executable = makeExecutable(tools, 'tool')
    assert.throws(() => resolveExecutableFile('relative/tool', 'tool'), /absolute executable path/)
    const executableLink = join(tools, 'tool-link')
    symlinkSync(executable, executableLink)
    assert.throws(() => resolveExecutableFile(executableLink, 'tool'), /canonical executable path/)
    const directoryLink = join(root, 'tools-link')
    symlinkSync(tools, directoryLink, 'dir')
    assert.throws(
      () => resolveExecutableFile(join(directoryLink, 'tool'), 'tool'),
      /must not pass through a symlink/
    )

    const sharedDirectory = join(root, 'shared-tools')
    mkdirSync(sharedDirectory, { mode: 0o700 })
    chmodSync(sharedDirectory, 0o777)
    const sharedTool = makeExecutable(sharedDirectory, 'tool')
    assert.throws(
      () => resolveExecutableFile(sharedTool, 'shared tool'),
      /writable by other users without sticky protection/
    )
  })
})

test('subprocess boundaries require an absolute executable and explicit cwd and environment', () => {
  withTempDirectory((root) => {
    assert.throws(() => runChecked('node', [], { cwd: root, env: {} }), /absolute executable path/)
    assert.throws(
      () => runChecked('/usr/bin/true', [], { cwd: root }),
      /explicit working directory and environment/
    )
  })
})

test('build environment ignores malicious inherited settings and preserves shared caches', () => {
  withTempDirectory((root) => {
    const cargoRegistry = join(root, 'cargo-registry')
    const pnpmStore = join(root, 'pnpm-store')
    makeCache(cargoRegistry, 'cache/crate.crate', 'cargo cache bytes')
    makeCache(pnpmStore, 'files/sha1/package', 'pnpm cache bytes')
    const cargoBefore = sha256Tree(cargoRegistry)
    const pnpmBefore = sha256Tree(pnpmStore)
    const workspace = mkdtempSync(join(root, 'workspace-'))
    const tools = makeTools(root)
    const inherited = {
      HOME: '/shared/credentials',
      PATH: '/attacker/bin',
      CARGO_HOME: '/shared/cargo',
      CARGO_TARGET_DIR: '/shared/target',
      CARGO_NET_OFFLINE: 'false',
      RUSTFLAGS: '-C link-arg=/attacker/linker',
      RUSTUP_HOME: '/shared/rustup',
      NODE_OPTIONS: '--require=/attacker/preload',
      npm_config_cache: '/shared/npm-cache',
      npm_config_userconfig: '/shared/npmrc',
      npm_config_offline: 'false',
      COREPACK_HOME: '/shared/corepack',
      COREPACK_ENABLE_NETWORK: '1',
      GIT_CONFIG_GLOBAL: '/shared/gitconfig',
      LD_PRELOAD: '/attacker/library.so',
      HTTP_PROXY: 'https://inherited.invalid',
      HTTPS_PROXY: 'https://inherited.invalid',
      ALL_PROXY: 'https://inherited.invalid',
      AWS_ACCESS_KEY_ID: 'credential-sentinel',
      GITHUB_TOKEN: 'credential-sentinel',
      NPM_TOKEN: 'credential-sentinel'
    }
    const previous = new Map(Object.keys(inherited).map((key) => [key, process.env[key]]))
    for (const [key, value] of Object.entries(inherited)) {
      process.env[key] = value
    }
    const processEnvironmentBefore = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    )
    try {
      const environment = buildEnvironment(workspace, tools)
      assert.equal(existsSync(environment.paths.privatePnpmStore), false)
      assert.equal(existsSync(join(environment.paths.cargoHome, 'registry')), false)
      copyBuildCaches(environment, cargoRegistry, pnpmStore)
      assert.equal(environment.env.HOME, environment.paths.home)
      assert.equal(environment.env.PATH, environment.paths.toolBin)
      assert.equal(environment.env.CARGO_HOME, environment.paths.cargoHome)
      assert.equal(environment.env.CARGO_TARGET_DIR, environment.paths.cargoTarget)
      assert.equal(environment.env.CARGO_NET_OFFLINE, 'true')
      assert.equal(environment.env.RUSTC, tools.rustc)
      assert.equal(environment.env.CARGO, tools.cargo)
      assert.equal(environment.env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER, tools.cc)
      assert.equal(environment.env.RUSTFLAGS, undefined)
      assert.equal(environment.env.RUSTUP_HOME, undefined)
      assert.equal(environment.env.NODE_OPTIONS, undefined)
      assert.equal(environment.env.LD_PRELOAD, undefined)
      assert.equal(environment.env.HTTP_PROXY, undefined)
      assert.equal(environment.env.HTTPS_PROXY, undefined)
      assert.equal(environment.env.ALL_PROXY, undefined)
      assert.equal(environment.env.AWS_ACCESS_KEY_ID, undefined)
      assert.equal(environment.env.GITHUB_TOKEN, undefined)
      assert.equal(environment.env.NPM_TOKEN, undefined)
      assert.equal(environment.env.COREPACK_ENABLE_NETWORK, '0')
      assert.equal(environment.env.npm_config_offline, 'true')
      assert.equal(environment.env.npm_config_cache, environment.paths.npmCache)
      assert.equal(environment.env.npm_config_userconfig, join(environment.paths.home, '.npmrc'))
      assert.equal(environment.env.GIT_CONFIG_GLOBAL, join(environment.paths.home, '.gitconfig'))
      assert.equal(
        readFileSync(join(environment.paths.home, '.npmrc'), 'utf8').includes('offline=true'),
        true
      )
      assert.equal(
        readFileSync(join(environment.paths.cargoHome, 'config.toml'), 'utf8').includes(
          'offline = true'
        ),
        true
      )
      assert.equal(
        readFileSync(join(environment.paths.cargoHome, 'registry/cache/crate.crate'), 'utf8'),
        'cargo cache bytes'
      )
      assert.equal(
        readFileSync(join(environment.paths.privatePnpmStore, 'files/sha1/package'), 'utf8'),
        'pnpm cache bytes'
      )
      assert.equal(statSync(environment.paths.home).mode & 0o777, 0o700)
      assert.equal(statSync(environment.paths.temp).mode & 0o777, 0o700)
      assert.equal(statSync(environment.paths.privatePnpmStore).mode & 0o777, 0o700)
      assert.equal(statSync(join(environment.paths.cargoHome, 'registry')).mode & 0o777, 0o700)
      assert.equal(statSync(join(environment.paths.home, '.npmrc')).mode & 0o777, 0o600)
      assert.equal(statSync(join(environment.paths.home, '.gitconfig')).mode & 0o777, 0o600)
      assert.equal(statSync(join(environment.paths.cargoHome, 'config.toml')).mode & 0o777, 0o600)
      assert.equal(statSync(join(environment.paths.toolBin, 'cargo')).mode & 0o777, 0o700)
      assert.equal(
        readFileSync(join(environment.paths.toolBin, 'cargo'), 'utf8').startsWith(
          `#!${tools.sh}\n`
        ),
        true
      )
      assert.equal(sha256Tree(cargoRegistry), cargoBefore)
      assert.equal(sha256Tree(pnpmStore), pnpmBefore)
      for (const [key, value] of processEnvironmentBefore) {
        assert.equal(process.env[key], value)
      }
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })
})
