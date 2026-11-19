import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const packagePath = path.join(repoRoot, 'native', 'computer-use-macos')
const binaryPath = path.join(packagePath, '.build', 'release', 'orca-computer-use-macos')
const appPath = path.join(packagePath, '.build', 'release', 'Ash Computer Use.app')
const appExecutablePath = path.join(appPath, 'Contents', 'MacOS', 'ash-computer-use-macos')
const appIconPath = path.join(appPath, 'Contents', 'Resources', 'AppIcon.icns')
const bundleId = 'com.ashide.desktop.computer-use'
const displayName = 'Ash Computer Use'
const universalTriples = ['arm64-apple-macosx', 'x86_64-apple-macosx']

if (process.platform !== 'darwin') {
  process.exit(0)
}

buildUniversalBinary()
chmodSync(binaryPath, 0o755)
createHelperApp()

function buildUniversalBinary() {
  const builtBinaries = universalTriples.map((triple) => {
    // SwiftPM 6.4+ swiftbuild default skips the .build/<triple>/release layout lipo reads (#21145)
    run('swift', [
      'build',
      '-c',
      'release',
      '--package-path',
      packagePath,
      '--triple',
      triple,
      '--build-system',
      'native'
    ])
    return path.join(packagePath, '.build', triple, 'release', 'orca-computer-use-macos')
  })
  mkdirSync(path.dirname(binaryPath), { recursive: true })
  run('lipo', ['-create', ...builtBinaries, '-output', binaryPath])
}

function createHelperApp() {
  rmSync(appPath, { recursive: true, force: true })
  mkdirSync(path.dirname(appExecutablePath), { recursive: true })
  mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true })
  copyFileSync(binaryPath, appExecutablePath)
  copyFileSync(path.join(repoRoot, 'resources', 'build', 'icon.icns'), appIconPath)
  chmodSync(appExecutablePath, 0o755)
  writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), infoPlist(), 'utf8')
  const signer = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
  if (signer.signal) {
    process.kill(process.pid, signer.signal)
  }
  if (signer.status !== 0) {
    process.exit(signer.status ?? 1)
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.signal) {
    process.kill(process.pid, result.signal)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>orca-computer-use-macos</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlist(bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>${escapePlist(displayName)}</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlist(displayName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAccessibilityUsageDescription</key>
  <string>Ash Computer Use needs Accessibility permission to read and interact with app interfaces when you ask Ash IDE to use apps.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Ash Computer Use needs Screen Recording permission to capture app windows when you ask Ash IDE to inspect your screen.</string>
</dict>
</plist>
`
}

function escapePlist(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
