import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import {
  fail,
  resolveTreeDirectory,
  resolveTreeFile,
  sha256File,
  sha256Tree,
  walkFiles
} from './agent-browser-owned-source-files.mjs'
import { manifest } from './agent-browser-owned-source-integrity.mjs'

const localOrigin = 'https://ash-dashboard.invalid'

function srcsetReferences(value) {
  const references = []
  let index = 0
  while (index < value.length) {
    while (index < value.length && (value[index] === ',' || /\s/.test(value[index]))) {
      index += 1
    }
    if (index >= value.length) {
      break
    }
    const start = index
    const dataUrl = value.slice(index, index + 5).toLowerCase() === 'data:'
    while (index < value.length && !/\s/.test(value[index])) {
      if (!dataUrl && value[index] === ',') {
        break
      }
      index += 1
    }
    const reference = value.slice(start, index).replace(/,+$/, '')
    if (reference) {
      references.push(reference)
    }
    while (index < value.length && value[index] !== ',') {
      index += 1
    }
    if (value[index] === ',') {
      index += 1
    }
  }
  return references
}

function removeCssComments(css) {
  let output = ''
  let quote
  let escaped = false
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index]
    if (quote) {
      output += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      output += character
      continue
    }
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      if (end === -1) {
        fail('Dashboard CSS contains an unterminated comment.')
      }
      index = end + 1
      continue
    }
    output += character
  }
  return output
}

function cssReferences(css) {
  const source = removeCssComments(css)
  const references = []
  // Consume quoted CSS strings as tokens so content like "url('/text')"
  // cannot be mistaken for an asset. URL functions and quoted imports begin
  // before their own strings, so their actual references still get captured.
  const tokens =
    /(?<![-\w])url\s*\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^)]*?))\s*\)|@import\s+(?:"((?:\\[\s\S]|[^"\\])+)"|'((?:\\[\s\S]|[^'\\])+)')|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gi
  for (const match of source.matchAll(tokens)) {
    const reference = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
    if (reference !== undefined) {
      references.push(reference.trim())
    }
  }
  return references.filter(Boolean)
}

function htmlReferences(html) {
  const references = []
  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(
    (match) => match[1]
  )
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
  for (const tag of markup.match(/<[a-z][^>]*>/gi) ?? []) {
    const attributes =
      /(?:^|\s)(src|href|srcset|poster|data|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
    for (const match of tag.matchAll(attributes)) {
      const attribute = match[1].toLowerCase()
      const value = match[2] ?? match[3] ?? match[4] ?? ''
      if (attribute === 'srcset') {
        references.push(...srcsetReferences(value))
      } else if (attribute === 'style') {
        references.push(...cssReferences(value))
      } else if (value) {
        references.push(value)
      }
    }
  }
  for (const style of inlineStyles) {
    references.push(...cssReferences(style))
  }
  return references
}

function localOutputCandidates(fromFile, reference) {
  const value = reference.trim()
  if (
    !value ||
    value.startsWith('#') ||
    value.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return []
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(value, `${localOrigin}/${fromFile}`).pathname)
  } catch {
    fail(`Dashboard reference is malformed: ${reference}`)
  }
  if (pathname.includes('\\') || pathname.includes('\0')) {
    fail(`Dashboard reference contains an unsupported path character: ${reference}`)
  }
  const normalized = posix.normalize(pathname.replace(/^\/+/, ''))
  const path = normalized === '.' ? 'index.html' : normalized
  if (pathname.endsWith('/')) {
    return [`${path === 'index.html' ? '' : `${path}/`}index.html`]
  }
  if (posix.extname(path)) {
    return [path]
  }
  return [path, `${path}.html`, `${path}/index.html`]
}

function assertReferenceExists(outputSet, fromFile, reference) {
  const candidates = localOutputCandidates(fromFile, reference)
  if (candidates.length > 0 && !candidates.some((candidate) => outputSet.has(candidate))) {
    fail(`Dashboard ${fromFile} references a missing emitted file: ${reference}`)
  }
}

function assertOutputReferences(outputRoot, outputFiles) {
  const outputSet = new Set(outputFiles)
  for (const path of outputFiles) {
    if (path.endsWith('.html')) {
      const htmlPath = resolveTreeFile(outputRoot, path, 'Dashboard HTML output')
      const html = readFileSync(htmlPath, 'utf8')
      for (const reference of htmlReferences(html)) {
        assertReferenceExists(outputSet, path, reference)
      }
    } else if (path.endsWith('.css')) {
      const cssPath = resolveTreeFile(outputRoot, path, 'Dashboard CSS output')
      const css = readFileSync(cssPath, 'utf8')
      for (const reference of cssReferences(css)) {
        assertReferenceExists(outputSet, path, reference)
      }
    }
  }
  return outputSet
}

export function assertDashboardAssets(sourceDirectory) {
  const dashboard = manifest.inputs.dashboard
  const indexPath = resolveTreeFile(
    sourceDirectory,
    `${dashboard.outputPath}/index.html`,
    'Dashboard export'
  )
  const html = readFileSync(indexPath, 'utf8')
  if (html.includes(dashboard.placeholderText) || !html.includes('/_next/static/')) {
    fail('Dashboard export is a placeholder or has no compiled Next.js assets.')
  }

  const outputRoot = resolveTreeDirectory(
    sourceDirectory,
    dashboard.outputPath,
    'Dashboard output directory'
  )
  const outputFiles = walkFiles(outputRoot)
  if (!outputFiles.some((path) => path.startsWith('_next/static/') && path.endsWith('.js'))) {
    fail('Dashboard export has no JavaScript bundles under _next/static/.')
  }
  if (!outputFiles.some((path) => path.startsWith('_next/static/') && path.endsWith('.css'))) {
    fail('Dashboard export has no CSS bundles under _next/static/.')
  }

  for (const asset of dashboard.requiredPublicAssets) {
    const sourceAsset = resolveTreeFile(
      sourceDirectory,
      `${dashboard.packagePath}/public/${asset}`,
      'Dashboard public asset'
    )
    if (!outputFiles.includes(asset)) {
      fail(`Dashboard export is missing public asset ${asset}.`)
    }
    if (
      sha256File(sourceAsset) !==
      sha256File(resolveTreeFile(outputRoot, asset, 'Emitted public asset'))
    ) {
      fail(`Dashboard export changed public asset ${asset}.`)
    }
  }

  const font = dashboard.font
  const sourceFont = resolveTreeFile(sourceDirectory, font.path, 'Pinned dashboard font')
  const fontDigest = sha256File(sourceFont)
  if (
    !outputFiles.some(
      (path) =>
        path.startsWith('_next/static/media/') &&
        path.endsWith('.woff2') &&
        sha256File(resolveTreeFile(outputRoot, path, 'Emitted font')) === fontDigest
    )
  ) {
    fail('Dashboard export is missing the exact local Geist font.')
  }

  assertOutputReferences(outputRoot, outputFiles)
  return sha256Tree(outputRoot)
}
