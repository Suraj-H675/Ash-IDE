#!/usr/bin/env node
/**
 * Read-only, conservative Ash source transfer inventory.
 *
 * This is a static-import *lower bound*, not a safe-deletion list. Vite's
 * runtime transforms, generated imports, template-path imports, workspace
 * package exports, native files and resources are outside this analysis.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sources = join(root, 'src')
const ignoreDirectories = new Set(['node_modules', 'build', 'target', 'out', '.cache'])
const scripts = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'])
const traversable = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const files = new Set()

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoreDirectories.has(entry.name)) continue
    const candidate = join(directory, entry.name)
    if (entry.isDirectory()) visit(candidate)
    else if (entry.isFile()) files.add(candidate)
  }
}

function resolveImport(stem) {
  const candidates = [
    stem,
    ...[...scripts].map((extension) => `${stem}${extension}`),
    ...[...scripts].map((extension) => join(stem, `index${extension}`))
  ]
  for (const candidate of candidates) if (files.has(candidate)) return candidate
  if (/\.(?:js|jsx|mjs|cjs)$/.test(stem)) {
    return resolveImport(stem.replace(/\.(?:js|jsx|mjs|cjs)$/, ''))
  }
  return null
}

function importedPaths(sourceFile) {
  const content = readFileSync(sourceFile, 'utf8')
  // Include static imports/exports, side-effect imports, literal require and
  // dynamic import strings. Non-literal and import.meta.glob are not resolved.
  const specifiers = new Set()
  const pattern = /(?:from\s*|(?:import|export)\s*|(?:require|import)\s*\()\s*['"]([^'"]+)['"]/g
  for (const match of content.matchAll(pattern)) specifiers.add(match[1])
  const result = []
  for (const name of specifiers) {
    const target = name.startsWith('.')
      ? resolve(dirname(sourceFile), name)
      : name.startsWith('@/')
        ? join(sources, 'renderer/src', name.slice(2))
        : name.startsWith('@renderer/')
          ? join(sources, 'renderer/src', name.slice('@renderer/'.length))
          : null
    if (!target) continue
    const imported = resolveImport(target)
    if (imported) result.push(imported)
  }
  return result
}

const initial = [
  'src/main/index.ts',
  'src/main/daemon/daemon-entry.ts',
  'src/preload/index.ts',
  'src/preload/browser-extension-preload.ts',
  'src/renderer/src/main.tsx',
  'src/renderer/src/popout.tsx',
  'src/renderer/src/space.tsx',
  'src/renderer/src/web/main.tsx',
  'src/cli/index.ts'
]
const entrySource = readFileSync(join(root, 'config/build-plugins/main-build-entry-points.ts'), 'utf8')
for (const match of entrySource.matchAll(/resolve\(\s*['"](src\/[^'"]+)['"]/g)) {
  initial.push(match[1])
}

visit(sources)
const queue = [...new Set(initial.map((entry) => join(root, entry)))].filter((entry) => files.has(entry))
const roots = queue.map((entry) => relative(root, entry)).sort()
const reached = new Set()
while (queue.length) {
  const next = queue.pop()
  if (reached.has(next)) continue
  reached.add(next)
  if (!traversable.has(extname(next))) continue
  for (const imported of importedPaths(next)) if (!reached.has(imported)) queue.push(imported)
}

const isTest = (name) =>
  /(?:\.test\.|\.spec\.|\/testing\/|\/__tests__\/|\/__fixtures__\/|\/fixtures\/)/.test(name)
const unseen = [...files].filter((item) => scripts.has(extname(item)) && !reached.has(item))
const perArea = new Map()
for (const sourceFile of unseen) {
  const name = relative(root, sourceFile)
  const parts = name.split('/')
  const area = parts[1] === 'renderer' ? 'src/renderer' : parts.slice(0, 3).join('/')
  const entry = perArea.get(area) ?? { files: 0, testsAndFixtures: 0 }
  entry.files += 1
  if (isTest(name)) entry.testsAndFixtures += 1
  perArea.set(area, entry)
}
const summary = {
  warning: 'Static literal-import lower bound; do not infer safe deletion or staging from this output alone.',
  roots,
  totalSourceFiles: files.size,
  scriptAndDataFiles: [...files].filter((item) => scripts.has(extname(item))).length,
  staticallyReachedFiles: reached.size,
  notProvenReachedScripts: unseen.length,
  notProvenReachedTestsAndFixtures: unseen.filter((item) => isTest(relative(root, item))).length,
  notProvenReachedOtherScripts: unseen.filter((item) => !isTest(relative(root, item))).length,
  topUnreachedAreas: [...perArea].sort((a, b) => b[1].files - a[1].files).slice(0, 18)
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
