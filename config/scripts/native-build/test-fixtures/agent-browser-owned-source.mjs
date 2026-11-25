import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { manifest } from '../agent-browser-owned-source-manifest.mjs'

export function withTempDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-browser-source-test-'))
  try {
    return callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function writeDashboardFixture(
  root,
  { placeholder = false, missingOutputAsset = false, missingReference = undefined } = {}
) {
  const dashboard = manifest.inputs.dashboard
  const dashboardRoot = join(root, dashboard.packagePath)
  const publicRoot = join(dashboardRoot, 'public')
  const outputRoot = join(dashboardRoot, 'out')
  const jsPath = '_next/static/chunks/app.js'
  const cssPath = '_next/static/css/app.css'
  mkdirSync(join(outputRoot, '_next/static/chunks'), { recursive: true })
  mkdirSync(join(outputRoot, '_next/static/css'), { recursive: true })
  mkdirSync(publicRoot, { recursive: true })
  writeFileSync(join(outputRoot, jsPath), 'compiled js')
  writeFileSync(join(outputRoot, cssPath), 'compiled css')
  const fontPath = join(root, dashboard.font.path)
  mkdirSync(join(fontPath, '..'), { recursive: true })
  mkdirSync(join(outputRoot, '_next/static/media'), { recursive: true })
  writeFileSync(fontPath, 'fixture font')
  writeFileSync(join(outputRoot, '_next/static/media/Geist-Variable.woff2'), 'fixture font')

  for (const asset of dashboard.requiredPublicAssets) {
    mkdirSync(join(publicRoot, asset, '..'), { recursive: true })
    writeFileSync(join(publicRoot, asset), 'public asset')
    if (!(missingOutputAsset && asset === dashboard.requiredPublicAssets[0])) {
      mkdirSync(join(outputRoot, asset, '..'), { recursive: true })
      writeFileSync(join(outputRoot, asset), 'public asset')
    }
  }

  const emittedFiles = [
    'images/local.svg',
    'images/root.svg',
    'images/one.png',
    'images/two.png',
    'images/background.svg',
    'images/font.woff2',
    '_next/static/css/theme.css',
    'guide/index.html'
  ]
  for (const emitted of emittedFiles) {
    if (emitted === missingReference) {
      continue
    }
    mkdirSync(join(outputRoot, emitted, '..'), { recursive: true })
    writeFileSync(join(outputRoot, emitted), 'emitted asset')
  }
  writeFileSync(
    join(outputRoot, cssPath),
    '@import "./theme.css"; .hero { background-image: url("../../../images/background.svg") }'
  )
  if (missingReference !== '_next/static/css/theme.css') {
    writeFileSync(
      join(outputRoot, '_next/static/css/theme.css'),
      '@font-face { src: url("../../../images/font.woff2") }'
    )
  }

  const html = placeholder
    ? dashboard.placeholderText
    : `<script src="/${jsPath}"></script><link href="/${
        cssPath
      }"><img src="images/local.svg" srcset="images/one.png 1x, /images/two.png 2x">` +
      `<img src="/images/root.svg" style="background-image:url(images/background.svg)">` +
      `<a href="/guide">Guide</a>` +
      `<img src="/providers/agentcore.svg">`
  writeFileSync(join(outputRoot, 'index.html'), html)
  return root
}
